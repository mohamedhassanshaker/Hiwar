"""Create, execute in and destroy sandbox Pods through the Kubernetes API.

The manager holds namespaced RBAC on `awp-sandbox` only: it can create, read, exec into and
delete Pods there and nothing else anywhere. A warm pool keeps a few idle Pods ready, because
a cold start costs several seconds and an agent waiting for a sandbox is an agent burning its
run budget.
"""

from __future__ import annotations

import asyncio
import base64
import secrets
from datetime import UTC, datetime
from typing import Any

from kubernetes import client
from kubernetes import config as kube_config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream
from pydantic import BaseModel, Field, field_validator

from awp_sandbox.config import settings
from awp_sandbox.logging import logger
from awp_sandbox.spec import (
    LABEL_MANAGED,
    LABEL_POOL,
    LABEL_RUN,
    LABEL_STATE,
    pod_manifest,
    pod_name,
)

log = logger("awp_sandbox.manager")

READY_POLL_SECONDS = 0.25
READY_TIMEOUT_SECONDS = 60

#: Base64 characters per exec when writing a file. A file travels as command arguments, and
#: Linux caps one argument at 128 KiB (`MAX_ARG_STRLEN`).
WRITE_CHUNK = 96 * 1024

#: The file in `$1` gets the base64 in `$2`; `$3` is `>` for the first chunk, `>>` after.
WRITE_SCRIPT = (
    'mkdir -p "$(dirname -- "$1")" && '
    'if [ "$3" = ">" ]; then printf %s "$2" | base64 -d > "$1"; '
    'else printf %s "$2" | base64 -d >> "$1"; fi'
)


class SandboxError(RuntimeError):
    """The sandbox could not be created, reached or removed."""


class Sandbox(BaseModel):
    """One workspace sandbox."""

    sandbox_id: str
    run_id: str = ""
    pod: str
    state: str = "starting"


class ExecResult(BaseModel):
    """What a command in a sandbox produced."""

    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False


class WriteRequest(BaseModel):
    """A file to put into a sandbox workspace, its bytes in base64."""

    path: str = Field(min_length=1)
    content_base64: str

    @field_validator("content_base64")
    @classmethod
    def _is_base64(cls, value: str) -> str:
        base64.b64decode(value, validate=True)
        return value


class ExecRequest(BaseModel):
    """A command to run in a sandbox."""

    command: list[str] = Field(min_length=1)
    timeout_seconds: int | None = None


def _load_kube_config() -> None:
    """In the cluster, use the Pod's service account; on a laptop, use the kubeconfig."""
    try:
        kube_config.load_incluster_config()
    except kube_config.ConfigException:
        kube_config.load_kube_config()


