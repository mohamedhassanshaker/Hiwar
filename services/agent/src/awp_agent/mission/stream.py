"""Streaming a mission's answer to the panel (D98).

The UI edge speaks AG-UI (design rule 3), and the panel reads the run's event stream from
Valkey. A mission that answers without publishing anything leaves the panel saying
"Thinking…" for ever — which is exactly what the first real panel mission on the generic
runtime did, while the workflow itself completed.

This is the `event_stream_handler` the durability capability takes. It runs inside the
model-request activity, where I/O is allowed, so it can publish; the workflow itself
could not.

The translation is small on purpose. Pydantic AI already emits the shape of a streamed
answer — a part starting, deltas arriving, the part ending — and AG-UI names the same
three things. Nothing here decides anything about the run.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable

from ag_ui.core import (
    CustomEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ToolReturnPart,
)
from pydantic_ai.tools import RunContext

from awp_agent.clients import events
from awp_agent.logging import logger
from awp_agent.mission.deps import MissionDeps

log = logger("awp_agent.mission.stream")

#: How long one panel event may take before the mission stops waiting for it.
PUBLISH_TIMEOUT = 2.0


async def _say(run_id: str, event: object) -> None:
    """Publish one event, and never fail the mission for it.

    The stream is how the panel watches; it is not how the work is done. A Valkey that
    is unreachable costs the person a live view of an answer that is still correct and
    still recorded, and taking the mission down instead would turn a cosmetic outage
    into a lost piece of work.
    """
    try:
        # Bounded: an unreachable Valkey blocks on connect rather than failing, and a
        # mission must not wait on the thing that is only watching it.
        await asyncio.wait_for(events.publish(run_id, event), timeout=PUBLISH_TIMEOUT)  # type: ignore[arg-type]
    except Exception as problem:  # noqa: BLE001 - any failure here has the same answer
        log.warning("panel_stream_unavailable", extra={"run": run_id, "problem": str(problem)})


async def tell_panel(run_id: str, name: str, value: dict[str, object]) -> None:
    """Publish one of the platform's CUSTOM events (`agui-custom-events.schema.json`)."""
    await _say(run_id, CustomEvent(name=name, value=value))


async def publish_to_panel(
    context: RunContext[MissionDeps], stream: AsyncIterable[AgentStreamEvent]
) -> None:
    """Turn one model step's events into the AG-UI stream the panel reads.

    The message id is the run id, as the old loop used: the panel keys its placeholder on
    it, and a fresh id per step would start a new bubble for every turn of the mission.
    """
    run_id = context.deps.run_id
    started = False

    async for event in stream:
        if await _tell_progress(run_id, event):
            continue
        if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
            if not started:
                await _say(run_id, TextMessageStartEvent(message_id=run_id, role="assistant"))
                started = True
            if event.part.content:
                await _say(
                    run_id,
                    TextMessageContentEvent(message_id=run_id, delta=event.part.content),
                )
        elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
            if not started:
                await _say(run_id, TextMessageStartEvent(message_id=run_id, role="assistant"))
                started = True
            if event.delta.content_delta:
                await _say(
                    run_id,
                    TextMessageContentEvent(message_id=run_id, delta=event.delta.content_delta),
                )

    if started:
        await _say(run_id, TextMessageEndEvent(message_id=run_id))


async def _tell_progress(run_id: str, event: AgentStreamEvent) -> bool:
    """Each tool call, and what it returned, as AG-UI's own tool-call events, which the
    panel draws as its list of actions (D252). Returns whether the event was one of these."""
    if isinstance(event, FunctionToolCallEvent):
        call = event.part
        await _say(
            run_id,
            ToolCallStartEvent(
                tool_call_id=call.tool_call_id,
                tool_call_name=call.tool_name,
                parent_message_id=run_id,
            ),
        )
        await _say(
            run_id, ToolCallArgsEvent(tool_call_id=call.tool_call_id, delta=call.args_as_json_str())
        )
        await _say(run_id, ToolCallEndEvent(tool_call_id=call.tool_call_id))
        return True
    if isinstance(event, FunctionToolResultEvent):
        result = event.part
        await _say(
            run_id,
            ToolCallResultEvent(
                message_id=f"{run_id}:{result.tool_call_id}",
                tool_call_id=result.tool_call_id,
                # A refused call comes back as a retry prompt, with the reason the model is told.
                content=result.model_response_str()
                if isinstance(result, ToolReturnPart)
                else result.model_response(),
                role="tool",
            ),
        )
        return True
    return False
