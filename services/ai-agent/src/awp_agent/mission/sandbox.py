"""Agent Skill scripts, run in the run's own sandbox workspace (D209).

A skill can ship scripts its instructions tell the agent to run (`scripts/build_pptx.js`).
They are uploaded code, so they never run on the worker, which holds the platform's keys:
they run in a Pod the sandbox manager (`services/sandbox`) gives this run alone, with no
service-account token, no secrets and egress only through the proxy.

The model cannot run a command of its own choosing. `skill_script_run` runs a script one of
the run's granted skills ships, with the arguments the model passes; the `workspace_file_*`
tools write the script's input, read a file back, and save a result as an artifact of the
mission's record. Files the model writes cannot land in `skills/`, so it cannot replace a
script with its own code. The harness's `Shell` allows or denies programs by name, which
cannot express "only these scripts", so these are tools rather than that capability.

A `FunctionToolset`: under `TemporalDurability` each call runs as an activity, where the
sandbox manager and the object store may be reached. The sandbox is keyed by the run, so a
call needs no state from the one before it; a sandbox past its deadline is replaced by a
fresh one on the next call, and the skills are copied in again.
"""

from __future__ import annotations

import asyncio
import base64
import posixpath
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset
from temporalio import activity

from awp_agent.config import settings
from awp_agent.harness.tools import builtin
from awp_agent.harness.types import SkillRef
from awp_agent.logging import logger
from awp_agent.mission.deps import MissionDeps, SkillDoc
from awp_agent.mission.skills import fetch_package
from awp_agent.mission.tools import artifact_link, save_artifact

log = logger("awp_agent.mission.sandbox")

SANDBOX_TOOLSET_ID = "awp-sandbox"

SKILL_SCRIPT_RUN_TOOL = builtin.SKILL_SCRIPT_RUN
WORKSPACE_FILE_WRITE_TOOL = builtin.WORKSPACE_FILE_WRITE
WORKSPACE_FILE_READ_TOOL = builtin.WORKSPACE_FILE_READ
WORKSPACE_FILE_SAVE_TOOL = builtin.WORKSPACE_FILE_SAVE
SANDBOX_TOOLS = frozenset(
    {
        SKILL_SCRIPT_RUN_TOOL,
        WORKSPACE_FILE_WRITE_TOOL,
        WORKSPACE_FILE_READ_TOOL,
        WORKSPACE_FILE_SAVE_TOOL,
    }
)

#: The sandbox Pod's working directory (`services/sandbox/src/awp_sandbox/spec.py`).
WORKSPACE = "/workspace"
#: Written last when the skills are in place, so a copy cut short is made again.
READY_MARKER = ".awp-skills-ready"

#: How long one script may run. The manager's own default, said here so the model is told.
SCRIPT_TIMEOUT_SECONDS = 120
#: How much of a script's output, and of a file read back, the model is given.
MAX_OUTPUT_CHARS = 4000
MAX_READ_CHARS = 60_000

#: The program each kind of script runs under; the image carries these (`workspace/`).
_INTERPRETERS = {".py": "python", ".js": "node", ".cjs": "node", ".mjs": "node", ".sh": "sh"}

#: What `artifact_create` accepts, by extension (`apps/web/src/lib/uploads.ts`).
_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".html": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


class SandboxUnavailableError(RuntimeError):
    """The sandbox manager could not give the run a workspace, or it is gone."""


def offered(deps: MissionDeps) -> bool:
    """Whether a granted skill ships a script, which is the only thing the tools are for."""
    return any(skill.scripts for skill in deps.skills)


def uses_sandbox(deps: MissionDeps) -> bool:
    """Whether this run may have been given a sandbox, which its end then releases."""
    return offered(deps) and bool(SANDBOX_TOOLS & set(deps.granted_tools))


