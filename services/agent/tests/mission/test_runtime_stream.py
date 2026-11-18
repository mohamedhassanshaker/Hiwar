"""Streaming a mission's answer to the panel never costs the mission anything (D121)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

import pytest
from ag_ui.core import TextMessageContentEvent, TextMessageEndEvent, TextMessageStartEvent
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ToolCallPart,
    ToolReturnPart,
)

from awp_agent.clients import events
from awp_agent.mission.deps import MissionDeps
from awp_agent.mission.stream import publish_to_panel


class _Context:
    deps = MissionDeps(run_id="run-1", person_id="p-1", mcp_token="t", route="r")


async def _answer() -> AsyncIterator[AgentStreamEvent]:
    """One streamed text answer: a part that starts with text, then one delta."""
    yield PartStartEvent(index=0, part=TextPart(content="Hel"))
    yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="lo"))


def _described(event: Any) -> str:
    if isinstance(event, TextMessageContentEvent):
        return f"content:{event.delta}"
    if isinstance(event, TextMessageStartEvent):
        return "start"
    if isinstance(event, TextMessageEndEvent):
        return "end"
    return type(event).__name__


async def test_an_unreachable_stream_does_not_fail_the_step_and_every_event_is_still_tried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tried: list[str] = []

    async def unreachable(run_id: str, event: Any) -> str:
        tried.append(_described(event))
        raise ConnectionError("Valkey is not reachable")

    monkeypatch.setattr(events, "publish", unreachable)

    await publish_to_panel(_Context(), _answer())  # type: ignore[arg-type]

    assert tried == ["start", "content:Hel", "content:lo", "end"]


async def test_a_stream_that_hangs_holds_the_step_for_two_seconds_at_most(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The first event never completes; the rest of the answer still goes out, after the
    stuck one has been abandoned at the bound."""
    published: list[str] = []
    stuck = asyncio.Event()

    async def first_hangs(run_id: str, event: Any) -> str:
        if not published and not stuck.is_set():
            stuck.set()
            await asyncio.Event().wait()
        published.append(_described(event))
        return "0-1"

    monkeypatch.setattr(events, "publish", first_hangs)

    started = time.monotonic()
    await publish_to_panel(_Context(), _answer())  # type: ignore[arg-type]
    elapsed = time.monotonic() - started

    assert 1.9 <= elapsed < 3.0
    assert published == ["content:Hel", "content:lo", "end"]


async def test_each_tool_call_and_its_result_reach_the_panel_as_ag_ui_tool_call_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D252: the panel's list of actions is drawn from AG-UI's own tool-call events, one set
    per call, keyed by the call's id, with what it returned or why it was refused."""
    sent: list[Any] = []

    async def publish(run_id: str, event: Any) -> str:
        sent.append(event)
        return "0-0"

    monkeypatch.setattr(events, "publish", publish)

    async def calls() -> AsyncIterator[AgentStreamEvent]:
        created = ToolCallPart("work_item_create", {"title_en": "Ledger"}, "call-1")
        yield FunctionToolCallEvent(part=created)
        yield FunctionToolResultEvent(part=ToolReturnPart("work_item_create", "TSK-42", "call-1"))
        refused = ToolCallPart("project_create", {"key": "X"}, "call-2")
        yield FunctionToolCallEvent(part=refused)
        yield FunctionToolResultEvent(
            part=RetryPromptPart("pass a name", tool_name="project_create", tool_call_id="call-2")
        )

    await publish_to_panel(_Context(), calls())  # type: ignore[arg-type]

    assert [(type(event).__name__, event.tool_call_id) for event in sent] == [
        ("ToolCallStartEvent", "call-1"),
        ("ToolCallArgsEvent", "call-1"),
        ("ToolCallEndEvent", "call-1"),
        ("ToolCallResultEvent", "call-1"),
        ("ToolCallStartEvent", "call-2"),
        ("ToolCallArgsEvent", "call-2"),
        ("ToolCallEndEvent", "call-2"),
        ("ToolCallResultEvent", "call-2"),
    ]
    assert sent[0].tool_call_name == "work_item_create"
    assert sent[1].delta == '{"title_en":"Ledger"}'
    assert sent[3].content == "TSK-42"
    assert "pass a name" in sent[7].content
