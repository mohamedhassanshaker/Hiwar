"""The Agent Skills loader contract: the index is cheap, the body is loaded on demand."""

from __future__ import annotations

from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from awp_agent.harness.skills.loader import (
    SkillNotFoundError,
    discover,
    fetch_skill_body,
    index,
    load,
)
from awp_agent.harness.types import SkillRef

SKILL = """\
---
name: Expense policy
description: How to check an expense claim against the Tahseel policy.
---

# Expense policy

Claims over 5,000 AED need a manager's approval.
"""


@pytest.fixture
def skills_root(tmp_path: Path) -> Path:
    """Two skills on disk, as `packages/skills-bundled/` lays them out."""
    for folder, name in (("expense-policy", "Expense policy"), ("arabic-style", "Arabic style")):
        skill_dir = tmp_path / folder
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            SKILL.replace("Expense policy", name), encoding="utf-8"
        )
    return tmp_path


def test_discovery_reads_only_the_frontmatter(skills_root: Path) -> None:
    """The skill index carries the name and the description, never the body."""
    skills = discover(skills_root)
    assert [skill.id for skill in skills] == ["arabic-style", "expense-policy"]
    listing = index(skills)
    assert "Expense policy" in listing
    assert "5,000 AED" not in listing


def test_an_empty_index_says_so(skills_root: Path) -> None:
    """An agent with no skills gets a sentence, not an empty heading."""
    assert "No skills" in index([])


def test_a_skill_body_is_loaded_on_demand(skills_root: Path) -> None:
    """`load_skill` returns the body without its frontmatter."""
    skills = discover(skills_root)
    body = load("expense-policy", skills)
    assert body.startswith("# Expense policy")
    assert "description:" not in body


def test_a_skill_outside_the_index_is_refused(skills_root: Path) -> None:
    """An agent may only load a skill its version attached."""
    with pytest.raises(SkillNotFoundError):
        load("payroll", discover(skills_root))


def _uploaded_skill(skill_id: str = "tahseel-docx-builder") -> SkillRef:
    """An organisation's own skill, as the console attaches it: no local folder, `path` is
    the `bucket/key` reference its own `putObject` returned."""
    return SkillRef(
        id=skill_id,
        name="Tahseel docx builder",
        description="Generate a Word document in the Tahseel template.",
        path=f"skills/{skill_id}/1.0.0",
    )


def test_an_uploaded_skill_s_body_comes_from_object_storage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A skill this image never carried still has a body, fetched from where the console
    actually stored it — the bug being fixed: it used to be looked for on local disk only."""
    seen: dict[str, object] = {}

    class FakeBody:
        def read(self) -> bytes:
            return SKILL.encode("utf-8")

    class FakeS3:
        def get_object(self, **kwargs: object) -> dict[str, object]:
            seen.update(kwargs)
            return {"Body": FakeBody()}

    monkeypatch.setattr("awp_agent.clients.object_store.client", lambda: FakeS3())

    body = fetch_skill_body(_uploaded_skill())

    assert body is not None
    assert body.startswith("# Expense policy")
    assert seen == {"Bucket": "skills", "Key": "tahseel-docx-builder/1.0.0/SKILL.md"}


def test_an_uploaded_skill_missing_from_storage_fails_gracefully(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A deleted or never-written object is `None` for the caller to say so, not a crashed
    activity — the exact failure the Activity task error in the room traced back to."""

    class FakeS3:
        def get_object(self, **kwargs: object) -> dict[str, object]:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "not found"}}, "GetObject")

    monkeypatch.setattr("awp_agent.clients.object_store.client", lambda: FakeS3())

    assert fetch_skill_body(_uploaded_skill()) is None


def test_a_skill_with_no_object_storage_reference_is_not_fetched(tmp_path: Path) -> None:
    """A skill naming neither a local folder nor a `bucket/key` has nothing to fetch."""
    assert fetch_skill_body(SkillRef(id="ghost", name="Ghost", description="", path="")) is None
