"""Stops a run calling a tool that keeps failing (D379).

A run asked to clone a user called the same connector tool 47 times; every call came back
400 and only the run's step budget stopped it. A tool that raises is the library's: its
retries (`TOOL_RETRIES` in `runtime.py`), then the run fails (D137, D380). A tool that
*answers* that it failed (`success` or `ok` false) is not an error to the library, so it is
counted here: after `FAILURES_BEFORE_STOP` in a row the next call is refused without being
made and the model is told to stop and say what failed; a model that calls it again anyway
ends the run. Counted from the run's own messages, so the guard holds no state and is
deterministic inside the Temporal workflow.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.capabilities import (
    AbstractCapability,
    ValidatedToolArgs,
    WrapToolExecuteHandler,
)
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.tools import ToolDefinition

from awp_agent.logging import logger

log = logger("awp_agent.mission.failure_guard")

#: Failed answers in a row from one tool before the next call is refused.
FAILURES_BEFORE_STOP = 3


def consecutive_failures(messages: Sequence[ModelMessage], tool_name: str) -> int:
    """How many of the tool's latest answers, back to its last success, reported a failure.

    A retry prompt (the tool raised) is the library's to count and is skipped here.
    """
    failures = 0
    for message in messages:
        if not isinstance(message, ModelRequest):
            continue
        for part in message.parts:
            if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                failures = failures + 1 if _says_failed(part.content) else 0
    return failures


def _says_failed(content: Any) -> bool:
    """A result that reports its own failure: `success` or `ok` false, as text or a mapping."""
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except ValueError:
            return False
    if not isinstance(content, dict):
        return False
    return content.get("success") is False or content.get("ok") is False


def stop_reason(tool_name: str, failures: int) -> str:
    """What the refused call returns to the model."""
    return (
        f"{tool_name} failed {failures} times in a row, so this call was not made. Stop "
        "calling it. Tell the person what you were trying to do, the error the last call "
        "returned, and what they could check or change; do not try the call again."
    )


@dataclass
class RepeatedFailureGuard(AbstractCapability[Any]):
    """Refuses a call to a tool whose last `FAILURES_BEFORE_STOP` calls all failed."""

    @classmethod
    def get_serialization_name(cls) -> str | None:
        """Built in code, never from a spec."""
        return None

    async def wrap_tool_execute(
        self,
        ctx: RunContext[Any],
        *,
        call: ToolCallPart,
        tool_def: ToolDefinition,
        args: ValidatedToolArgs,
        handler: WrapToolExecuteHandler,
    ) -> Any:
        """Make the call, unless the tool has failed too often in a row.

        :raises UnexpectedModelBehavior: the model called the tool again after being told to
            stop, which ends the run Failed as the library's own retry limit does.
        """
        failures = consecutive_failures(ctx.messages, call.tool_name)
        if failures < FAILURES_BEFORE_STOP:
            return await handler(args)
        log.warning(
            "tool.repeated_failures",
            run_id=getattr(ctx.deps, "run_id", None),
            tool=call.tool_name,
            failures=failures,
        )
        if failures > FAILURES_BEFORE_STOP:
            raise UnexpectedModelBehavior(
                f"{call.tool_name} failed {failures - 1} times in a row and the agent kept "
                "calling it after being told to stop."
            )
        return {"ok": False, "reason": stop_reason(call.tool_name, failures)}
