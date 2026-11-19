"""The platform half of an approval, for the generic runtime (D84).

The library pauses a call and resumes it; the platform decides whether a person agreed.
This module is only the crossing between them: it turns a paused tool call into a bound
approval in somebody's Inbox, and carries their decision back as a signal.

Nothing here judges anything. The binding — tool, canonical arguments, record version,
expiry, single use — is the platform MCP server's, and it refuses a call that cannot
show one whatever this module or the harness believes (D20, D49).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from temporalio import activity

from awp_agent.clients import platform_mcp
from awp_agent.mission.stream import tell_panel

APPROVAL_TOOL = "approval_create"


class ApprovalWanted(BaseModel):
    """One paused call, as the platform needs it to raise an approval."""

    run_id: str
    call_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    #: T2 for a tool that always needs a person; T1 for a call the server escalated.
    tier: str = "T2"
    #: Why the server escalated it, when it did; what the approver reads.
    reason: str = ""
    #: The plumbing credential. Approvals are recorded on the harness token, never the
    #: model's, so a model that learns the tool's name still cannot approve itself.
    harness_token: str = ""


class ApprovalDecision(BaseModel):
    """A person's answer, delivered to the waiting mission as a signal."""

    call_id: str
    approved: bool
    decided_by: str = ""
    note: str = ""
    #: The person asked for the call to be changed rather than refusing it (D285).
    changes_requested: bool = False
    #: Fresh credentials the platform minted as it sent this, so a mission resumed after a
    #: long pause does not carry on with expired tokens (D82). Empty from an older platform.
    mcp_token: str = ""
    harness_token: str = ""


@activity.defn(name="create_approval")
async def create_approval(wanted: ApprovalWanted) -> str:
    """Raise the Inbox approval this call is waiting on, tell the panel, and return its id.

    The id is what the retry presents to the server, which spends it once against the
    exact arguments it was created from. An empty id means the platform refused to raise
    one, and the mission treats that as "not approved" rather than proceeding.
    """
    payload = await platform_mcp.call_tool(
        wanted.harness_token,
        APPROVAL_TOOL,
        {
            "run_id": wanted.run_id,
            "tool_name": wanted.tool_name,
            "call_id": wanted.call_id,
            "arguments": wanted.arguments,
            "tier": wanted.tier,
            "reason": wanted.reason
            or f"{wanted.tool_name} needs a person's approval before it runs.",
        },
    )
    approval_id = str(payload.get("id", "")) if isinstance(payload, dict) else ""
    if approval_id:
        # The person watching the run sees that it waits, and on whom (D239).
        await tell_panel(
            wanted.run_id,
            "awp.tool.confirmation" if wanted.tier == "T1" else "awp.tool.approval",
            {
                "callId": wanted.call_id,
                "approvalId": approval_id,
                "approvalKey": str(payload.get("key", "")) if isinstance(payload, dict) else "",
                "toolName": wanted.tool_name,
                "tier": "T1" if wanted.tier == "T1" else "T2",
                "reason": wanted.reason,
            },
        )
    return approval_id
