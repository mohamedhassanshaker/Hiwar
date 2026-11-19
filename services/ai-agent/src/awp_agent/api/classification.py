"""Turning free text into a request type and its values."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from awp_agent import classify as classification
from awp_agent.logging import logger

log = logger("awp_agent.api.classification")

router = APIRouter()


@router.post("/classify/request")
async def classify_request(request: classification.ClassifyRequest) -> dict[str, Any]:
    """`UC-28.2-01`: what somebody wrote, turned into a request type and its values.

    503 when the typesafe route could not produce valid output after its retries, which is
    what the console turns into an offer to use the template form instead.
    """
    answer = await classification.classify_or_none(request)
    if answer is None:
        raise HTTPException(
            status_code=503, detail="the classification route did not return valid output"
        )
    return answer


@router.post("/classify/agent")
async def choose_agent(request: classification.ChooseAgentRequest) -> dict[str, str]:
    """D289: which of a room's agents answers a person's message that names none.

    503 when the typesafe route could not produce a valid choice, which the room turns into
    its lead agent answering.
    """
    try:
        return {"agent_code": await classification.choose_agent(request)}
    except Exception as problem:
        log.warning("classify.agent_failed", problem=str(problem))
        raise HTTPException(
            status_code=503, detail="the classification route did not return a valid choice"
        ) from problem
