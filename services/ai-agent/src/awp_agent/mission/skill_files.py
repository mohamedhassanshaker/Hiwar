"""A granted skill's body and files, read when the model needs them (D377).

The instructions list each granted skill by name and description. `skill_load` returns a
skill's body and the files it ships; `skill_file_read` returns one of those files, or the
section a link's `#anchor` names. That is the Agent Skills standard's progressive
disclosure: a skill costs its description until a task needs it, and the references a
`SKILL.md` links to reach the model at all. Before, every body went out on every model call
and no reference ever did, so a model told to "open references/X.md" guessed instead.

The library's own `load_capability` cannot run under Temporal (D127), so these are a
`FunctionToolset`: each call runs as an activity, where the object store may be read. The
bodies were read before the mission started (`skills.py`); only a file is fetched here.
Pinning a skill to the agent is the grant, so the tools need none of their own.
"""

from __future__ import annotations

import asyncio
import posixpath
import re
import tempfile
from pathlib import Path
from typing import Any

from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

from awp_agent.config import settings
from awp_agent.harness.tools import builtin
from awp_agent.harness.types import SkillRef
from awp_agent.logging import logger
from awp_agent.mission.deps import MissionDeps, SkillDoc
from awp_agent.mission.skills import fetch_package

log = logger("awp_agent.mission.skill_files")

SKILLS_TOOLSET_ID = "awp-skills"
SKILL_LOAD_TOOL = builtin.SKILL_LOAD
SKILL_FILE_READ_TOOL = builtin.SKILL_FILE_READ

#: How much of a file one read returns; `next_offset` continues it.
MAX_READ_CHARS = 60_000

#: An HTML anchor a generated reference puts before a heading: `<a id="op-get-roles"></a>`.
_ANCHOR = re.compile(r"""<a\s+(?:id|name)=["']([^"']+)["']""")


def offered(deps: MissionDeps) -> bool:
    """Whether the run has a skill to load."""
    return bool(deps.skills)


def skills_index(deps: MissionDeps) -> str:
    """The granted skills as the model first sees them: a name and when to use it."""
    if not deps.skills:
        return ""
    listed = "\n".join(f"- `{skill.name}`: {skill.description}" for skill in deps.skills)
    return (
        "## Skills\n"
        "Each skill is the instructions for one kind of task. Before you act on a task a "
        "skill's description covers, load it with `skill_load` and follow it. Open the "
        "files it links to with `skill_file_read`, passing the link as written, rather "
        "than guessing what they say.\n" + listed
    )


def _granted(deps: MissionDeps, name: str) -> SkillDoc:
    skill = next((doc for doc in deps.skills if doc.name == name), None)
    if skill is None:
        named = [doc.name for doc in deps.skills]
        raise ModelRetry(f"{name!r} is not a granted skill. These are: {named}.")
    return skill


async def skill_load(ctx: RunContext[MissionDeps], skill: str) -> dict[str, Any]:
    """Load a granted skill: its instructions, and the files you can open from it.

    Args:
        skill: The skill's name, as the Skills list gives it.
    """
    doc = _granted(ctx.deps, skill.strip())
    return {"skill": doc.name, "instructions": doc.instructions, "files": doc.files}


