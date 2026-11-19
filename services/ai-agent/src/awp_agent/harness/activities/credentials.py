"""Replacing a run's credentials before they expire (#31).

A run token lives 30 minutes. A mission that waits for a person, or simply works for
longer than that, outlives it — and every call afterwards fails on an expired signature,
which reads as the platform breaking rather than the credential ending.

The platform mints the replacement, because the platform is what mints tokens. It
re-derives the grant rather than copying it: the current agent configuration intersected
with the run row's snapshot, so a tool revoked while the run was waiting is gone when it
resumes (D50). A run that has finished or been cancelled is refused one, which is what
stops a terminated run from acquiring a working credential.
"""

from __future__ import annotations

from pydantic import BaseModel
from temporalio import activity

from awp_agent.clients import platform_mcp
from awp_agent.harness.types import Actor, RunCredentials

REFRESH_TOOL = "run_token_refresh"


class RefreshRequest(BaseModel):
    """Which run needs new credentials, and what it currently authenticates with."""

    run_id: str
    actor: Actor


@activity.defn(name="refresh_credentials")
async def refresh_credentials(request: RefreshRequest) -> RunCredentials:
    """Ask the platform for fresh tokens, or come back empty.

    Empty rather than raised: a refresh that fails is not a reason to take the run down.
    The run carries on with what it has, and the next call that needs the credential
    fails with its own honest message.
    """
    try:
        payload = await platform_mcp.call_tool(
            request.actor.plumbing_token,
            REFRESH_TOOL,
            {"run_id": request.run_id},
        )
    except Exception as problem:  # noqa: BLE001 - any failure here is the same outcome
        activity.logger.warning(
            "run %s could not refresh its credentials: %s", request.run_id, problem
        )
        return RunCredentials()
    if not isinstance(payload, dict):
        return RunCredentials()
    return RunCredentials(
        mcp_token=str(payload.get("mcp_token", "")),
        harness_token=str(payload.get("harness_token", "")),
        granted_tools=[str(name) for name in payload.get("granted_tools", [])],
        expires_at=str(payload.get("expires_at", "")),
    )
