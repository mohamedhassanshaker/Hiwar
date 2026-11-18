"""D300: a finished mission's timeline, built from its own messages."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

from awp_agent.mission.timeline import RESULT_LIMIT, timeline

START = datetime(2026, 10, 27, 9, 0, tzinfo=UTC)


def at(seconds: int) -> datetime:
    return START + timedelta(seconds=seconds)


def test_each_call_is_a_step_with_its_arguments_and_result_in_order() -> None:
    messages: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart(content="Make a project", timestamp=at(0))]),
        ModelResponse(
            parts=[
                TextPart(content="Looking first."),
                ToolCallPart(tool_name="project_list", args={}, tool_call_id="c1"),
                ToolCallPart(
                    tool_name="project_create", args='{"nameEn": "Ledger"}', tool_call_id="c2"
                ),
            ],
            timestamp=at(1),
        ),
        ModelRequest(
            parts=[
                ToolReturnPart(
                    tool_name="project_list",
                    content=[{"key": "FIN"}],
                    tool_call_id="c1",
                    timestamp=at(2),
                ),
                RetryPromptPart(
                    content="projectKey is required",
                    tool_name="project_create",
                    tool_call_id="c2",
                    timestamp=at(3),
                ),
            ]
        ),
        ModelResponse(parts=[TextPart(content="Done.")], timestamp=at(4)),
    ]

    steps = timeline(messages, status="Succeeded", output="Done.", ended=at(5))

    assert [(step.seq, str(step.type), step.name, step.status) for step in steps] == [
        (1, "Model", "model", "Done"),
        (2, "Tool", "project_list", "Done"),
        (3, "Tool", "project_create", "Refused"),
        (4, "Model", "model", "Done"),
        (5, "Handoff", "finish", "Succeeded"),
    ]
    listed = json.loads(steps[1].result)
    assert listed == {"arguments": {}, "result": [{"key": "FIN"}]}
    refused = json.loads(steps[2].result)
    assert refused["arguments"] == {"nameEn": "Ledger"}
    assert "projectKey is required" in refused["result"]
    assert (steps[1].started_at, steps[1].ended_at) == (at(1), at(2))
    assert steps[4].result == "Done."


def test_a_call_left_unanswered_is_shown_and_a_long_result_is_cut() -> None:
    messages: list[ModelMessage] = [
        ModelResponse(
            parts=[
                ToolCallPart(tool_name="file_search", args={"q": "x"}, tool_call_id="c1"),
                ToolCallPart(tool_name="work_item_edit", args={"key": "TSK-1"}, tool_call_id="c2"),
            ],
            timestamp=at(1),
        ),
        ModelRequest(
            parts=[
                ToolReturnPart(
                    tool_name="file_search",
                    content="y" * 50_000,
                    tool_call_id="c1",
                    timestamp=at(2),
                )
            ]
        ),
    ]

    steps = timeline(messages, status="Cancelled", output="Stopped.", ended=at(9))

    assert [(step.name, step.status) for step in steps] == [
        ("file_search", "Done"),
        ("work_item_edit", "Unanswered"),
        ("finish", "Cancelled"),
    ]
    assert len(steps[0].result) <= RESULT_LIMIT
    assert json.loads(steps[0].result)["arguments"] == '{"q": "x"}'
    assert steps[1].ended_at == at(9)
