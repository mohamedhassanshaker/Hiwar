"""The HTTP surface of the sandbox manager, with the Kubernetes-backed manager replaced.

`SandboxManager` is what reaches the Kubernetes API, so the app's lifespan is run with a
stand-in that records what it was asked and answers or refuses as each case needs.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

from awp_sandbox import main
from awp_sandbox.manager import ExecRequest, ExecResult, Sandbox, SandboxError, WriteRequest


@dataclass
class FakeManager:
    """The manager's six calls, answering from the test's settings."""

    refuse: bool = False
    calls: list[tuple[str, object]] = field(default_factory=list)

    def _maybe_refuse(self, what: str) -> None:
        if self.refuse:
            raise SandboxError(f"no sandbox for {what}")

    async def create(self, run_id: str) -> Sandbox:
        self.calls.append(("create", run_id))
        self._maybe_refuse(run_id)
        return Sandbox(sandbox_id="sbx-1", run_id=run_id, pod="sandbox-sbx-1", state="ready")

    async def destroy(self, sandbox_id: str) -> None:
        self.calls.append(("destroy", sandbox_id))

    async def destroy_for_run(self, run_id: str) -> int:
        self.calls.append(("destroy_for_run", run_id))
        return 1

    async def execute(self, sandbox_id: str, request: ExecRequest) -> ExecResult:
        self.calls.append(("execute", request.command))
        self._maybe_refuse(sandbox_id)
        return ExecResult(stdout="hello\n")

    async def write_file(self, sandbox_id: str, request: WriteRequest) -> ExecResult:
        self.calls.append(("write", request.path))
        self._maybe_refuse(sandbox_id)
        return ExecResult()

    async def read_file(self, sandbox_id: str, path: str) -> ExecResult:
        self.calls.append(("read", path))
        self._maybe_refuse(sandbox_id)
        return ExecResult(stdout="Y29udGVudHM=")

    async def ensure_warm_pool(self) -> None:
        self.calls.append(("warm", None))


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeManager:
    stand_in = FakeManager()
    monkeypatch.setattr(main, "SandboxManager", lambda: stand_in)
    return stand_in


@pytest.fixture
def api(fake: FakeManager) -> Iterator[TestClient]:
    with TestClient(main.app) as client:
        yield client


def test_a_run_is_given_a_workspace(api: TestClient, fake: FakeManager) -> None:
    answer = api.post("/sandboxes", json={"run_id": "run-1"})

    assert answer.status_code == 200
    assert answer.json() == {
        "sandbox_id": "sbx-1",
        "run_id": "run-1",
        "pod": "sandbox-sbx-1",
        "state": "ready",
    }
    assert ("create", "run-1") in fake.calls


def test_a_workspace_that_cannot_be_created_is_unavailable(
    api: TestClient, fake: FakeManager
) -> None:
    fake.refuse = True

    answer = api.post("/sandboxes", json={"run_id": "run-1"})

    assert answer.status_code == 503
    assert answer.json() == {"detail": "no sandbox for run-1"}


def test_without_the_manager_every_call_is_unavailable() -> None:
    answer = TestClient(main.app).post("/sandboxes", json={"run_id": "run-1"})

    assert answer.status_code == 503
    assert answer.json() == {"detail": "the sandbox manager is not connected"}


def test_a_run_id_that_is_no_label_value_is_refused(api: TestClient, fake: FakeManager) -> None:
    answer = api.post("/sandboxes", json={"run_id": "run 1; rm"})

    assert answer.status_code == 422
    assert not [call for call in fake.calls if call[0] == "create"]


def test_the_workspaces_of_a_run_are_destroyed(api: TestClient, fake: FakeManager) -> None:
    answer = api.delete("/sandboxes", params={"run_id": "run-1"})

    assert answer.json() == {"destroyed": 1}
    assert ("destroy_for_run", "run-1") in fake.calls


def test_a_workspace_is_destroyed(api: TestClient, fake: FakeManager) -> None:
    answer = api.delete("/sandboxes/sbx-1")

    assert answer.json() == {"status": "destroyed"}
    assert ("destroy", "sbx-1") in fake.calls


def test_a_command_runs_and_returns_its_output(api: TestClient, fake: FakeManager) -> None:
    answer = api.post("/sandboxes/sbx-1/exec", json={"command": ["echo", "hello"]})

    assert answer.status_code == 200
    assert answer.json() == {"exit_code": 0, "stdout": "hello\n", "stderr": "", "timed_out": False}
    assert ("execute", ["echo", "hello"]) in fake.calls


def test_an_empty_command_is_refused(api: TestClient) -> None:
    assert api.post("/sandboxes/sbx-1/exec", json={"command": []}).status_code == 422


def test_a_command_in_a_workspace_that_is_gone_is_not_found(
    api: TestClient, fake: FakeManager
) -> None:
    fake.refuse = True

    answer = api.post("/sandboxes/sbx-9/exec", json={"command": ["ls"]})

    assert answer.status_code == 404
    assert answer.json() == {"detail": "no sandbox for sbx-9"}


def test_a_file_is_written_and_read_back(api: TestClient, fake: FakeManager) -> None:
    written = api.post(
        "/sandboxes/sbx-1/files", json={"path": "a.txt", "content_base64": "Y29udGVudHM="}
    )
    read = api.get("/sandboxes/sbx-1/files", params={"path": "a.txt"})

    assert written.status_code == 200
    assert read.json()["stdout"] == "Y29udGVudHM="
    assert [call for call in fake.calls if call[0] in ("write", "read")] == [
        ("write", "a.txt"),
        ("read", "a.txt"),
    ]


def test_files_of_a_workspace_that_is_gone_are_not_found(
    api: TestClient, fake: FakeManager
) -> None:
    fake.refuse = True

    answer = api.post("/sandboxes/sbx-9/files", json={"path": "a", "content_base64": ""})
    assert answer.status_code == 404
    assert api.get("/sandboxes/sbx-9/files", params={"path": "a"}).status_code == 404


def test_file_content_that_is_not_base64_is_refused(api: TestClient) -> None:
    answer = api.post("/sandboxes/sbx-1/files", json={"path": "a", "content_base64": "not base64!"})

    assert answer.status_code == 422


def test_reading_a_file_needs_its_path(api: TestClient) -> None:
    assert api.get("/sandboxes/sbx-1/files").status_code == 422


def test_health_follows_the_manager(api: TestClient) -> None:
    assert api.get("/healthz").json() == {"status": "ok"}


def test_health_is_degraded_without_the_manager() -> None:
    assert TestClient(main.app).get("/healthz").json() == {"status": "degraded"}
