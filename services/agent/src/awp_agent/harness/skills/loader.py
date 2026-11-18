"""The Agent Skills loader.

A skill is a folder with a `SKILL.md` whose YAML frontmatter carries `name`, `description`
and, when the skill calls tools, `allowed-tools`.
Only the frontmatter goes into the skill index that every model step sees; the body is read
only when the model calls `load_skill`, so a large skill library costs almost no context.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from botocore.exceptions import ClientError

from awp_agent.clients import object_store
from awp_agent.config import settings
from awp_agent.harness.types import SkillRef
from awp_agent.logging import logger

FRONTMATTER_FENCE = "---"

log = logger("awp_agent.harness.skills.loader")


class SkillNotFoundError(LookupError):
    """The run asked for a skill that is not in its index."""


def _declared_tools(frontmatter: dict[str, object]) -> list[str]:
    """The `allowed-tools` the skill declares, as a list however it was written.

    YAML allows both a list and a comma-separated string, and a skill author writing one
    tool rarely reaches for a list. Accepting both costs three lines and avoids a skill
    silently declaring nothing.
    """
    declared = frontmatter.get("allowed-tools") or frontmatter.get("allowed_tools")
    if isinstance(declared, str):
        return [part.strip() for part in declared.split(",") if part.strip()]
    if isinstance(declared, list):
        return [str(part).strip() for part in declared if str(part).strip()]
    return []


def _split_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """Split a `SKILL.md` into its YAML frontmatter and its body."""
    if not text.startswith(FRONTMATTER_FENCE):
        return {}, text
    end = text.find(f"\n{FRONTMATTER_FENCE}", len(FRONTMATTER_FENCE))
    if end == -1:
        return {}, text
    header = text[len(FRONTMATTER_FENCE) : end]
    body = text[end + len(FRONTMATTER_FENCE) + 1 :]
    parsed = yaml.safe_load(header) or {}
    if not isinstance(parsed, dict):
        return {}, body
    return parsed, body.lstrip("\n")


def discover(root: Path) -> list[SkillRef]:
    """Every skill under a root folder, in name order."""
    found: list[SkillRef] = []
    for skill_file in sorted(root.glob("*/SKILL.md")):
        frontmatter, _ = _split_frontmatter(skill_file.read_text(encoding="utf-8"))
        name = str(frontmatter.get("name") or skill_file.parent.name)
        found.append(
            SkillRef(
                id=skill_file.parent.name,
                name=name,
                description=str(frontmatter.get("description") or ""),
                declared_tools=_declared_tools(frontmatter),
                path=str(skill_file.parent),
            )
        )
    return found


def index(skills: list[SkillRef]) -> str:
    """The skill index block: one line per skill, name and description only."""
    if not skills:
        return "No skills are attached to this agent."
    return "\n".join(f"- `{skill.id}` — {skill.name}: {skill.description}" for skill in skills)


def folder_for(skill: SkillRef) -> Path:
    """Where a skill's `SKILL.md` is.

    A run names the skills its agent was published with; where their bodies live is this
    image's business. `path` is set when the skills were discovered on disk, and is a folder
    under the skills root otherwise — the console has no way to know this filesystem, and a
    path it guessed would be a run that fails the moment the model reaches for a skill.
    """
    if skill.path:
        candidate = Path(skill.path)
        if (candidate / "SKILL.md").exists():
            return candidate
    return Path(settings().skills_path) / skill.id


def read_skill(folder: Path) -> str:
    """The body of one skill folder's `SKILL.md`, without its frontmatter."""
    _, body = _split_frontmatter((folder / "SKILL.md").read_text(encoding="utf-8"))
    return body


def fetch_skill_body(skill: SkillRef) -> str | None:
    """One skill's instructions, from this image's own copy or from object storage.

    A bundled skill's `SKILL.md` is a file in this image, at `folder_for`'s path. An
    organisation's own skill has no place in the image at all: the console stores it in the
    `skills` bucket, under the reference its own `putObject` returned — `bucket/key` — which
    is exactly what `path` carries for one of these. Either way the model asked for this
    skill by its id, so a body that cannot be found is `None` for the caller to say
    gracefully, not an activity that crashes the run.
    """
    folder = folder_for(skill)
    if (folder / "SKILL.md").exists():
        return read_skill(folder)

    if "/" not in skill.path:
        return None
    bucket, _, prefix = skill.path.partition("/")
    try:
        answer = object_store.client().get_object(Bucket=bucket, Key=f"{prefix}/SKILL.md")
        _, body = _split_frontmatter(answer["Body"].read().decode("utf-8"))
        return body
    except ClientError as problem:
        log.warning("skill_body_fetch_failed", extra={"skill": skill.id, "problem": str(problem)})
        return None


def load(skill_id: str, skills: list[SkillRef]) -> str:
    """The body of one skill, for the `load_skill` tool."""
    for skill in skills:
        if skill.id == skill_id:
            body = fetch_skill_body(skill)
            if body is None:
                raise SkillNotFoundError(f"{skill_id}'s body could not be found")
            return body
    raise SkillNotFoundError(f"{skill_id} is not in this run's skill index")
