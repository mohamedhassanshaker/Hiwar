"""An organisation's uploaded skill reaches a run the way a bundled one does (D127).

The platform sends an uploaded skill with its object-store reference only when its version
is published and its scan passed; these cases are about what the API process does with it.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from botocore.exceptions import ClientError

from awp_agent.clients import object_store
from awp_agent.harness.types import RunInput, SkillRef
from awp_agent.mission.runtime import _instructions, mission_deps
from awp_agent.mission.skills import MAX_PACKAGE_BYTES, fetch_package, granted_skills

BUNDLE = Path(__file__).resolve().parents[4] / "packages" / "skills-bundled"

CLAIM_CHECK = b"""---
name: claim-check
description: Check an expense claim against the policy.
---

# Claim check

Every claim over 5,000 AED needs the finance manager's approval.
"""


class FakeS3:
    """The two calls the fetch makes, over objects held in memory, in the `skills` bucket."""

    def __init__(self, objects: dict[str, bytes], sizes: dict[str, int] | None = None) -> None:
        self.objects = objects
        self.sizes = sizes or {}

    def get_paginator(self, operation: str) -> FakeS3:
        assert operation == "list_objects_v2"
        return self

    def paginate(self, Bucket: str, Prefix: str) -> Iterator[dict[str, Any]]:  # noqa: N803
        assert Bucket == "skills"
        yield {
            "Contents": [
                {"Key": key, "Size": self.sizes.get(key, len(body))}
                for key, body in self.objects.items()
                if key.startswith(Prefix)
            ]
        }

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        assert Bucket == "skills"
        return {"Body": io.BytesIO(self.objects[Key])}


def uploaded(name: str = "claim-check") -> SkillRef:
    """An uploaded skill as the platform sends it: its `bucket/prefix` reference."""
    return SkillRef(
        id="sv-1", name=name, description="", path=name, package_ref=f"skills/{name}/1.0.0"
    )


@pytest.mark.skipif(os.name != "posix", reason="the harness's LocalWorkspaceBackend is POSIX only")
async def test_an_uploaded_skill_reaches_the_instructions_beside_a_bundled_one(
    monkeypatch: pytest.MonkeyPatch, run_input: RunInput
) -> None:
    store = FakeS3(
        {
            "claim-check/1.0.0/SKILL.md": CLAIM_CHECK,
            "claim-check/1.0.0/references/policy.md": b"The per-diem is AED 350.",
        }
    )
    monkeypatch.setattr(object_store, "client", lambda: store)
    bundled = SkillRef(id="sv-2", name="bilingual-writing", description="", path="")

    skills = await granted_skills([bundled, uploaded()], str(BUNDLE))

    assert [skill.name for skill in skills] == ["bilingual-writing", "claim-check"]
    deps = mission_deps(run_input, skills)
    instructions = _instructions(cast(Any, SimpleNamespace(deps=deps)))
    assert "# Skill: claim-check" in instructions
    assert "5,000 AED needs the finance manager's approval" in instructions


@pytest.mark.skipif(os.name != "posix", reason="the harness's LocalWorkspaceBackend is POSIX only")
async def test_an_uploaded_skill_s_scripts_and_package_travel_with_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """What the run's sandbox is given: which scripts it may run, and where the files are."""
    store = FakeS3(
        {
            "claim-check/1.0.0/SKILL.md": CLAIM_CHECK,
            "claim-check/1.0.0/scripts/check.py": b"print('ok')",
            "claim-check/1.0.0/scripts/lib/rules.py": b"RULES = []",
            "claim-check/1.0.0/references/policy.md": b"AED 350.",
        }
    )
    monkeypatch.setattr(object_store, "client", lambda: store)

    [skill] = await granted_skills([uploaded()], str(BUNDLE))

    assert skill.scripts == ["scripts/check.py", "scripts/lib/rules.py"]
    assert skill.package_ref == "skills/claim-check/1.0.0"


def test_a_package_stored_inside_its_own_folder_is_laid_out_at_the_skill_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """An import before D206 kept the zip's top folder, as `tahseel-pptx-builder` is stored on
    the cluster; the loader reads `<library>/<name>/SKILL.md`, so the folder is dropped."""
    store = FakeS3(
        {
            "claim-check/1.0.0/claim-check/SKILL.md": CLAIM_CHECK,
            "claim-check/1.0.0/claim-check/references/policy.md": b"AED 350.",
        }
    )
    monkeypatch.setattr(object_store, "client", lambda: store)

    assert fetch_package(uploaded(), tmp_path)

    assert (tmp_path / "claim-check" / "SKILL.md").read_bytes() == CLAIM_CHECK
    assert (tmp_path / "claim-check" / "references" / "policy.md").exists()


@pytest.mark.parametrize("key", ["../../escape.md", "/escape.md", "notes/../../../escape.md"])
def test_a_package_with_a_key_leaving_it_is_refused_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, key: str
) -> None:
    store = FakeS3(
        {"claim-check/1.0.0/SKILL.md": CLAIM_CHECK, f"claim-check/1.0.0/{key}": b"escaped"}
    )
    monkeypatch.setattr(object_store, "client", lambda: store)
    library = tmp_path / "library"
    library.mkdir()

    assert fetch_package(uploaded(), library) is False
    assert not (tmp_path / "escape.md").exists()
    assert list(library.iterdir()) == []


def test_a_package_larger_than_the_import_allows_is_refused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store = FakeS3(
        {"claim-check/1.0.0/SKILL.md": CLAIM_CHECK, "claim-check/1.0.0/data.csv": b"1"},
        sizes={"claim-check/1.0.0/data.csv": MAX_PACKAGE_BYTES},
    )
    monkeypatch.setattr(object_store, "client", lambda: store)

    assert fetch_package(uploaded(), tmp_path) is False
    assert list(tmp_path.iterdir()) == []


async def test_a_failed_fetch_leaves_the_skill_out_and_the_run_going(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Unreachable(FakeS3):
        def paginate(self, Bucket: str, Prefix: str) -> Iterator[dict[str, Any]]:  # noqa: N803
            raise ClientError({"Error": {"Code": "NoSuchBucket", "Message": "gone"}}, "ListObjects")

    monkeypatch.setattr(object_store, "client", lambda: Unreachable({}))

    assert await granted_skills([uploaded()], "/no/bundle/needed") == []