def instructions_note(deps: MissionDeps) -> str:
    """How a skill written for a shell reads in this run, for the model."""
    if SKILL_SCRIPT_RUN_TOOL not in deps.granted_tools or not offered(deps):
        return ""
    folders = ", ".join(f"`skills/{skill.name}/`" for skill in deps.skills if skill.scripts)
    return (
        "## Skill files and scripts\n"
        f"The files of these skills are in your sandbox folder: {folders}. There is no shell. "
        "Read a skill's references with `workspace_file_read`, write a script's input with "
        "`workspace_file_write`, run the skill's script with `skill_script_run`, and save "
        "what it makes with `workspace_file_save`; that save is how the person receives a "
        "file. Where a skill names a command, run its script instead with the same "
        "arguments. Read `/home/claude/` and `/mnt/user-data/outputs/` as your sandbox "
        "folder and its `out/`. LibreOffice and its render checks are not available: pass "
        "the script's flag that skips them, and skip the visual check."
    )


# The sandbox manager ---------------------------------------------------------------------


def _client(base_url: str, seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url, timeout=seconds)


async def _call(
    deps: MissionDeps, method: str, path: str, *, seconds: float = 60, **request: Any
) -> Any:
    """One request to the sandbox manager. A 404, or a 5xx after the manager's own retries,
    means the workspace is not there for this call, which the model is told."""
    async with _client(deps.sandbox_url, seconds) as client:
        answer = await client.request(method, path, **request)
    if answer.status_code == 404 or answer.status_code >= 500:
        try:
            detail = str(answer.json().get("detail") or answer.reason_phrase)
        except ValueError:
            detail = answer.reason_phrase
        raise SandboxUnavailableError(detail)
    answer.raise_for_status()
    return answer.json()


async def _exec(
    deps: MissionDeps, sandbox_id: str, command: list[str], seconds: int = 60
) -> dict[str, Any]:
    """Run `command` in the sandbox and return the manager's result (`exit_code`, output).

    The HTTP timeout is 30 seconds longer than the command's own, so the manager reports a
    command that ran out of time rather than the request being cut first.
    """
    result: dict[str, Any] = await _call(
        deps,
        "POST",
        f"/sandboxes/{sandbox_id}/exec",
        seconds=seconds + 30,
        json={"command": command, "timeout_seconds": seconds},
    )
    return result


async def _write(deps: MissionDeps, sandbox_id: str, path: str, data: bytes) -> None:
    """Write `data` to the absolute `path` in the sandbox, raising when the write failed."""
    result = await _call(
        deps,
        "POST",
        f"/sandboxes/{sandbox_id}/files",
        json={"path": path, "content_base64": base64.b64encode(data).decode()},
    )
    if result["exit_code"] != 0:
        raise SandboxUnavailableError(f"{path} could not be written: {result['stderr'].strip()}")


async def _read(deps: MissionDeps, sandbox_id: str, path: str) -> bytes | None:
    """A file's bytes, or `None` when there is no such file."""
    result = await _call(deps, "GET", f"/sandboxes/{sandbox_id}/files", params={"path": path})
    if result["exit_code"] != 0:
        return None
    return base64.b64decode(result["stdout"])


async def _workspace(deps: MissionDeps) -> str:
    """The run's sandbox, with every granted skill that ships a script copied into it."""
    sandbox: dict[str, Any] = await _call(
        deps, "POST", "/sandboxes", seconds=120, json={"run_id": deps.run_id}
    )
    sandbox_id = str(sandbox["sandbox_id"])
    ready = await _exec(deps, sandbox_id, ["test", "-f", f"{WORKSPACE}/{READY_MARKER}"])
    if ready["exit_code"] != 0:
        for skill in deps.skills:
            if skill.scripts:
                await _stage(deps, sandbox_id, skill)
        await _exec(deps, sandbox_id, ["mkdir", "-p", f"{WORKSPACE}/out"])
        await _write(deps, sandbox_id, f"{WORKSPACE}/{READY_MARKER}", b"")
    return sandbox_id


