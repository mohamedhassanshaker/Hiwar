"""The built-ins the harness answers itself (`mission/tools.py`)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from awp_agent.harness.tools import document_builder
from awp_agent.mission.deps import MissionDeps
from awp_agent.mission.tools import harness_toolset


async def test_a_malformed_document_call_goes_back_to_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D355: RUN-88260's model sent `sheets` as strings. The call reached the renderer, which
    raised, and the run failed. Now the call is held to the tool's schema and the model is
    told what to fix, before anything renders."""

    def render(arguments: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError("a call that does not match the schema must not render")

    monkeypatch.setattr(document_builder, "render", render)
    retries: list[RetryPromptPart] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        retries[:] = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, RetryPromptPart)
        ]
        if retries:
            return ModelResponse(parts=[TextPart("Fixed.")])
        call = {"format": "xlsx", "title": "Budget", "sheets": ["Summary", "Detail"]}
        return ModelResponse(parts=[ToolCallPart("generate_document", call, "call-1")])

    agent = Agent(FunctionModel(model), deps_type=MissionDeps, toolsets=[harness_toolset()])
    deps = MissionDeps(
        run_id="run-1",
        person_id="person-1",
        mcp_token="t",
        route="reasoning-default",
        context_type="Room",
        context_key="ROOM-1",
    )

    result = await agent.run("Make the budget workbook", deps=deps)

    assert result.output == "Fixed."
    assert len(retries) == 1
    assert "sheets/0: must be object, not a string" in str(retries[0].content)
    assert "sheets/1: must be object, not a string" in str(retries[0].content)


def _deps() -> MissionDeps:
    return MissionDeps(
        run_id="run-1",
        person_id="person-1",
        mcp_token="t",
        route="reasoning-default",
        context_type="Room",
        context_key="ROOM-1",
    )


def _calling(call: dict[str, Any], retries: list[RetryPromptPart]) -> FunctionModel:
    """A model that makes `call` once, then answers; `retries` collects what it was told."""

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        retries[:] = [
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, RetryPromptPart)
        ]
        made = any(isinstance(part, ToolCallPart) for message in messages for part in message.parts)
        if made:
            return ModelResponse(parts=[TextPart("Done.")])
        return ModelResponse(parts=[ToolCallPart("generate_document", call, "call-1")])

    return FunctionModel(model)


async def test_a_list_sent_as_json_text_is_read_as_the_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D364: on 2026-10-30 the free model sent `sheets` as JSON text four times; each was
    refused and the run failed. Valid JSON text of the type the schema asks for is read as
    its value and rendered."""
    rendered: list[dict[str, Any]] = []

    def render(arguments: dict[str, Any]) -> dict[str, Any]:
        rendered.append(arguments)
        raise ValueError("stop after rendering")

    monkeypatch.setattr(document_builder, "render", render)
    retries: list[RetryPromptPart] = []
    sheets = [{"name": "Features", "headers": ["Feature"], "rows": [["Requests"]]}]
    call = {"format": "xlsx", "title": "Features", "sheets": json.dumps(sheets)}

    await Agent(_calling(call, retries), deps_type=MissionDeps, toolsets=[harness_toolset()]).run(
        "Make the workbook", deps=_deps()
    )

    assert rendered[0]["sheets"] == sheets
    assert "do not match the schema" not in " ".join(str(part.content) for part in retries)


async def test_malformed_json_text_is_refused_with_the_type_expected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D364: text that is not the JSON it looks like stays refused, and the model is told the
    type, not shown its own value back."""

    def render(arguments: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError("a call that does not match the schema must not render")

    monkeypatch.setattr(document_builder, "render", render)
    retries: list[RetryPromptPart] = []
    # The stray `}]` the model wrote on 2026-10-30.
    malformed = '[{"name": "Features", "rows": [["a"]]}]}]'
    call = {"format": "xlsx", "title": "Features", "sheets": malformed}

    await Agent(_calling(call, retries), deps_type=MissionDeps, toolsets=[harness_toolset()]).run(
        "Make the workbook", deps=_deps()
    )

    [retry] = retries
    assert str(retry.content).endswith(
        "sheets: must be array, not a string (send the value itself, not JSON text)"
    )
