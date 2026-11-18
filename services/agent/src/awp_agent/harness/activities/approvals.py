"""Approvals, confirmations and questions.

A T2 tool call pauses the run and creates an approval in the approver's Inbox; a T1 call asks
for a confirmation in the room or the widget; `ask_person` creates an agent question. All
three are domain records, so they are created through the platform MCP server, and all three
resume the run through a signal rather than by polling.
"""

from __future__ import annotations

from typing import Any

from ag_ui.core import CustomEvent
from pydantic import BaseModel, Field
from temporalio import activity

from awp_agent.clients import events, platform_mcp
from awp_agent.harness.types import Actor, ToolCallRequest, ToolTier

APPROVAL_TOOL = "approval_create"
QUESTION_TOOL = "agent_question_create"

CONFIRMATION_EVENT = "awp.tool.confirmation"
APPROVAL_EVENT = "awp.tool.approval"
QUESTION_EVENT = "awp.agent.question"


class ApprovalRequest(BaseModel):
    """The approval or confirmation one tool call needs."""

    run_id: str
    actor: Actor
    request: ToolCallRequest
    tier: ToolTier
    reason: str = ""
    context_type: str = ""
    context_id: str = ""


class ApprovalCreated(BaseModel):
    """What the platform created, so the run viewer can link to it."""

    approval_id: str = ""
    call_id: str = ""


class QuestionRequest(BaseModel):
    """A question the agent asks a person."""

    run_id: str
    actor: Actor
    question: str
    options: list[str] = Field(default_factory=list)
    context_type: str = ""
    context_id: str = ""


class QuestionCreated(BaseModel):
    """The question row the person answers."""

    question_id: str = ""


def _id_of(payload: Any) -> str:
    return str(payload.get("id", "")) if isinstance(payload, dict) else str(payload or "")


@activity.defn(name="request_approval")
async def request_approval(request: ApprovalRequest) -> ApprovalCreated:
    """Create the Inbox approval, or the room confirmation, and tell the attached browsers."""
    payload = await platform_mcp.call_tool(
        request.actor.plumbing_token,
        APPROVAL_TOOL,
        {
            "run_id": request.run_id,
            "tool_name": request.request.tool_name,
            # The run is blocked on a signal keyed by this, so a decision cannot resume it
            # without the platform knowing which call it was for.
            "call_id": request.request.call_id,
            "arguments": request.request.arguments,
            "tier": str(request.tier),
            "reason": request.reason,
            "context_type": request.context_type,
            "context_id": request.context_id,
        },
    )
    created = ApprovalCreated(approval_id=_id_of(payload), call_id=request.request.call_id)
    await events.publish(
        request.run_id,
        CustomEvent(
            name=CONFIRMATION_EVENT if request.tier is ToolTier.T1 else APPROVAL_EVENT,
            value={
                "callId": request.request.call_id,
                "approvalId": created.approval_id,
                "toolName": request.request.tool_name,
                "arguments": request.request.arguments,
                "tier": str(request.tier),
                "reason": request.reason,
            },
        ),
    )
    return created


@activity.defn(name="ask_person")
async def ask_person(request: QuestionRequest) -> QuestionCreated:
    """Create an agent question and tell the attached browsers it is waiting."""
    payload = await platform_mcp.call_tool(
        request.actor.plumbing_token,
        QUESTION_TOOL,
        {
            "run_id": request.run_id,
            "question": request.question,
            "options": request.options,
            "context_type": request.context_type,
            "context_id": request.context_id,
        },
    )
    created = QuestionCreated(question_id=_id_of(payload))
    await events.publish(
        request.run_id,
        CustomEvent(
            name=QUESTION_EVENT,
            value={
                "questionId": created.question_id,
                "question": request.question,
                "options": request.options,
            },
        ),
    )
    return created


class RunStartedRecord(BaseModel):
    """What the run viewer needs at the moment a run starts."""

    run_id: str
    #: The root mission this run belongs to, equal to `run_id` for a run a person
    #: started. One id across Phoenix, the gateway header and the spend key (D44).
    mission_id: str = ""
    agent_name: str = ""
    profile: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


@activity.defn(name="open_trace")
async def open_trace(record: RunStartedRecord) -> str:
    """Open the trace whose id is the run id, and return it."""
    from awp_agent import tracing

    return tracing.start_run(
        record.run_id,
        record.agent_name or record.profile,
        record.metadata,
        mission_id=record.mission_id,
    )
