"""Activities for the `maintenance` task queue."""

from __future__ import annotations

import httpx
from temporalio import activity
from temporalio.exceptions import ApplicationError

from awp_agent.config import settings
from awp_agent.logging import logger

log = logger("awp_agent.maintenance")


@activity.defn(name="fire_schedule")
async def fire_schedule(schedule_id: str) -> None:
    """Tell the platform that one scheduled work item's Temporal Schedule just fired.

    Everything after that — the holiday and project checks, what gets created, the record
    of the firing — is `features/schedules/service.ts`'s `fireScheduled()`, the identical
    rule "Run now" already uses (flow F-06, `UC-31.1-03`).
    """
    token = settings().maintenance_api_token
    if not token:
        raise ApplicationError(
            "MAINTENANCE_API_TOKEN is not set; a Schedule cannot fire anything",
            non_retryable=True,
        )

    # `platform_mcp_url` is `.../api/mcp` on the same application; there is nothing this
    # route needs that a second, dedicated base URL would say any more plainly.
    base = settings().platform_mcp_url.removesuffix("/api/mcp")
    url = f"{base}/api/maintenance/schedules/{schedule_id}/fire"

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        response = await client.post(url, headers={"authorization": f"Bearer {token}"})

    if response.status_code == 404:
        # The row was deleted after the Schedule was created from it; nothing to retry.
        log.warning("a schedule fired for a row that no longer exists", schedule_id=schedule_id)
        return
    if response.status_code == 401:
        raise ApplicationError("the firing route refused this token", non_retryable=True)
    response.raise_for_status()
