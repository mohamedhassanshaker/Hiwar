"""The guards around a typed classification (`UC-28.2-04`, `-06`).

What the model says is the model's business; what the service does with an answer it cannot
act on is the platform's. These cover exactly that boundary, with no model involved.
"""

from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest
from pydantic import ValidationError
from pydantic_ai.exceptions import UnexpectedModelBehavior

from awp_agent import classify
from awp_agent.classify import ClassifyRequest, RequestClassification, TypeSpec
from awp_agent.clients import gateway_client

KNOWN = {"EXPENSE", "PURCHASE"}


def test_unknown_type_becomes_no_choice() -> None:
    """A code the catalogue does not contain is the same as no choice at all."""
    held = classify.hold_to_catalogue(
        RequestClassification(
            type_code="INVENTED", confidence=0.99, candidates=["EXPENSE", "GONE"]
        ),
        KNOWN,
    )
    assert held.type_code == ""
    assert held.candidates == ["EXPENSE"]


def test_low_confidence_asks_the_person() -> None:
    """`UC-28.2-04`: below the floor the person chooses, and the guess becomes a candidate."""
    held = classify.hold_to_catalogue(
        RequestClassification(type_code="EXPENSE", confidence=0.4, candidates=["PURCHASE"]),
        KNOWN,
    )
    assert held.type_code == ""
    assert held.candidates == ["EXPENSE", "PURCHASE"]


def test_a_confident_known_type_is_left_alone() -> None:
    """Nothing is second-guessed when the answer is one the console can act on."""
    held = classify.hold_to_catalogue(
        RequestClassification(
            type_code="EXPENSE", confidence=0.95, attributes={"amount_aed": "186"}
        ),
        KNOWN,
    )
    assert held.type_code == "EXPENSE"
    assert held.attributes == {"amount_aed": "186"}


@pytest.mark.anyio
async def test_invalid_output_is_reported_as_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """`UC-28.2-06`: the console is told the route failed, not given a half-answer."""

    async def fails(_request: ClassifyRequest) -> RequestClassification:
        raise UnexpectedModelBehavior("the output did not validate")

    monkeypatch.setattr(classify, "classify", fails)
    request = ClassifyRequest(
        text="anything", types=[TypeSpec(code="EXPENSE", name="Expense Claim")]
    )
    assert await classify.classify_or_none(request) is None


def _deciding(monkeypatch: pytest.MonkeyPatch, choice: str) -> list[dict[str, Any]]:
    """The gateway as the Decision route answers it, choosing `choice`; returns what was sent."""
    sent: list[dict[str, Any]] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        sent.append({"url": str(request.url), "body": json.loads(request.content)})
        return httpx2.Response(
            200,
            json={
                "model": "cloudflare/clef-flash",
                "choices": [],
                "answers": {"agent": {"type": "choice", "choice": choice, "confidence": 0.92}},
            },
        )

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(answer))
    monkeypatch.setattr(gateway_client, "_http_client", lambda: client)
    return sent


ROOM = classify.ChooseAgentRequest(
    text="What is the difference between TP_ExpireAfter and TP_PayLinkExpireDate?",
    agents=[
        classify.AgentSpec(code="def", name="Default Agent", purpose="General questions."),
        classify.AgentSpec(code="kb", name="Knowledge", purpose="Answers from the knowledge base."),
    ],
)


@pytest.mark.anyio
async def test_the_agent_the_route_chooses_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    """D290: one choice question on the Decision route, one option per room agent."""
    sent = _deciding(monkeypatch, "kb")
    assert await classify.choose_agent(ROOM) == "kb"

    assert sent[0]["url"].endswith("/v1/chat/completions")
    body = sent[0]["body"]
    assert body["model"] == "agent-choice"
    # The gateway parses the body as a chat request, which needs `messages`.
    assert body["messages"] == []
    assert body["state"]["message"] == ROOM.text
    assert body["questions"]["agent"]["type"] == "choice"
    assert set(body["questions"]["agent"]["criteria"]) == {"def", "kb"}


@pytest.mark.anyio
async def test_an_agent_outside_the_room_is_never_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    """The answer is validated against the room's codes, so an invented one is refused."""
    _deciding(monkeypatch, "pa")
    with pytest.raises(ValidationError):
        await classify.choose_agent(ROOM)
