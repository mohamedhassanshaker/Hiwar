"""A tool that keeps failing is refused after three failures in a row (D379).

The defect: a run cloning a user called the Manage Portal connector's tool 47 times, each
call answered 400, until its step budget ran out.
"""

from __future__ import annotations

import json

import pytest
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from awp_agent.mission.failure_guard import (
    FAILURES_BEFORE_STOP,
    RepeatedFailureGuard,
    consecutive_failures,
)

FAILED = json.dumps({"success": False, "statusCode": 400})


def _results(*contents: object, tool: str = "invoke") -> list[ModelMessage]:
    return [
        ModelRequest(parts=[ToolReturnPart(tool, content, tool_call_id=f"call-{index}")])
        for index, content in enumerate(contents)
    ]


def test_failures_are_counted_back_to_the_tool_s_last_success() -> None:
    history = _results(FAILED, {"success": True}, FAILED, {"ok": False})

    assert consecutive_failures(history, "invoke") == 2


def test_a_retry_prompt_is_the_library_s_to_count_and_another_tool_s_results_do_not_count() -> None:
    history = [
        *_results(FAILED),
        ModelRequest(parts=[RetryPromptPart("400 Bad Request", tool_name="invoke")]),
        *_results({"success": True}, tool="lookup"),
    ]

    assert consecutive_failures(history, "invoke") == 1


def test_a_result_that_does_not_report_a_failure_is_a_success() -> None:
    assert consecutive_failures(_results("plain text", [1, 2], {"rows": 3}), "invoke") == 0


async def test_the_fourth_call_after_three_failures_is_refused_without_being_made() -> None:
    made: list[int] = []
    sent_back: list[str] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        sent_back.extend(
            str(part.content) for part in last.parts if isinstance(part, ToolReturnPart)
        )
        if any("do not try the call again" in text for text in sent_back):
            return ModelResponse(parts=[TextPart("addUser keeps refusing the payload.")])
        return ModelResponse(parts=[ToolCallPart("invoke", {"path": "addUser"})])

    agent = Agent(FunctionModel(model), capabilities=[RepeatedFailureGuard()])

    @agent.tool_plain
    def invoke(path: str) -> str:
        made.append(1)
        return FAILED

    result = await agent.run("Clone the user.")

    assert len(made) == FAILURES_BEFORE_STOP
    assert "failed 3 times in a row, so this call was not made" in sent_back[-1]
    assert result.output == "addUser keeps refusing the payload."


async def test_a_model_that_calls_again_after_being_told_to_stop_ends_the_run() -> None:
    made: list[int] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart("invoke", {"path": "addUser"})])

    agent = Agent(FunctionModel(model), capabilities=[RepeatedFailureGuard()])

    @agent.tool_plain
    def invoke(path: str) -> str:
        made.append(1)
        return FAILED

    with pytest.raises(UnexpectedModelBehavior, match="kept calling it after being told to stop"):
        await agent.run("Clone the user.")
    assert len(made) == FAILURES_BEFORE_STOP


async def test_a_tool_that_raises_is_left_to_the_library_s_retries() -> None:
    """D137 holds: three retries, then the run fails; the guard adds no call and no refusal."""
    made: list[int] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart("invoke", {"path": "addUser"})])

    agent = Agent(FunctionModel(model), capabilities=[RepeatedFailureGuard()], retries={"tools": 3})

    @agent.tool_plain
    def invoke(path: str) -> str:
        made.append(1)
        raise ModelRetry("400: The JSON value could not be converted.")

    with pytest.raises(UnexpectedModelBehavior, match="exceeded max retries"):
        await agent.run("Clone the user.")
    assert len(made) == 4
