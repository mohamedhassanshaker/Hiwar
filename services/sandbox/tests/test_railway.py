"""The Railway backend (D390), with Railway's GraphQL API replaced.

The stand-in answers the calls the backend makes. A command sent to `sandboxExec` runs
in a local `sh` with the workspace directory moved to a temporary one, so what a skill
script sees and what a file transfer writes are checked for real, not by their shape.
"""

from __future__ import annotations

import base64
import os
import shlex
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from awp_sandbox import main
from awp_sandbox.config import settings
from awp_sandbox.manager import ExecRequest, SandboxError, WriteRequest
from awp_sandbox.railway import (
    RailwaySandboxManager,
    shell_command,
    template_instructions,
)

WORKSPACE_FILES = Path(__file__).resolve().parents[1] / "workspace"


@dataclass
class FakeRailway:
    """`sandboxTemplateBuild`, `sandboxCreate`, `sandbox`, `sandboxDestroy` and `sandboxExec`,
    in memory."""

    workspace: Path | None = None
    environment_id: str = "env-1"
    statuses: list[str] = field(default_factory=lambda: ["CREATING", "RUNNING"])
    template_statuses: list[str] = field(default_factory=lambda: ["BUILDING", "READY"])
    templates_built: list[str] = field(default_factory=list)
    exec_answer: dict[str, Any] | None = None
    created: list[dict[str, Any]] = field(default_factory=list)
    destroyed: list[str] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)

    async def call(self, query: str, variables: dict[str, Any], wait_seconds: float = 0) -> Any:
        if "sandboxTemplateBuild" in query:
            return {"sandboxTemplateBuild": self._template(query, variables)}
        if "sandboxCreate" in query:
            self.created.append(variables["input"])
            return {"sandboxCreate": {"id": f"sb-{len(self.created)}", "status": "CREATING"}}
        if "sandboxDestroy" in query:
            self.destroyed.append(variables["id"])
            return {"sandboxDestroy": {"id": variables["id"]}}
        if "sandboxExec" in query:
            self.commands.append(variables["command"])
            return {"sandboxExec": self.exec_answer or self._run(variables["command"])}
        return {"sandbox": {"status": self.statuses.pop(0) if self.statuses else "RUNNING"}}

    def _template(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        if query.startswith("mutation"):
            self.templates_built.append(variables["input"]["instructions"])
            return {"id": "tpl-1", "status": "PENDING"}
        return {"status": self.template_statuses.pop(0) if self.template_statuses else "READY"}

    def _run(self, command: str) -> dict[str, Any]:
        """The command in a local shell, `/workspace` being the test's directory."""
        assert self.workspace is not None
        local = command.replace("cd /workspace", f"cd {shlex.quote(str(self.workspace))}", 1)
        done = subprocess.run(["sh", "-c", local], capture_output=True, text=True, check=False)
        return {
            "exitCode": done.returncode,
            "stdout": done.stdout,
            "stderr": done.stderr,
            "timedOut": False,
            "truncated": False,
        }


@pytest.fixture(autouse=True)
def quick_polls(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr("awp_sandbox.railway.READY_POLL_SECONDS", 0)
    monkeypatch.setattr("awp_sandbox.railway.TEMPLATE_POLL_SECONDS", 0)
    settings.cache_clear()
    yield
    settings.cache_clear()


def _manager(fake: FakeRailway) -> RailwaySandboxManager:
    return RailwaySandboxManager(api=fake, workspace=WORKSPACE_FILES)  # type: ignore[arg-type]


def test_the_template_carries_the_workspace_lock_files_byte_for_byte() -> None:
    steps = template_instructions(WORKSPACE_FILES).splitlines()

    for name in ("pyproject.toml", "uv.lock", "package.json", "package-lock.json"):
        [step] = [s for s in steps if s.endswith(f"/{name}")]
        encoded = step.split(" ", 2)[1]
        assert base64.b64decode(encoded) == (WORKSPACE_FILES / name).read_bytes()
    assert any("uv sync --frozen" in step for step in steps)
    assert any("npm ci --omit=dev" in step for step in steps)


def test_every_argument_reaches_the_command_as_one_argument() -> None:
    argv = ["python", "run.py", "a b", "$(touch pwned)", "'; rm -rf /'"]

    line = shell_command(argv)

    assert line.startswith("cd /workspace && ")
    assert shlex.split(line.split(" && exec ", 1)[1]) == argv


async def test_a_run_keeps_its_sandbox_and_a_new_run_gets_a_new_one() -> None:
    fake = FakeRailway()
    manager = _manager(fake)

    first = await manager.create("run-1")
    again = await manager.create("run-1")
    other = await manager.create("run-2")

    assert first.sandbox_id == again.sandbox_id == "sb-1"
    assert other.sandbox_id == "sb-2"
    assert fake.created[0]["networkIsolation"] == "ISOLATED"
    assert fake.created[0]["template"]["instructions"] == manager.instructions


async def test_the_template_is_built_once_before_the_first_sandbox() -> None:
    fake = FakeRailway()
    manager = _manager(fake)

    await manager.create("run-1")
    await manager.create("run-2")

    assert fake.templates_built == [manager.instructions]
    assert fake.template_statuses == []


async def test_a_template_that_fails_to_build_is_refused_and_no_sandbox_is_made() -> None:
    fake = FakeRailway(template_statuses=["BUILDING", "FAILED"])

    with pytest.raises(SandboxError, match="failed to build"):
        await _manager(fake).create("run-1")
    assert fake.created == []


async def test_a_sandbox_that_fails_to_start_is_refused() -> None:
    fake = FakeRailway(statuses=["CREATING", "FAILED"])

    with pytest.raises(SandboxError, match="FAILED"):
        await _manager(fake).create("run-1")


async def test_a_warm_sandbox_is_claimed_before_a_new_one_is_made(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SANDBOX_WARM_POOL", "1")
    fake = FakeRailway()
    manager = _manager(fake)

    assert await manager.ensure_warm_pool() == 1
    sandbox = await manager.create("run-1")

    assert sandbox.sandbox_id == "sb-1"
    assert len(fake.created) == 1
    assert await manager.ensure_warm_pool() == 1


async def test_destroying_a_run_destroys_only_its_sandboxes() -> None:
    fake = FakeRailway()
    manager = _manager(fake)
    await manager.create("run-1")
    await manager.create("run-2")

    assert await manager.destroy_for_run("run-1") == 1
    assert fake.destroyed == ["sb-1"]
    assert (await manager.create("run-2")).sandbox_id == "sb-2"


def _answer(exit_code: int = 0, *, timed_out: bool = False, truncated: bool = False) -> Any:
    return {
        "exitCode": exit_code,
        "stdout": "o",
        "stderr": "e",
        "timedOut": timed_out,
        "truncated": truncated,
    }


@pytest.mark.parametrize(
    ("answer", "exit_code", "timed_out"),
    [
        (_answer(3), 3, False),
        (_answer(timed_out=True), 124, True),
        (_answer(truncated=True), 1, False),
    ],
)
async def test_an_exec_reports_what_railway_answered(
    answer: dict[str, Any], exit_code: int, timed_out: bool
) -> None:
    fake = FakeRailway(exec_answer=answer)

    result = await _manager(fake).execute("sb-1", ExecRequest(command=["true"]))

    assert (result.exit_code, result.timed_out) == (exit_code, timed_out)


@pytest.mark.skipif(os.name != "posix", reason="runs the command in a local POSIX shell")
async def test_a_file_crosses_into_the_workspace_and_back_byte_for_byte(tmp_path: Path) -> None:
    fake = FakeRailway(workspace=tmp_path)
    manager = _manager(fake)
    # Two chunks, with bytes a shell would interpret if they reached the script.
    content = bytes(range(256)) * 400 + b"$(touch pwned) ' \" `x`"
    path = "skills/a b/it's.bin"
    encoded = base64.b64encode(content).decode()

    written = await manager.write_file("sb-1", WriteRequest(path=path, content_base64=encoded))
    read = await manager.read_file("sb-1", path)

    assert written.exit_code == 0, written.stderr
    assert (tmp_path / path).read_bytes() == content
    assert base64.b64decode(read.stdout) == content
    assert not (tmp_path / "pwned").exists()
    assert len(fake.commands) == 3


def test_the_railway_backend_is_chosen_by_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SANDBOX_BACKEND", "railway")
    monkeypatch.setenv("RAILWAY_API_TOKEN", "token")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "env-1")
    monkeypatch.setenv("SANDBOX_WORKSPACE_FILES", str(WORKSPACE_FILES))

    assert isinstance(main.build_manager(), RailwaySandboxManager)


def test_the_railway_backend_needs_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SANDBOX_BACKEND", "railway")
    monkeypatch.delenv("RAILWAY_API_TOKEN", raising=False)

    with pytest.raises(SandboxError, match="RAILWAY_API_TOKEN"):
        main.build_manager()
