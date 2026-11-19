"""The schedule firing, against a stand-in platform.

The firing is a plain HTTP call, answered by an `httpx` mock transport. Each test states what
reaches the platform and what a refusal turns into.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from temporalio.exceptions import ApplicationError

from awp_agent.config import settings
from awp_agent.maintenance.activities import fire_schedule


def _firing_route(
    monkeypatch: pytest.MonkeyPatch, status: int, *, token: str = "maintenance-token"
) -> list[httpx.Request]:
    """Answer the platform's firing route with `status`, recording each request."""
    monkeypatch.setenv("MAINTENANCE_API_TOKEN", token)
    settings.cache_clear()
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status)

    real_client = httpx.AsyncClient

    def client(**options: Any) -> httpx.AsyncClient:
        return real_client(transport=httpx.MockTransport(answer), **options)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return seen


async def test_a_firing_posts_to_the_schedule_s_route_with_the_maintenance_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _firing_route(monkeypatch, 204)

    await fire_schedule("sched-42")

    [request] = seen
    assert request.method == "POST"
    # The platform's own address, from the configured MCP url without `/api/mcp`.
    assert str(request.url) == "http://127.0.0.1:1/api/maintenance/schedules/sched-42/fire"
    assert request.headers["authorization"] == "Bearer maintenance-token"


async def test_a_firing_for_a_schedule_that_no_longer_exists_is_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The row was deleted after its Schedule was made; there is nothing a retry can fix."""
    seen = _firing_route(monkeypatch, 404)

    # Returns rather than raising, so Temporal does not try again.
    await fire_schedule("sched-gone")
    assert len(seen) == 1


async def test_a_firing_the_platform_refuses_the_token_for_fails_without_retrying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _firing_route(monkeypatch, 401)

    with pytest.raises(ApplicationError) as refused:
        await fire_schedule("sched-42")

    assert refused.value.non_retryable is True


async def test_a_firing_the_platform_fails_on_is_raised_to_be_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _firing_route(monkeypatch, 503)

    with pytest.raises(httpx.HTTPStatusError):
        await fire_schedule("sched-42")


async def test_a_firing_with_no_maintenance_token_sends_nothing_and_does_not_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _firing_route(monkeypatch, 204, token="")

    with pytest.raises(ApplicationError) as refused:
        await fire_schedule("sched-42")

    assert refused.value.non_retryable is True
    assert seen == []