async def _stage(deps: MissionDeps, sandbox_id: str, skill: SkillDoc) -> None:
    """Copy one skill's files into `skills/<name>/`, from the object store or the bundle."""
    with tempfile.TemporaryDirectory(prefix="awp-stage-") as library:
        if skill.package_ref:
            reference = SkillRef(
                id=skill.name,
                name=skill.name,
                description=skill.description,
                path="",
                package_ref=skill.package_ref,
            )
            if not await asyncio.to_thread(fetch_package, reference, Path(library)):
                raise SandboxUnavailableError(f"the files of {skill.name} could not be fetched")
            folder = Path(library) / skill.name
        else:
            folder = Path(settings().skills_path) / skill.name
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                relative = path.relative_to(folder).as_posix()
                target = f"{WORKSPACE}/skills/{skill.name}/{relative}"
                await _write(deps, sandbox_id, target, path.read_bytes())


def _inside(path: str, *, writable: bool) -> str:
    """The absolute path in the sandbox of a path the model named, relative to its folder."""
    clean = posixpath.normpath(path.strip())
    if not path.strip() or posixpath.isabs(clean) or clean == "." or clean.split("/")[0] == "..":
        raise ModelRetry(f"{path!r} is not a path inside your sandbox folder; name it relative.")
    if writable and clean.split("/")[0] == "skills":
        raise ModelRetry("skills/ holds the skills' own files, which cannot be changed.")
    return f"{WORKSPACE}/{clean}"


def _tail(text: str) -> str:
    return text if len(text) <= MAX_OUTPUT_CHARS else "…" + text[-MAX_OUTPUT_CHARS:]


def _unavailable(problem: SandboxUnavailableError) -> dict[str, Any]:
    log.warning("sandbox.unavailable", problem=str(problem))
    return {"ok": False, "reason": f"The sandbox is not available: {problem}"}


# The tools -------------------------------------------------------------------------------


async def skill_script_run(
    ctx: RunContext[MissionDeps], skill: str, script: str, arguments: list[str] | None = None
) -> dict[str, Any]:
    """Run a script a granted skill ships, in your sandbox folder, and return its output.

    The skill's files are in `skills/<skill>/`; a path in `arguments` is relative to your
    sandbox folder, so write outputs to `out/`. The script runs for at most 120 seconds,
    without network access to anything but the platform's proxy.

    Args:
        skill: The skill's name, as its instructions are headed.
        script: The script's path inside the skill, such as `scripts/build_pptx.js`.
        arguments: The script's arguments, one per item, such as `["--spec", "deck.json"]`.
    """
    known = next((doc for doc in ctx.deps.skills if doc.name == skill), None)
    if known is None or not known.scripts:
        named = [doc.name for doc in ctx.deps.skills if doc.scripts]
        raise ModelRetry(f"{skill!r} is not a granted skill with scripts. These are: {named}.")
    clean = posixpath.normpath(script.strip().removeprefix(f"skills/{skill}/"))
    if clean not in known.scripts:
        raise ModelRetry(f"{skill} ships these scripts: {known.scripts}.")
    interpreter = _INTERPRETERS.get(posixpath.splitext(clean)[1].lower())
    if interpreter is None:
        raise ModelRetry(f"{clean} is not a script this sandbox can run (Python, Node or sh).")
    try:
        sandbox_id = await _workspace(ctx.deps)
        command = ["sh", "-c", f'cd {WORKSPACE} && exec "$@"', "sh", interpreter]
        command += [f"skills/{skill}/{clean}", *(arguments or [])]
        result = await _exec(ctx.deps, sandbox_id, command, seconds=SCRIPT_TIMEOUT_SECONDS)
        listed = await _exec(
            ctx.deps,
            sandbox_id,
            ["find", ".", "-path", "./skills", "-prune", "-o", "-type", "f", "-print"],
        )
    except SandboxUnavailableError as problem:
        return _unavailable(problem)
    files = sorted(
        line.removeprefix("./")
        for line in listed["stdout"].splitlines()
        if line and line != f"./{READY_MARKER}"
    )
    log.info(
        "sandbox.script_ran",
        run_id=ctx.deps.run_id,
        skill=skill,
        script=clean,
        exit_code=result["exit_code"],
        timed_out=result["timed_out"],
    )
    return {
        "exit_code": result["exit_code"],
        "timed_out": result["timed_out"],
        "stdout": _tail(result["stdout"]),
        "stderr": _tail(result["stderr"]),
        "files": files,
    }