class SandboxManager:
    """The pool of workspace sandboxes."""

    def __init__(self) -> None:
        _load_kube_config()
        self.api = client.CoreV1Api()
        self.namespace = settings().namespace

    # Lifecycle ------------------------------------------------------------------------

    async def create(self, run_id: str) -> Sandbox:
        """The run's own Pod while it runs; otherwise a warm Pod, otherwise a fresh one.

        Idempotent per run, so a caller that keeps no state of its own (a tool call in a
        Temporal activity) reaches the same workspace on every call.
        """
        for pod in await self._pods(f"{LABEL_RUN}={run_id}"):
            if pod.status.phase == "Running" and pod.metadata.deletion_timestamp is None:
                return Sandbox(
                    sandbox_id=pod.metadata.name.removeprefix("sandbox-"),
                    run_id=run_id,
                    pod=pod.metadata.name,
                    state="ready",
                )
        warm = await self._take_warm(run_id)
        if warm is not None:
            return warm
        sandbox_id = secrets.token_hex(8)
        manifest = pod_manifest(sandbox_id, run_id=run_id)
        await asyncio.to_thread(
            self.api.create_namespaced_pod, namespace=self.namespace, body=manifest
        )
        await self._wait_ready(pod_name(sandbox_id))
        return Sandbox(
            sandbox_id=sandbox_id, run_id=run_id, pod=pod_name(sandbox_id), state="ready"
        )

    async def destroy(self, sandbox_id: str) -> None:
        """Delete the Pod. A sandbox is never reused between runs."""
        try:
            await asyncio.to_thread(
                self.api.delete_namespaced_pod,
                name=pod_name(sandbox_id),
                namespace=self.namespace,
                grace_period_seconds=0,
            )
        except ApiException as problem:
            if problem.status != 404:
                raise SandboxError(f"could not destroy {sandbox_id}: {problem.reason}") from problem

    async def destroy_for_run(self, run_id: str) -> int:
        """Delete every Pod of one run. The number deleted."""
        pods = await self._pods(f"{LABEL_RUN}={run_id}")
        for pod in pods:
            await self.destroy(pod.metadata.name.removeprefix("sandbox-"))
        return len(pods)

    async def ensure_warm_pool(self) -> int:
        """Top the warm pool back up to its size. Idempotent, and safe to call often.

        First deletes the Pods that ended (a deadline ends every one, and an ended Pod is not
        deleted by anything else) and the idle ones too old to give a run its working life.
        """
        config = settings()
        for pod in await self._pods(f"{LABEL_MANAGED}=sandbox-manager"):
            idle = pod.metadata.labels.get(LABEL_STATE) == "idle"
            if pod.status.phase in ("Failed", "Succeeded") or (idle and not self._fresh(pod)):
                await self.destroy(pod.metadata.name.removeprefix("sandbox-"))
        idle = await self._idle_pods()
        missing = max(0, config.warm_pool_size - len(idle))
        for _ in range(missing):
            sandbox_id = secrets.token_hex(8)
            await asyncio.to_thread(
                self.api.create_namespaced_pod,
                namespace=self.namespace,
                body=pod_manifest(sandbox_id, warm=True),
            )
        return missing

    # Use ------------------------------------------------------------------------------

    async def execute(self, sandbox_id: str, request: ExecRequest) -> ExecResult:
        """Run one command inside the sandbox, with a hard timeout."""
        timeout = request.timeout_seconds or settings().exec_timeout_seconds
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._exec, pod_name(sandbox_id), request.command),
                timeout=timeout,
            )
        except TimeoutError:
            return ExecResult(
                exit_code=124, stderr="the command reached its time limit", timed_out=True
            )

    async def write_file(self, sandbox_id: str, request: WriteRequest) -> ExecResult:
        """Write a file into the workspace, through the same exec channel.

        In chunks of command arguments: the path and the bytes are arguments, never part of
        the script, so neither is interpreted by the shell.
        """
        content = request.content_base64
        chunks = [content[at : at + WRITE_CHUNK] for at in range(0, len(content), WRITE_CHUNK)]
        result = ExecResult()
        for index, chunk in enumerate(chunks or [""]):
            mode = ">" if index == 0 else ">>"
            command = ["sh", "-c", WRITE_SCRIPT, "sh", request.path, chunk, mode]
            result = await asyncio.to_thread(self._exec, pod_name(sandbox_id), command)
            if result.exit_code != 0:
                return result
        return result

    async def read_file(self, sandbox_id: str, path: str) -> ExecResult:
        """Read a file out of the workspace; `stdout` holds its bytes in base64."""
        command = ["base64", "-w", "0", "--", path]
        return await self.execute(sandbox_id, ExecRequest(command=command))

    # Internals ------------------------------------------------------------------------

    def _exec(self, pod: str, command: list[str]) -> ExecResult:
        """The blocking exec call. Runs in a thread; the Kubernetes client is not async.

        On an API client of its own: `stream` swaps its client's `request` for a websocket
        one while the exec opens, so a call made meanwhile on a shared client, from another
        thread, went over the websocket and failed ("Handshake status 200 OK").
        """
        with client.ApiClient() as api_client:
            return self._exec_on(client.CoreV1Api(api_client), pod, command)

    def _exec_on(self, api: Any, pod: str, command: list[str]) -> ExecResult:
        """Exec `command` in the Pod's `workspace` container and collect its output.

        Reads stdout and stderr until the channel closes. A missing return code counts as 0.
        Raises `SandboxError` when the exec cannot be opened.
        """
        try:
            channel = stream(
                api.connect_get_namespaced_pod_exec,
                pod,
                self.namespace,
                command=command,
                container="workspace",
                stderr=True,
                stdin=False,
                stdout=True,
                tty=False,
                _preload_content=False,
            )
        except ApiException as problem:
            raise SandboxError(f"could not reach {pod}: {problem.reason}") from problem

        stdout: list[str] = []
        stderr: list[str] = []
        while channel.is_open():
            channel.update(timeout=1)
            if channel.peek_stdout():
                stdout.append(channel.read_stdout())
            if channel.peek_stderr():
                stderr.append(channel.read_stderr())
        channel.close()
        returncode = channel.returncode if channel.returncode is not None else 0
        return ExecResult(
            exit_code=int(returncode), stdout="".join(stdout), stderr="".join(stderr)
        )

    async def _pods(self, label_selector: str) -> list[Any]:
        listed = await asyncio.to_thread(
            self.api.list_namespaced_pod, namespace=self.namespace, label_selector=label_selector
        )
        return list(listed.items)

    async def _idle_pods(self) -> list[Any]:
        pods = await self._pods(f"{LABEL_POOL}=warm,{LABEL_STATE}=idle")
        return [item for item in pods if item.status.phase == "Running" and self._fresh(item)]

    @staticmethod
    def _fresh(pod: Any) -> bool:
        """Whether a Pod has at least half its deadline left: a warm Pod's deadline runs
        from its start, not from the claim, so an old one would end under the run."""
        started = pod.status.start_time
        if started is None:
            return True
        age: float = (datetime.now(UTC) - started).total_seconds()
        return age < settings().max_seconds / 2

    async def _take_warm(self, run_id: str) -> Sandbox | None:
        """Claim one idle Pod by relabelling it. The relabel is the claim."""
        for pod in await self._idle_pods():
            patch = {
                "metadata": {
                    "labels": {LABEL_STATE: "busy", LABEL_POOL: "assigned", LABEL_RUN: run_id}
                }
            }
            try:
                await asyncio.to_thread(
                    self.api.patch_namespaced_pod,
                    name=pod.metadata.name,
                    namespace=self.namespace,
                    body=patch,
                )
            except ApiException:
                continue  # Another run claimed it first; try the next one.
            sandbox_id = pod.metadata.name.removeprefix("sandbox-")
            return Sandbox(
                sandbox_id=sandbox_id, run_id=run_id, pod=pod.metadata.name, state="ready"
            )
        return None

    async def _wait_ready(self, pod: str) -> None:
        """Poll until the Pod is Running.

        Raises `SandboxError` when it ends first or is not Running within
        `READY_TIMEOUT_SECONDS`.
        """
        waited = 0.0
        while waited < READY_TIMEOUT_SECONDS:
            current = await asyncio.to_thread(
                self.api.read_namespaced_pod, name=pod, namespace=self.namespace
            )
            if current.status.phase == "Running":
                return
            if current.status.phase in ("Failed", "Succeeded"):
                raise SandboxError(f"{pod} ended as {current.status.phase} before it was used")
            await asyncio.sleep(READY_POLL_SECONDS)
            waited += READY_POLL_SECONDS
        raise SandboxError(f"{pod} was not ready within {READY_TIMEOUT_SECONDS} seconds")
