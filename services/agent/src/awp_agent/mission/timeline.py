"""A finished mission's timeline, for the run viewer (D300).

Built from the mission's own message history, which the workflow already holds: one Model step
for each response in which the agent wrote text, one Tool step for each call with its arguments
and what came back, and a closing Handoff step with the answer. A pure function of its inputs, so
it is deterministic inside the workflow.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)

from awp_agent.harness.types import RunStepRecord, StepType

#: What `run_finish` accepts for one step's result; a longer one is cut, and says so.
RESULT_LIMIT = 4_000


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _detail(arguments: Any, result: Any) -> str:
    """A tool step's result: the arguments it was called with and what came back, as JSON."""
    body = json.dumps({"arguments": arguments, "result": result}, ensure_ascii=False, default=str)
    if len(body) <= RESULT_LIMIT:
        return body
    # The arguments are kept whole where they fit, since they are what a person checks first.
    shown = _clip(json.dumps(arguments, ensure_ascii=False, default=str), RESULT_LIMIT // 3)
    room = RESULT_LIMIT - len(shown) - 40
    returned = (
        result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
    )
    return json.dumps(
        {"arguments": shown, "result": _clip(returned, max(room, 0))}, ensure_ascii=False
    )


def timeline(
    messages: Sequence[ModelMessage], *, status: str, output: str, ended: datetime
) -> list[RunStepRecord]:
    """The run viewer's steps for a mission that ended with `status` and `output`."""
    steps: list[RunStepRecord] = []
    calls: dict[str, tuple[ToolCallPart, datetime]] = {}
    answered: set[str] = set()

    def add(
        kind: StepType, name: str, state: str, result: str, start: datetime, end: datetime
    ) -> None:
        """Append the next numbered step, its name cut at 200 and its result at the limit."""
        steps.append(
            RunStepRecord(
                seq=len(steps) + 1,
                type=kind,
                name=_clip(name, 200),
                status=state,
                result=_clip(result, RESULT_LIMIT),
                started_at=start,
                ended_at=end,
            )
        )

    for message in messages:
        if isinstance(message, ModelResponse):
            text = "".join(
                part.content for part in message.parts if isinstance(part, TextPart)
            ).strip()
            if text:
                add(StepType.MODEL, "model", "Done", text, message.timestamp, message.timestamp)
            for part in message.parts:
                if isinstance(part, ToolCallPart):
                    calls[part.tool_call_id] = (part, message.timestamp)
        elif isinstance(message, ModelRequest):
            for reply in message.parts:
                if isinstance(reply, ToolReturnPart) and reply.tool_call_id in calls:
                    call, started = calls[reply.tool_call_id]
                    answered.add(reply.tool_call_id)
                    detail = _detail(call.args_as_dict(), reply.content)
                    add(StepType.TOOL, call.tool_name, "Done", detail, started, reply.timestamp)
                elif isinstance(reply, RetryPromptPart) and reply.tool_call_id in calls:
                    call, started = calls[reply.tool_call_id]
                    answered.add(reply.tool_call_id)
                    detail = _detail(call.args_as_dict(), reply.model_response())
                    add(StepType.TOOL, call.tool_name, "Refused", detail, started, reply.timestamp)

    # A call the mission ended on without an answer: cancelled, or out of steps.
    for call_id, (call, started) in calls.items():
        if call_id not in answered:
            add(
                StepType.TOOL,
                call.tool_name,
                "Unanswered",
                _detail(call.args_as_dict(), None),
                started,
                ended,
            )

    add(StepType.HANDOFF, "finish", status, output, ended, ended)
    return steps