async def workspace_file_write(
    ctx: RunContext[MissionDeps], path: str, content: str
) -> dict[str, Any]:
    """Write a text file in your sandbox folder, such as a script's JSON input.

    Args:
        path: Relative to your sandbox folder; not under `skills/`.
        content: The file's whole text, in UTF-8.
    """
    target = _inside(path, writable=True)
    try:
        sandbox_id = await _workspace(ctx.deps)
        await _write(ctx.deps, sandbox_id, target, content.encode())
    except SandboxUnavailableError as problem:
        return _unavailable(problem)
    return {"ok": True, "path": target.removeprefix(f"{WORKSPACE}/")}


async def workspace_file_read(ctx: RunContext[MissionDeps], path: str) -> dict[str, Any]:
    """Read a text file in your sandbox folder, such as a skill's reference.

    Args:
        path: Relative to your sandbox folder, such as `skills/<skill>/references/schema.md`.
    """
    target = _inside(path, writable=False)
    try:
        data = await _read(ctx.deps, await _workspace(ctx.deps), target)
    except SandboxUnavailableError as problem:
        return _unavailable(problem)
    if data is None:
        return {"ok": False, "reason": f"There is no file {path}."}
    try:
        text = data.decode()
    except UnicodeDecodeError:
        return {"ok": False, "reason": f"{path} is not text; save it to give it to the person."}
    if len(text) > MAX_READ_CHARS:
        return {"ok": True, "text": text[:MAX_READ_CHARS], "truncated": True}
    return {"ok": True, "text": text}


async def workspace_file_save(
    ctx: RunContext[MissionDeps], path: str, title: str, project_key: str = ""
) -> dict[str, Any]:
    """Save a file from your sandbox folder as an artifact of the room, request or work item
    you are working on, which is how the person receives it.

    Args:
        path: Relative to your sandbox folder, such as `out/Deck.pptx`.
        title: What the file is called on the platform.
        project_key: Only when the mission is not about a room, request or work item.
    """
    target = _inside(path, writable=False)
    mime_type = _MIME_TYPES.get(posixpath.splitext(target)[1].lower())
    if mime_type is None:
        raise ModelRetry(f"The platform keeps these file types: {sorted(_MIME_TYPES)}.")
    artifact_link(ctx.deps, project_key)
    try:
        data = await _read(ctx.deps, await _workspace(ctx.deps), target)
    except SandboxUnavailableError as problem:
        return _unavailable(problem)
    if data is None:
        return {"saved": False, "reason": f"There is no file {path}."}
    saved = await save_artifact(
        ctx.deps,
        title=title,
        file_name=posixpath.basename(target),
        mime_type=mime_type,
        content_base64=base64.b64encode(data).decode(),
        project_key=project_key,
    )
    return {**saved, "size": len(data)} if saved["saved"] else saved


def sandbox_toolset() -> FunctionToolset[MissionDeps]:
    """The four tools, under the stable id Temporal identifies their activities by."""
    toolset: FunctionToolset[MissionDeps] = FunctionToolset(id=SANDBOX_TOOLSET_ID)
    for function in (
        skill_script_run,
        workspace_file_write,
        workspace_file_read,
        workspace_file_save,
    ):
        toolset.add_function(function, takes_ctx=True)
    return toolset


@dataclass
class SandboxRelease:
    """The run whose sandbox goes when its mission ends."""

    run_id: str
    sandbox_url: str


@activity.defn(name="release_sandbox")
async def release_sandbox(release: SandboxRelease) -> None:
    """Delete the run's sandbox Pods. Its deadline would end them anyway; this is sooner."""
    async with _client(release.sandbox_url, 30) as client:
        answer = await client.delete("/sandboxes", params={"run_id": release.run_id})
    answer.raise_for_status()
