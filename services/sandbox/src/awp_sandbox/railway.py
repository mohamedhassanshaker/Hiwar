"""Workspace sandboxes as Railway sandboxes, for a deployment without Kubernetes (D390).

The same six calls as `SandboxManager`, so the HTTP surface and the agent's skill-script
tools do not change. Each workspace is a Railway sandbox — an isolated VM with public egress
only — booted from a template built out of the workspace image's own lock files
(`services/sandbox/workspace`). Railway builds a template once, keyed by the content of its
instructions, and boots sandboxes only from a template that is already built.
Commands go through the public GraphQL API (`sandboxExec`), over HTTPS only.

Which run a sandbox belongs to is held in this process. A sandbox it forgets on a restart
is not leaked: every one is created with an idle timeout and Railway destroys it.
"""

from __future__ import annotations

import asyncio
import base64
import shlex
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from awp_sandbox.config import settings
from awp_sandbox.logging import logger
from awp_sandbox.manager import (
    WRITE_CHUNK,
    WRITE_SCRIPT,
    ExecRequest,
    ExecResult,
    Sandbox,
    SandboxError,
    WriteRequest,
)
from awp_sandbox.railway_api import (
    BUILD,
    BUILD_STATUS,
    CREATE,
    DESTROY,
    EXEC,
    STATUS,
    RailwayApi,
)

log = logger("awp_sandbox.railway")

READY_POLL_SECONDS = 2.0
#: A sandbox boots from the built template in seconds.
READY_TIMEOUT_SECONDS = 120
TEMPLATE_POLL_SECONDS = 10.0
#: Building the template installs every library of the workspace image.
TEMPLATE_TIMEOUT_SECONDS = 1800

#: Where the workspace's files go, and what a command sees: the kind Pod's layout.
_ENVIRONMENT = (
    "cd /workspace && export PATH=/opt/venv/bin:$PATH NODE_PATH=/opt/node/node_modules "
    "HOME=/workspace PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 && "
)

_LOCK_FILES = {
    "/opt/workspace": ("pyproject.toml", "uv.lock"),
    "/opt/node": ("package.json", "package-lock.json"),
}


def template_instructions(workspace: Path) -> str:
    """The shell lines that turn Railway's base image into the workspace image.

    The lock files travel inside the lines in base64, so the template is exactly the one
    `services/sandbox/workspace/Dockerfile` builds, and a changed lock is a new template.
    """
    steps = ["mkdir -p /opt/workspace /opt/node /workspace"]
    for directory, names in _LOCK_FILES.items():
        for name in names:
            encoded = base64.b64encode((workspace / name).read_bytes()).decode()
            steps.append(f"echo {encoded} | base64 -d > {directory}/{name}")
    steps.append(
        "cd /opt/workspace && UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy "
        "uv sync --frozen --no-install-project --no-dev --python 3.12"
    )
    steps.append("cd /opt/node && npm ci --omit=dev --ignore-scripts && npm cache clean --force")
    return "\n".join(steps)


def shell_command(command: list[str]) -> str:
    """One command line for `sandboxExec`, which takes a string: every argument quoted, so
    none is interpreted by the shell, run in the workspace's environment."""
    return _ENVIRONMENT + "exec " + shlex.join(command)


@dataclass
class _Workspace:
    """A sandbox this process created, and the run it was given to ("" while warm)."""

    sandbox_id: str
    created: datetime
    run_id: str = ""


