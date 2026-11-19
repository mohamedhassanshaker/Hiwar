"""The built-ins the harness answers itself on the generic runtime (D74, D80).

A `FunctionToolset`, so under `TemporalDurability` each call runs as an activity, where
rendering a file and calling the platform are allowed. The schemas are the specs in
`harness/tools/builtin.py`, which the web app's grant screen also lists.

`generate_document` renders the file and saves it through the platform's own
`artifact_create`, on the run's model token: the server checks the person and the grant,
and the file lands against the room, request or work item the mission is about. Handing
the base64 back to the model to pass on would cost the whole file in tokens twice.

`write_handoff` records that the agent cannot finish and why. The mission workflow reads
the call from the run's messages and ends the mission BLOCKED (D42, D102).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import jsonschema
from pydantic_ai import ModelRetry, RunContext, Tool
from pydantic_ai.toolsets import FunctionToolset

from awp_agent.clients import platform_mcp
from awp_agent.harness.tools import builtin, document_builder
from awp_agent.harness.types import ToolSpec
from awp_agent.mission.deps import MissionDeps

HARNESS_TOOLSET_ID = "awp-harness"

GENERATE_DOCUMENT_TOOL = builtin.GENERATE_DOCUMENT
WRITE_HANDOFF_TOOL = builtin.WRITE_HANDOFF
HARNESS_TOOLS = frozenset({GENERATE_DOCUMENT_TOOL, WRITE_HANDOFF_TOOL})

#: The record types an artifact may be linked to, by the mission's context type.
_ARTIFACT_LINKS = {"Room": "Room", "Request": "Request", "WorkItem": "WorkItem"}


def artifact_link(deps: MissionDeps, project_key: str) -> str | None:
    """The record type a saved file is linked to. `ModelRetry` when there is nothing to save
    it against."""
    link = _ARTIFACT_LINKS.get(deps.context_type)
    if not link and not project_key:
        raise ModelRetry("Nothing to save the file against here: pass project_key.")
    return link


async def save_artifact(
    deps: MissionDeps,
    *,
    title: str,
    file_name: str,
    mime_type: str,
    content_base64: str,
    project_key: str = "",
) -> dict[str, Any]:
    """Save a file through the platform's `artifact_create`, against the mission's record."""
    link = artifact_link(deps, project_key)
    try:
        saved = await platform_mcp.call_tool(
            deps.mcp_token,
            "artifact_create",
            {
                "title_en": title,
                "title_ar": title,
                "file_name": file_name,
                "mime_type": mime_type,
                "content_base64": content_base64,
                "run_id": deps.run_id,
                **({"project_key": project_key} if project_key else {}),
                **({"linked_to_type": link, "linked_to_key": deps.context_key} if link else {}),
            },
            url=deps.mcp_url,
        )
    except platform_mcp.PlatformMcpError as refused:
        # The server's own reason, so the model tells the person why rather than guessing.
        return {"saved": False, "reason": str(refused)}
    return {"saved": True, "file_name": file_name, "artifact": saved}


async def _generate_document(ctx: RunContext[MissionDeps], **arguments: Any) -> dict[str, Any]:
    """Render the document and save it as an artifact; return the save result and its size.

    A format the builder refuses comes back to the model as `ModelRetry`; a missing renderer
    library (`DocumentUnavailableError`) propagates and fails the call. A refused save is
    returned with the server's reason.
    """
    deps = ctx.deps
    arguments = _decoded(arguments, _spec(GENERATE_DOCUMENT_TOOL).parameters_json_schema)
    project_key = str(arguments.pop("project_key", "") or "")
    # Checked before rendering, so a call with nothing to save against renders nothing.
    artifact_link(deps, project_key)
    try:
        # CPU-bound rendering, off the event loop the activity shares with other runs.
        rendered = await asyncio.to_thread(document_builder.render, arguments)
    except ValueError as problem:
        raise ModelRetry(str(problem)) from problem
    saved = await save_artifact(
        deps,
        title=str(arguments.get("title") or rendered["file_name"]),
        file_name=rendered["file_name"],
        mime_type=rendered["mime_type"],
        content_base64=rendered["content_base64"],
        project_key=project_key,
    )
    return {**saved, "size": rendered["size"]} if saved["saved"] else saved


async def _write_handoff(ctx: RunContext[MissionDeps], **arguments: Any) -> str:
    return "Recorded. Stop here and tell the person what you need from them."


def _spec(name: str) -> ToolSpec:
    return next(spec for spec in builtin.BUILTIN_TOOLS if spec.name == name)


_JSON_TYPES: dict[type, str] = {
    str: "a string",
    bool: "a boolean",
    int: "a number",
    float: "a number",
    list: "an array",
    dict: "an object",
    type(None): "null",
}


_CONTAINERS: dict[str, type[Any]] = {"array": list, "object": dict}


def _decoded(arguments: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """The arguments with each array or object the model sent as JSON text read as its value.

    Free models often write `"sheets": "[{...}]"` for `"sheets": [{...}]` (2026-10-30, the
    room spreadsheet run). Text that is not that JSON is left as it was, for the schema to
    refuse (D364).
    """
    properties = schema.get("properties", {})
    decoded = dict(arguments)
    for key, value in arguments.items():
        expected = _CONTAINERS.get(properties.get(key, {}).get("type", ""))
        if expected is None or not isinstance(value, str):
            continue
        try:
            parsed = json.loads(value)
        except ValueError:
            continue
        if isinstance(parsed, expected):
            decoded[key] = parsed
    return decoded


def _mismatch(error: jsonschema.ValidationError) -> str:
    """One mismatch, named by where it is and what was expected, without quoting the value."""
    where = "/".join(str(part) for part in error.absolute_path) or "arguments"
    if error.validator == "type":
        given = _JSON_TYPES.get(type(error.instance), type(error.instance).__name__)
        looks_json = isinstance(error.instance, str) and error.instance.lstrip()[:1] in ("[", "{")
        hint = " (send the value itself, not JSON text)" if looks_json else ""
        return f"{where}: must be {error.validator_value}, not {given}{hint}"
    return f"{where}: {error.message[:200]}"


def _schema_check(schema: dict[str, Any]) -> Any:
    """An `args_validator` that holds a call to its JSON schema.

    `Tool.from_schema` skips schema validation (pydantic-ai 2.57), so without it a malformed
    call reached the renderer and failed the run (D355). An array or object sent as valid JSON
    text is read as its value first (D364). A call that does not match goes back to the model
    as `ModelRetry`, with each mismatch, where it is and the type expected.
    """
    validator = jsonschema.Draft202012Validator(schema)

    def check(_ctx: RunContext[MissionDeps], **arguments: Any) -> None:
        errors = validator.iter_errors(_decoded(arguments, schema))
        mismatches = [_mismatch(error) for error in errors]
        if mismatches:
            raise ModelRetry("The arguments do not match the schema: " + "; ".join(mismatches))

    return check


def _generate_document_tool() -> Tool[MissionDeps]:
    """`generate_document` with the built-in spec's schema plus an optional `project_key`."""
    spec = _spec(GENERATE_DOCUMENT_TOOL)
    schema = dict(spec.parameters_json_schema)
    schema["properties"] = {
        **schema.get("properties", {}),
        "project_key": {
            "type": "string",
            "description": "Only when the mission is not about a room, request or work item.",
        },
    }
    return Tool.from_schema(
        _generate_document,
        name=GENERATE_DOCUMENT_TOOL,
        description=(
            "Create a real Word, Excel, PowerPoint or PDF file and save it as an artifact of "
            "the room, request or work item you are working on. Returns whether it was saved."
        ),
        json_schema=schema,
        takes_ctx=True,
        args_validator=_schema_check(schema),
    )


def _write_handoff_tool() -> Tool[MissionDeps]:
    """`write_handoff` with the built-in spec's schema; the workflow reads its arguments."""
    return Tool.from_schema(
        _write_handoff,
        name=WRITE_HANDOFF_TOOL,
        description=(
            "Use only when you cannot finish: record the goal, what was decided, the open "
            "questions and the one next step a person has to take. The mission then waits "
            "for a person instead of reporting success."
        ),
        json_schema=_spec(WRITE_HANDOFF_TOOL).parameters_json_schema,
        takes_ctx=True,
    )


def harness_toolset() -> FunctionToolset[MissionDeps]:
    """Both tools, under the stable id Temporal identifies their activities by."""
    return FunctionToolset(
        [_generate_document_tool(), _write_handoff_tool()],
        id=HARNESS_TOOLSET_ID,
    )