async def skill_file_read(
    ctx: RunContext[MissionDeps], skill: str, path: str, offset: int = 0
) -> dict[str, Any]:
    """Read a file a granted skill ships, such as a reference its instructions link to.

    Args:
        skill: The skill whose instructions hold the link.
        path: The link as written, relative to that skill: `references/Roles.md`,
            `references/Roles.md#op-get-roles` for one section, or
            `../other-skill/references/x.md` for a file of another granted skill.
        offset: Where to continue a long file, from the `next_offset` of the last read.
    """
    doc, relative, anchor = _locate(ctx.deps, skill.strip(), path.strip())
    data = await asyncio.to_thread(_read, doc, relative)
    if data is None:
        log.warning("skills.file_unread", run_id=ctx.deps.run_id, skill=doc.name, path=relative)
        return {"ok": False, "reason": f"{relative} of {doc.name} could not be read."}
    try:
        text = data.decode()
    except UnicodeDecodeError:
        return {"ok": False, "reason": f"{relative} is not a text file."}
    found: dict[str, Any] = {"ok": True, "skill": doc.name, "path": relative}
    if anchor:
        section = _section(text, anchor)
        if section is None:
            found["note"] = f"There is no section #{anchor}; this is the whole file."
        text = section or text
    found["text"] = text[offset : offset + MAX_READ_CHARS]
    if offset + MAX_READ_CHARS < len(text):
        found["next_offset"] = offset + MAX_READ_CHARS
    return found


def _locate(deps: MissionDeps, skill: str, path: str) -> tuple[SkillDoc, str, str]:
    """The skill and file a link names, resolved from the skill that holds it.

    Only a file the skill's package lists is read, so a path cannot leave a package.
    """
    _granted(deps, skill)
    target, _, anchor = path.partition("#")
    owner, _, relative = posixpath.normpath(posixpath.join(skill, target)).partition("/")
    doc = _granted(deps, owner)
    if relative not in doc.files:
        raise ModelRetry(f"{doc.name} has no file {relative!r}. Its files are: {doc.files}.")
    return doc, relative, anchor


def _read(doc: SkillDoc, relative: str) -> bytes | None:
    """One file's bytes, from the object store or the bundle; `None` when it cannot be read.

    An uploaded package is fetched whole, through the same bounds and checks as a run's
    start (at most 5 MB), so a package stored inside its zip's folder reads the same way.
    """
    if not doc.package_ref:
        bundled = Path(settings().skills_path) / doc.name / relative
        return bundled.read_bytes() if bundled.is_file() else None
    reference = SkillRef(
        id=doc.name, name=doc.name, description="", path="", package_ref=doc.package_ref
    )
    with tempfile.TemporaryDirectory(prefix="awp-skill-file-") as library:
        if not fetch_package(reference, Path(library)):
            return None
        file = Path(library) / doc.name / relative
        return file.read_bytes() if file.is_file() else None


def _section(text: str, anchor: str) -> str | None:
    """The part of a Markdown file a link's `#anchor` names, up to the next section.

    The anchor is an `<a id>` before a heading, or a heading's GitHub-style slug.
    """
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if _names_anchor(line, anchor)), None)
    if start is None:
        return None
    heading = next((i for i in range(start, len(lines)) if lines[i].startswith("#")), start)
    level = _level(lines[heading]) or 6
    end = next(
        (
            i
            for i in range(heading + 1, len(lines))
            if _ANCHOR.match(lines[i].strip()) or 0 < _level(lines[i]) <= level
        ),
        len(lines),
    )
    return "".join(lines[start:end])


def _names_anchor(line: str, anchor: str) -> bool:
    found = _ANCHOR.match(line.strip())
    if found:
        return found.group(1) == anchor
    return _level(line) > 0 and _slug(line) == anchor.lower()


def _level(line: str) -> int:
    """A Markdown heading's level, or 0 for any other line."""
    marks = len(line) - len(line.lstrip("#"))
    return marks if 0 < marks <= 6 and line[marks : marks + 1] == " " else 0


def _slug(heading: str) -> str:
    """A heading's anchor as GitHub writes it: lower case, punctuation gone, `-` for spaces."""
    text = heading.lstrip("#").strip().lower()
    return re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", text))


def skills_toolset() -> FunctionToolset[MissionDeps]:
    """The two tools, under the stable id Temporal identifies their activities by."""
    toolset: FunctionToolset[MissionDeps] = FunctionToolset(id=SKILLS_TOOLSET_ID)
    toolset.add_function(skill_load, takes_ctx=True)
    toolset.add_function(skill_file_read, takes_ctx=True)
    return toolset
