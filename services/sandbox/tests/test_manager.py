"""The manager's own logic, with the Kubernetes API replaced.

A command that would run in the sandbox Pod runs in a local `sh` instead, so the file
transfer is checked byte for byte rather than by the shape of the command.
"""

from __future__ import annotations

import base64
import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from awp_sandbox import manager as manager_module
from awp_sandbox.config import settings
from awp_sandbox.manager import ExecRequest, ExecResult, SandboxManager, WriteRequest
from awp_sandbox.spec import LABEL_MANAGED, LABEL_POOL, LABEL_RUN, LABEL_STATE


class FakeCoreApi:
    """`list_namespaced_pod` and `delete_namespaced_pod`, over a list of Pods."""

    def __init__(self, pods: list[Any]) -> None:
        self.pods = pods
        self.deleted: list[str] = []

    def list_namespaced_pod(self, namespace: str, label_selector: str) -> Any:
        wanted = dict(term.split("=", 1) for term in label_selector.split(","))
        items = [
            pod
            for pod in self.pods
            if all(pod.metadata.labels.get(key) == value for key, value in wanted.items())
        ]
        return SimpleNamespace(items=items)

    def delete_namespaced_pod(self, name: str, namespace: str, grace_period_seconds: int) -> None:
        self.deleted.append(name)


def _pod(
    name: str,
    run_id: str,
    phase: str = "Running",
    *,
    warm: bool = False,
    age_seconds: float = 0,
) -> Any:
    labels = {LABEL_RUN: run_id, LABEL_MANAGED: "sandbox-manager"}
    if warm:
        labels |= {LABEL_POOL: "warm", LABEL_STATE: "idle"}
    return SimpleNamespace(
        metadata=SimpleNamespace(name=name, labels=labels, deletion_timestamp=None),
        status=SimpleNamespace(
            phase=phase, start_time=datetime.now(UTC) - timedelta(seconds=age_seconds)
        ),
    )


def _manager(pods: list[Any]) -> SandboxManager:
    manager = SandboxManager.__new__(SandboxManager)
    manager.api = FakeCoreApi(pods)
    manager.namespace = "awp-sandbox"
    return manager


async def test_a_run_reaches_the_pod_it_already_has() -> None:
    manager = _manager([_pod("sandbox-aa11", "run-1"), _pod("sandbox-bb22", "run-2")])

    sandbox = await manager.create("run-1")

    assert (sandbox.sandbox_id, sandbox.pod) == ("aa11", "sandbox-aa11")


async def test_destroying_a_run_deletes_only_its_pods() -> None:
    manager = _manager([_pod("sandbox-aa11", "run-1"), _pod("sandbox-bb22", "run-2")])

    assert await manager.destroy_for_run("run-1") == 1
    assert manager.api.deleted == ["sandbox-aa11"]


async def test_an_exec_never_borrows_the_client_other_calls_share(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`stream` rewires its client's `request` while the exec opens, so a list call from a
    parallel tool call on the same client went over the websocket and failed."""
    manager = _manager([])
    used: list[Any] = []

    class Closed:
        returncode = 0

        def is_open(self) -> bool:
            return False

        def close(self) -> None:
            pass

    def fake_stream(api_method: Any, *args: Any, **kwargs: Any) -> Closed:
        used.append(api_method.__self__)
        return Closed()

    monkeypatch.setattr(manager_module, "stream", fake_stream)

    result = await manager.execute("aa11", ExecRequest(command=["true"]))

    assert result.exit_code == 0
    [api] = used
    assert api is not manager.api


# Windows caps a whole command line at 32 KiB, below one chunk; the Pod is Linux.
async def test_the_warm_pool_drops_ended_and_old_pods_and_tops_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SANDBOX_MAX_SECONDS", "900")
    monkeypatch.setenv("SANDBOX_WARM_POOL", "1")
    settings.cache_clear()
    manager = _manager(
        [
            _pod("sandbox-ended", "none", "Failed", warm=True),
            _pod("sandbox-old", "none", warm=True, age_seconds=600),
            _pod("sandbox-busy", "run-1", age_seconds=600),
        ]
    )
    created: list[Any] = []
    manager.api.create_namespaced_pod = lambda namespace, body: created.append(body)

    try:
        assert await manager.ensure_warm_pool() == 1
    finally:
        settings.cache_clear()

    # A run's own Pod is left to its run, however old.
    assert manager.api.deleted == ["sandbox-ended", "sandbox-old"]
    assert len(created) == 1


@pytest.mark.skipif(os.name != "posix", reason="needs Linux's argument limits and base64")
async def test_a_file_larger_than_one_argument_arrives_byte_for_byte(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def run_locally(pod: str, command: list[str]) -> ExecResult:
        done = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, check=False)
        return ExecResult(exit_code=done.returncode, stdout=done.stdout, stderr=done.stderr)

    manager = _manager([])
    monkeypatch.setattr(manager, "_exec", run_locally)
    # Three chunks, with bytes a shell would interpret if they reached the script.
    content = bytes(range(256)) * 1000 + b"$(touch pwned) ' \" `x`"
    path = "skills/a b/it's.bin"

    result = await manager.write_file(
        "aa11", WriteRequest(path=path, content_base64=base64.b64encode(content).decode())
    )

    assert result.exit_code == 0, result.stderr
    assert (tmp_path / path).read_bytes() == content
    assert not (tmp_path / "pwned").exists()
