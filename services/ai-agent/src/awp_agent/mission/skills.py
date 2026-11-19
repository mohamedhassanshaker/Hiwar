"""A run's granted Agent Skills: bundled ones from the image, uploaded ones from the object
store (D127).

Read by the API process before the mission starts, with the harness's own loader: a
workflow may not do I/O, so the bodies travel in the deps. An uploaded skill's files are
copied from the object store into a temporary library and loaded the same way as the
bundle. A skill that cannot be fetched or loaded is left out and logged rather than
failing the run.
"""

from __future__ import annotations

import asyncio
import posixpath
import re
import shutil
import tempfile
from collections.abc import Collection, Sequence
from dataclasses import replace
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError
from pydantic_ai.workspaces import LocalWorkspaceBackend
from pydantic_ai_harness.skills import Skills

from awp_agent.clients import object_store
from awp_agent.harness.types import SkillRef
from awp_agent.logging import logger
from awp_agent.mission.deps import SkillDoc

log = logger("awp_agent.mission.skills")

#: The import's own limits (`apps/web/src/lib/skill-package.ts`): no stored package is
#: larger, so anything larger is not what the platform stored.
MAX_PACKAGE_BYTES = 5 * 1024 * 1024
MAX_PACKAGE_FILES = 200

#: A registry skill name, which is also the package's folder in the temporary library.
SKILL_NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class PackageRefusedError(ValueError):
    """An uploaded package that is not fetched: a bad reference, a path leaving the
    package, or more than the import allows."""


async def granted_skills(skills: Sequence[SkillRef], bundle: str) -> list[SkillDoc]:
    """The granted skills that load, each with the body the model receives."""
    bundled = {skill.name for skill in skills if not skill.package_ref}
    uploaded = [skill for skill in skills if skill.package_ref]
    docs = await _load(bundle, bundled) if bundled else []
    if uploaded:
        with tempfile.TemporaryDirectory(prefix="awp-skills-") as library:
            fetched = {
                skill.name
                for skill in uploaded
                if await asyncio.to_thread(fetch_package, skill, Path(library))
            }
            if fetched:
                refs = {skill.name: skill.package_ref for skill in uploaded}
                try:
                    docs += [
                        replace(doc, package_ref=refs[doc.name])
                        for doc in await _load(library, fetched)
                    ]
                except (ValueError, OSError) as problem:
                    log.warning("skills.load_failed", skills=sorted(fetched), problem=str(problem))
    return docs


def _files_of(folder: Path) -> list[str]:
    """Every file a skill ships, relative to the skill's folder."""
    return sorted(
        path.relative_to(folder).as_posix() for path in folder.rglob("*") if path.is_file()
    )


async def _load(library: str, names: Collection[str]) -> list[SkillDoc]:
    """The skills among `names` that the harness's loader reads from `library`."""
    catalog = await Skills(".", workspace=LocalWorkspaceBackend(library)).load()
    found = [skill for skill in catalog.skills if skill.name in names and skill.model_invocable]
    missing = sorted(set(names) - {skill.name for skill in found})
    if missing:
        reasons = [
            entry.message
            for entry in catalog.skipped
            if posixpath.basename(posixpath.dirname(entry.path)) in missing
        ]
        log.warning("skills.not_loaded", skills=missing, library=library, reasons=reasons)
    docs = []
    for skill in found:
        files = _files_of(Path(library) / skill.name)
        docs.append(
            SkillDoc(
                name=skill.name,
                description=skill.description,
                instructions=skill.render(),
                scripts=[path for path in files if path.startswith("scripts/")],
                files=files,
            )
        )
    return docs


def fetch_package(skill: SkillRef, library: Path) -> bool:
    """Copy one uploaded skill's files into `library/<name>`. False, and logged, when not.

    Blocking (boto3), so the caller runs it in a thread.
    """
    target = library / skill.name
    try:
        _copy_package(skill, target)
    except (PackageRefusedError, BotoCoreError, ClientError, OSError) as problem:
        shutil.rmtree(target, ignore_errors=True)
        log.warning(
            "skills.fetch_failed",
            skill=skill.name,
            package_ref=skill.package_ref,
            problem=str(problem),
        )
        return False
    return True


def _copy_package(skill: SkillRef, target: Path) -> None:
    """Every object under the skill's `bucket/prefix`, written below `target`.

    Every key is checked before anything is written, so a refused package leaves nothing.
    """
    bucket, _, prefix = (skill.package_ref or "").partition("/")
    prefix = prefix.strip("/")
    if not bucket or not prefix:
        raise PackageRefusedError(f"{skill.package_ref!r} is not a bucket/prefix reference")
    if not SKILL_NAME.fullmatch(skill.name):
        raise PackageRefusedError(f"{skill.name!r} is not a skill name")

    s3 = object_store.client()
    root = target.resolve()
    listing: list[tuple[str, str]] = []
    listed = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{prefix}/"):
        for entry in page.get("Contents", []):
            key = str(entry["Key"])
            relative = key[len(prefix) + 1 :]
            if not relative or relative.endswith("/"):
                continue
            listed += int(entry.get("Size", 0))
            listing.append((key, relative))
            if listed > MAX_PACKAGE_BYTES or len(listing) > MAX_PACKAGE_FILES:
                raise PackageRefusedError(
                    f"the package is larger than {MAX_PACKAGE_BYTES} bytes "
                    f"or {MAX_PACKAGE_FILES} files"
                )
    if not listing:
        raise PackageRefusedError(f"nothing is stored under {skill.package_ref}")

    files: list[tuple[str, Path]] = []
    for key, relative in _unwrapped(listing):
        destination = (root / relative).resolve()
        if destination == root or not destination.is_relative_to(root):
            raise PackageRefusedError(f"{key} leaves the package")
        files.append((key, destination))

    read = 0
    for key, destination in files:
        # Bounded again on the bytes actually read, in case an object grew after the listing.
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read(MAX_PACKAGE_BYTES - read + 1)
        read += len(body)
        if read > MAX_PACKAGE_BYTES:
            raise PackageRefusedError(f"the package is larger than {MAX_PACKAGE_BYTES} bytes")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body)


def _unwrapped(listing: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The package with `SKILL.md` at its root: an import before D206 stored the zip's own
    top folder (`<prefix>/<folder>/SKILL.md`), which the loader would not find."""
    relatives = [relative for _, relative in listing]
    if "SKILL.md" in relatives:
        return listing
    folders = {relative.split("/", 1)[0] for relative in relatives}
    if len(folders) != 1 or not all("/" in relative for relative in relatives):
        return listing
    (folder,) = folders
    if f"{folder}/SKILL.md" not in relatives:
        return listing
    return [(key, relative.split("/", 1)[1]) for key, relative in listing]
