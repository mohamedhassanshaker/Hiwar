"""A skill's scripts run in the run's sandbox, and only a granted skill's own scripts (D209).

The sandbox manager is a stand-in (`sandbox_server.py`); the skill's files come from the
object store through the same fetch the API process uses.
"""

from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic_ai import ModelRetry, RunContext

from awp_agent.clients import object_store, platform_mcp
from awp_agent.mission.deps import MissionDeps, SkillDoc
from awp_agent.mission.sandbox import (
    SKILL_SCRIPT_RUN_TOOL,
    instructions_note,
    skill_script_run,
    workspace_file_read,
    workspace_file_save,
    workspace_file_write,
)
from tests.mission import sandbox_server
from tests.mission.sandbox_server import FakeSandbox
from tests.mission.test_uploaded_skills import FakeS3

DECK = SkillDoc(
    name="deck-builder",
    description="Build a branded deck.",
    instructions="# Skill: deck-builder",
    package_ref="skills/deck-builder/1.0.0",
    scripts=["scripts/build.js"],
)
LOGO = b"\x89PNG\r\n\x1a\n\xff\xfe\x80 not text"


def _context(**overrides: Any) -> RunContext[MissionDeps]:
    base: dict[str, Any] = {
        "run_id": "run-1",
        "person_id": "person-1",
        "mcp_token": "model-token",
        "route": "reasoning-default",
        "granted_tools": [SKILL_SCRIPT_RUN_TOOL],
        "skills": [DECK],
        "context_type": "Room",
        "context_key": "SES-1001",
        "sandbox_url": "http://sandbox-manager",
    }
    deps = MissionDeps(**(base | overrides))
    return cast(RunContext[MissionDeps], SimpleNamespace(deps=deps))


@pytest.fixture
def sandbox(monkeypatch: pytest.MonkeyPatch) -> FakeSandbox:
    store = FakeS3(
        {
            "deck-builder/1.0.0/SKILL.md": b"---\nname: deck-builder\n---\n",
            "deck-builder/1.0.0/scripts/build.js": b"console.log('built')",
            "deck-builder/1.0.0/assets/logo.png": LOGO,
        }
    )
    monkeypatch.setattr(object_store, "client", lambda: store)
    return sandbox_server.install(monkeypatch)


async def test_a_granted_skill_s_script_runs_over_its_own_files(sandbox: FakeSandbox) -> None:
    arguments = ["--spec", "deck.json", "--out", "out/D.pptx"]
    result = await skill_script_run(_context(), "deck-builder", "scripts/build.js", arguments)

    assert result["exit_code"] == 0
    assert sandbox.scripts == [["node", "skills/deck-builder/scripts/build.js", *arguments]]
    # The skill's files are copied in byte for byte, so its images are still images.
    assert sandbox.files["/workspace/skills/deck-builder/assets/logo.png"] == LOGO
    assert result["files"] == ["out/D.pptx"]
    assert sandbox.creates == ["run-1"]


async def test_the_skills_are_copied_into_a_sandbox_once(sandbox: FakeSandbox) -> None:
    script = "/workspace/skills/deck-builder/scripts/build.js"
    await skill_script_run(_context(), "deck-builder", "scripts/build.js")
    copied = len(sandbox.files)
    sandbox.files[script] = b"changed by the script"

    await skill_script_run(_context(), "deck-builder", "scripts/build.js")

    assert len(sandbox.files) == copied
    assert sandbox.files[script] == b"changed by the script"


@pytest.mark.parametrize(
    ("skill", "script"),
    [
        ("deck-builder", "scripts/other.js"),
        ("deck-builder", "../../usr/bin/env"),
        ("not-granted", "scripts/build.js"),
    ],
)
async def test_only_a_script_a_granted_skill_ships_is_run(
    sandbox: FakeSandbox, skill: str, script: str
) -> None:
    with pytest.raises(ModelRetry):
        await skill_script_run(_context(), skill, script)

    assert sandbox.scripts == []
    assert sandbox.creates == []


@pytest.mark.parametrize(
    "path", ["skills/deck-builder/scripts/build.js", "/etc/passwd", "../out.json", "", "."]
)
async def test_a_file_cannot_be_written_into_the_skills_or_outside_the_folder(
    sandbox: FakeSandbox, path: str
) -> None:
    with pytest.raises(ModelRetry):
        await workspace_file_write(_context(), path, "{}")

    assert sandbox.files == {}


async def test_a_written_file_reads_back(sandbox: FakeSandbox) -> None:
    written = await workspace_file_write(_context(), "deck.json", '{"title": "عنوان"}')
    read = await workspace_file_read(_context(), "deck.json")

    assert written == {"ok": True, "path": "deck.json"}
    assert read == {"ok": True, "text": '{"title": "عنوان"}'}


async def test_a_binary_file_is_not_read_as_text(sandbox: FakeSandbox) -> None:
    read = await workspace_file_read(_context(), "skills/deck-builder/assets/logo.png")

    assert read["ok"] is False
    assert "not text" in read["reason"]


async def test_a_made_file_is_saved_against_the_mission_s_record(
    sandbox: FakeSandbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(
        token: str, name: str, arguments: dict[str, Any], url: str | None = None
    ) -> dict[str, str]:
        calls.append((name, arguments))
        return {"artifact_id": "a-1"}

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    await skill_script_run(_context(), "deck-builder", "scripts/build.js", ["--out", "out/D.pptx"])

    saved = await workspace_file_save(_context(), "out/D.pptx", "Tahseel G3 modules")

    assert saved["saved"] is True
    [(name, arguments)] = calls
    assert name == "artifact_create"
    assert arguments["file_name"] == "D.pptx"
    assert arguments["mime_type"].endswith("presentationml.presentation")
    assert base64.b64decode(arguments["content_base64"]) == sandbox.output
    assert (arguments["linked_to_type"], arguments["linked_to_key"]) == ("Room", "SES-1001")


async def test_a_file_type_the_platform_does_not_keep_is_not_saved(sandbox: FakeSandbox) -> None:
    with pytest.raises(ModelRetry):
        await workspace_file_save(_context(), "out/run.sh", "script")


async def test_no_free_sandbox_is_told_to_the_model(sandbox: FakeSandbox) -> None:
    sandbox.unavailable = True

    result = await skill_script_run(_context(), "deck-builder", "scripts/build.js")

    assert result == {
        "ok": False,
        "reason": "The sandbox is not available: no sandbox node is free",
    }


async def test_a_failing_sandbox_manager_is_told_to_the_model_not_the_mission(
    sandbox: FakeSandbox,
) -> None:
    """A 500 raised out of the tool failed the whole mission ("Activity task failed")."""
    sandbox.broken = True

    result = await workspace_file_read(_context(), "deck.json")

    assert result == {"ok": False, "reason": "The sandbox is not available: Internal Server Error"}


def test_the_model_is_told_where_a_skill_s_files_are_only_when_it_can_run_them() -> None:
    assert "`skills/deck-builder/`" in instructions_note(_context().deps)
    assert instructions_note(_context(granted_tools=[]).deps) == ""
    assert instructions_note(_context(skills=[]).deps) == ""