class RailwaySandboxManager:
    """The pool of workspace sandboxes, on Railway."""

    def __init__(self, api: RailwayApi | None = None, workspace: Path | None = None) -> None:
        config = settings()
        if api is None:
            if not config.railway_token or not config.railway_environment_id:
                raise SandboxError("RAILWAY_API_TOKEN and RAILWAY_ENVIRONMENT_ID are required")
            api = RailwayApi(
                config.railway_api_url, config.railway_token, config.railway_environment_id
            )
        self.api = api
        self.instructions = template_instructions(workspace or Path(config.workspace_files))
        self.workspaces: dict[str, _Workspace] = {}
        self.template_ready = False
        self._template_lock = asyncio.Lock()

    # Lifecycle ------------------------------------------------------------------------

    async def create(self, run_id: str) -> Sandbox:
        """The run's own sandbox; otherwise a warm one; otherwise a new one."""
        for workspace in self.workspaces.values():
            if workspace.run_id == run_id:
                return _sandbox(workspace)
        warm = next((w for w in self.workspaces.values() if not w.run_id), None)
        if warm is None:
            warm = await self._start()
        warm.run_id = run_id
        return _sandbox(warm)

    async def destroy(self, sandbox_id: str) -> None:
        """Destroy one sandbox. One already gone counts as destroyed."""
        self.workspaces.pop(sandbox_id, None)
        try:
            await self.api.call(DESTROY, {"id": sandbox_id, "env": self.api.environment_id})
        except SandboxError as problem:
            log.warning("sandbox.destroy_failed", sandbox_id=sandbox_id, error=str(problem))

    async def destroy_for_run(self, run_id: str) -> int:
        """Destroy every sandbox of one run. The number destroyed."""
        owned = [w.sandbox_id for w in self.workspaces.values() if w.run_id == run_id]
        for sandbox_id in owned:
            await self.destroy(sandbox_id)
        return len(owned)

    async def ensure_warm_pool(self) -> int:
        """Replace idle sandboxes past half their life, then top the pool up to its size."""
        config = settings()
        for workspace in list(self.workspaces.values()):
            age = (datetime.now(UTC) - workspace.created).total_seconds()
            if not workspace.run_id and age >= config.max_seconds / 2:
                await self.destroy(workspace.sandbox_id)
        idle = sum(1 for w in self.workspaces.values() if not w.run_id)
        missing = max(0, config.warm_pool_size - idle)
        for _ in range(missing):
            await self._start()
        return missing

    # Use ------------------------------------------------------------------------------

    async def execute(self, sandbox_id: str, request: ExecRequest) -> ExecResult:
        """Run one command inside the sandbox, with a hard timeout."""
        timeout = request.timeout_seconds or settings().exec_timeout_seconds
        return await self._exec(sandbox_id, shell_command(request.command), timeout)

    async def write_file(self, sandbox_id: str, request: WriteRequest) -> ExecResult:
        """Write a file into the workspace, in chunks; path and bytes stay arguments."""
        content = request.content_base64
        chunks = [content[at : at + WRITE_CHUNK] for at in range(0, len(content), WRITE_CHUNK)]
        result = ExecResult()
        for index, chunk in enumerate(chunks or [""]):
            mode = ">" if index == 0 else ">>"
            command = ["sh", "-c", WRITE_SCRIPT, "sh", request.path, chunk, mode]
            result = await self.execute(sandbox_id, ExecRequest(command=command))
            if result.exit_code != 0:
                return result
        return result

    async def read_file(self, sandbox_id: str, path: str) -> ExecResult:
        """Read a file out of the workspace; `stdout` holds its bytes in base64."""
        command = ["base64", "-w", "0", "--", path]
        return await self.execute(sandbox_id, ExecRequest(command=command))

    # Internals ------------------------------------------------------------------------

    async def _exec(self, sandbox_id: str, command: str, limit_seconds: int) -> ExecResult:
        """`sandboxExec`. An output Railway cut short is a failure, not a partial answer."""
        variables = {
            "id": sandbox_id,
            "env": self.api.environment_id,
            "command": command,
            "timeout": limit_seconds,
        }
        answer = (await self.api.call(EXEC, variables, limit_seconds + 30))["sandboxExec"]
        if answer["timedOut"]:
            return ExecResult(
                exit_code=124, stderr="the command reached its time limit", timed_out=True
            )
        if answer["truncated"]:
            return ExecResult(exit_code=1, stderr="the output was larger than one call returns")
        return ExecResult(
            exit_code=answer["exitCode"], stdout=answer["stdout"], stderr=answer["stderr"]
        )

    async def _start(self) -> _Workspace:
        """Create one sandbox from the workspace template and wait until it runs."""
        await self._ensure_template()
        config = settings()
        data = {
            "environmentId": self.api.environment_id,
            "idleTimeoutMinutes": max(1, config.max_seconds // 60),
            "networkIsolation": "ISOLATED",
            "template": {"instructions": self.instructions},
        }
        created = (await self.api.call(CREATE, {"input": data}))["sandboxCreate"]
        await self._wait_running(created["id"], created["status"])
        workspace = _Workspace(sandbox_id=created["id"], created=datetime.now(UTC))
        self.workspaces[workspace.sandbox_id] = workspace
        return workspace

    async def _ensure_template(self) -> None:
        """Build the workspace template unless it is built. Railway answers a build of the same
        instructions with the template it already has. Raises `SandboxError` if it fails."""
        async with self._template_lock:
            if self.template_ready:
                return
            env = self.api.environment_id
            variables = {"env": env, "input": {"instructions": self.instructions}}
            build = (await self.api.call(BUILD, variables))["sandboxTemplateBuild"]
            log.info("template.build", template=build["id"], status=build["status"])
            status, waited = build["status"], 0.0
            while status != "READY":
                if status == "FAILED":
                    raise SandboxError(f"the workspace template {build['id']} failed to build")
                if waited >= TEMPLATE_TIMEOUT_SECONDS:
                    raise SandboxError(f"the workspace template {build['id']} took too long")
                await asyncio.sleep(TEMPLATE_POLL_SECONDS)
                waited += TEMPLATE_POLL_SECONDS
                answer = await self.api.call(BUILD_STATUS, {"id": build["id"], "env": env})
                status = answer["sandboxTemplateBuild"]["status"]
            self.template_ready = True
            log.info("template.ready", template=build["id"])

    async def _wait_running(self, sandbox_id: str, status: str) -> None:
        """Poll until the sandbox runs. Raises `SandboxError` if it fails or takes too long."""
        waited = 0.0
        while status != "RUNNING":
            if status in ("FAILED", "DESTROYED", "DESTROYING"):
                raise SandboxError(f"sandbox {sandbox_id} is {status} before it was used")
            if waited >= READY_TIMEOUT_SECONDS:
                raise SandboxError(f"sandbox {sandbox_id} did not start in time")
            await asyncio.sleep(READY_POLL_SECONDS)
            waited += READY_POLL_SECONDS
            variables = {"id": sandbox_id, "env": self.api.environment_id}
            status = (await self.api.call(STATUS, variables))["sandbox"]["status"]


def _sandbox(workspace: _Workspace) -> Sandbox:
    """The API's view of a workspace; `pod` carries the Railway sandbox id."""
    return Sandbox(
        sandbox_id=workspace.sandbox_id,
        run_id=workspace.run_id,
        pod=workspace.sandbox_id,
        state="ready",
    )
