"""A granted skill is listed, then loaded and its files read when the model asks (D377).

The object store is a stand-in (`FakeS3`); an uploaded skill's file is fetched through the
same bounded fetch a run's start uses.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from pydantic_ai import ModelRetry, RunContext

from awp_agent.clients import object_store
from awp_agent.config import settings
from awp_agent.mission.deps import MissionDeps, SkillDoc
from awp_agent.mission.skill_files import skill_file_read, skill_load, skills_index
from tests.mission.test_uploaded_skills import FakeS3

ROLES = """# Roles

<a id="op-get-roles-getallroles"></a>
### GET `Roles/GetAllRoles`

- **Invoke:** {"method":"GET","path":"Roles/GetAllRoles"}

<a id="op-post-roles-insertrole"></a>
### POST `Roles/insertRole`

- **Invoke:** {"method":"POST","path":"Roles/insertRole"}

## Notes

Roles are cached for a minute.
"""

USERS = SkillDoc(
    name="portal-users",
    description="Users, roles and privileges of the portal.",
    instructions="# Skill: portal-users\nFind the user, then read its roles.",
    package_ref="skills/portal-users/1.1.0",
    files=["SKILL.md", "references/Roles.md"],
)
PORTAL = SkillDoc(
    name="portal",
    description="How to call the portal.",
    instructions="# Skill: portal",
    package_ref="skills/portal/1.0.0",
    files=["SKILL.md", "references/invoke-tool.md"],
)


def _context(skills: list[SkillDoc] | None = None) -> RunContext[MissionDeps]:
    deps = MissionDeps(
        run_id="run-1",
        person_id="person-1",
        mcp_token="model-token",
        route="reasoning-default",
        skills=[USERS, PORTAL] if skills is None else skills,
    )
    return cast(RunContext[MissionDeps], SimpleNamespace(deps=deps))


@pytest.fixture(autouse=True)
def store(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    fake = FakeS3(
        {
            "portal-users/1.1.0/SKILL.md": b"---\nname: portal-users\n---\n",
            "portal-users/1.1.0/references/Roles.md": ROLES.encode(),
            "portal/1.0.0/SKILL.md": b"---\nname: portal\n---\n",
            "portal/1.0.0/references/invoke-tool.md": b"Pass method and path.",
        }
    )
    monkeypatch.setattr(object_store, "client", lambda: fake)
    return fake


def test_the_instructions_list_each_skill_by_name_and_description_not_its_body() -> None:
    index = skills_index(_context().deps)

    assert "- `portal-users`: Users, roles and privileges of the portal." in index
    assert "skill_load" in index
    assert "Find the user" not in index
    assert skills_index(_context(skills=[]).deps) == ""


async def test_loading_a_skill_returns_its_body_and_its_files() -> None:
    loaded = await skill_load(_context(), "portal-users")

    assert loaded["instructions"] == USERS.instructions
    assert loaded["files"] == ["SKILL.md", "references/Roles.md"]


async def test_a_skill_that_is_not_granted_is_named_back_with_the_granted_ones() -> None:
    with pytest.raises(ModelRetry, match=r"'manageportal-mcp' is not a granted skill.*portal"):
        await skill_load(_context(), "manageportal-mcp")


async def test_a_reference_is_read_from_the_stored_package() -> None:
    read = await skill_file_read(_context(), "portal-users", "references/Roles.md")

    assert read["ok"] is True
    assert read["text"] == ROLES
    assert "next_offset" not in read


async def test_a_link_s_anchor_returns_only_that_section() -> None:
    read = await skill_file_read(
        _context(), "portal-users", "references/Roles.md#op-get-roles-getallroles"
    )

    assert read["text"].startswith('<a id="op-get-roles-getallroles"></a>')
    assert "Roles/GetAllRoles" in read["text"]
    assert "insertRole" not in read["text"]


async def test_a_heading_s_slug_is_an_anchor_too_and_a_missing_one_reads_the_whole_file() -> None:
    notes = await skill_file_read(_context(), "portal-users", "references/Roles.md#notes")
    assert notes["text"] == "## Notes\n\nRoles are cached for a minute.\n"

    missing = await skill_file_read(_context(), "portal-users", "references/Roles.md#nowhere")
    assert missing["text"] == ROLES
    assert "no section #nowhere" in missing["note"]


async def test_a_link_into_another_granted_skill_reads_that_skill_s_file() -> None:
    read = await skill_file_read(_context(), "portal-users", "../portal/references/invoke-tool.md")

    assert (read["skill"], read["path"], read["text"]) == (
        "portal",
        "references/invoke-tool.md",
        "Pass method and path.",
    )


@pytest.mark.parametrize(
    "path",
    ["references/Other.md", "../../etc/passwd", "/etc/passwd", "../unknown/SKILL.md"],
)
async def test_only_a_file_a_granted_package_lists_is_read(path: str) -> None:
    with pytest.raises(ModelRetry):
        await skill_file_read(_context(), "portal-users", path)


async def test_a_long_file_is_read_in_parts(store: FakeS3) -> None:
    store.objects["portal-users/1.1.0/references/Roles.md"] = b"x" * 70_000

    first = await skill_file_read(_context(), "portal-users", "references/Roles.md")
    rest = await skill_file_read(
        _context(), "portal-users", "references/Roles.md", first["next_offset"]
    )

    assert len(first["text"]) + len(rest["text"]) == 70_000
    assert "next_offset" not in rest


async def test_a_bundled_skill_s_file_is_read_from_the_image(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "writing" / "references").mkdir(parents=True)
    (tmp_path / "writing" / "references" / "tone.md").write_text("Plain words.")
    monkeypatch.setattr(settings(), "skills_path", str(tmp_path))
    bundled = SkillDoc(
        name="writing", description="", instructions="", files=["references/tone.md"]
    )

    read = await skill_file_read(_context(skills=[bundled]), "writing", "references/tone.md")

    assert read["text"] == "Plain words."


async def test_a_package_gone_from_the_store_is_reported_not_raised(store: FakeS3) -> None:
    store.objects.clear()

    read = await skill_file_read(_context(), "portal-users", "references/Roles.md")

    assert read == {"ok": False, "reason": "references/Roles.md of portal-users could not be read."}
