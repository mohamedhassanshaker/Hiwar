"""The panel hears that a mission waits on a person (D239).

A paused mission keeps its AG-UI stream open until it ends, so without these events the
panel shows "Thinking…" while an approval or a question waits in somebody's Inbox. Each
event has to match the console's contract, which is what it switches on.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from ag_ui.core import CustomEvent

from awp_agent.clients import events, platform_mcp
from awp_agent.mission.approvals import ApprovalWanted, create_approval
from awp_agent.mission.questions import QuestionWanted, create_question

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[4]
        / "packages"
        / "contracts"
        / "schemas"
        / "agui-custom-events.schema.json"
    ).read_text("utf-8")
)


def _published(monkeypatch: pytest.MonkeyPatch, answer: Any) -> list[tuple[str, CustomEvent]]:
    sent: list[tuple[str, CustomEvent]] = []

    async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> Any:
        return answer

    async def publish(run_id: str, event: CustomEvent) -> None:
        sent.append((run_id, event))

    monkeypatch.setattr(platform_mcp, "call_tool", call_tool)
    monkeypatch.setattr(events, "publish", publish)
    return sent


def _valid(event: CustomEvent) -> bool:
    return jsonschema.Draft202012Validator(SCHEMA).is_valid(
        {"name": event.name, "value": event.value}
    )


async def test_an_approval_tells_the_panel_which_approval_it_waits_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent = _published(monkeypatch, {"id": "ap-1", "key": "APR-0007", "approvers": 2})
    wanted = ApprovalWanted(
        run_id="run-a", call_id="c-1", tool_name="file_delete", tier="T2", reason="needs a person"
    )
    assert await create_approval(wanted) == "ap-1"
    assert [(run, event.name) for run, event in sent] == [("run-a", "awp.tool.approval")]
    assert sent[0][1].value["approvalKey"] == "APR-0007"
    assert _valid(sent[0][1])


async def test_an_escalated_call_is_a_confirmation_and_a_refused_one_says_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent = _published(monkeypatch, {"id": "ap-2", "key": "APR-0008"})
    await create_approval(
        ApprovalWanted(run_id="run-a", call_id="c-2", tool_name="work_item_edit", tier="T1")
    )
    assert [event.name for _run, event in sent] == ["awp.tool.confirmation"]
    assert _valid(sent[0][1])

    refused = _published(monkeypatch, "refused")
    assert (
        await create_approval(
            ApprovalWanted(run_id="run-a", call_id="c-3", tool_name="file_delete")
        )
        == ""
    )
    assert refused == []


async def test_a_question_tells_the_panel_what_was_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _published(monkeypatch, {"id": "q-1"})
    await create_question(
        QuestionWanted(run_id="run-q", question="Which office?", options=["Dubai", "Sharjah"])
    )
    assert [(run, event.name) for run, event in sent] == [("run-q", "awp.agent.question")]
    assert sent[0][1].value == {
        "questionId": "q-1",
        "question": "Which office?",
        "options": ["Dubai", "Sharjah"],
        "fields": [],
    }
    assert _valid(sent[0][1])
