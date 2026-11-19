"""The two pieces the Helm chart runs directly: the init containers' wait and the worker's
liveness endpoint. Both are commands in `infra/charts/awp/templates/`, so a rename here
breaks a Pod rather than a test, which is why they are covered."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable
from typing import Any

import pytest

from awp_agent import wait_for
from awp_agent.worker import HEALTH_PATH, health_app


@pytest.fixture
async def listener() -> AsyncIterator[int]:
    """A socket that accepts and closes, on a port the operating system chooses."""
    server = await asyncio.start_server(lambda reader, writer: writer.close(), "127.0.0.1", 0)
    port = int(server.sockets[0].getsockname()[1])
    async with server:
        yield port


async def test_tcp_probe_finds_a_listening_port(listener: int) -> None:
    assert await wait_for.probe(f"127.0.0.1:{listener}") is True


async def test_tcp_probe_reports_a_closed_port() -> None:
    assert await wait_for.probe("127.0.0.1:1") is False


async def test_a_target_that_is_neither_an_address_nor_a_url_is_rejected() -> None:
    with pytest.raises(SystemExit):
        await wait_for.probe("temporal-frontend")


async def test_waiting_gives_up_at_the_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wait_for, "PROBE_INTERVAL", 0.01)
    assert await wait_for.wait_for("127.0.0.1:1", seconds=0.05) is False


async def test_waiting_returns_as_soon_as_the_target_answers(listener: int) -> None:
    assert await wait_for.wait_for(f"127.0.0.1:{listener}", seconds=1.0) is True


async def _call(path: str) -> tuple[int, bytes]:
    """Drive the worker's ASGI health app directly, the way uvicorn would."""
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    await health_app({"type": "http", "path": path}, receive, send)
    return int(sent[0]["status"]), bytes(sent[1]["body"])


async def test_the_worker_health_endpoint_answers_its_own_path() -> None:
    status, body = await _call(HEALTH_PATH)
    assert status == 200
    assert b"ok" in body


async def test_the_worker_health_endpoint_answers_nothing_else() -> None:
    status, _ = await _call("/metrics")
    assert status == 404


async def test_a_lifespan_scope_is_ignored() -> None:
    async def receive() -> dict[str, Any]:
        return {"type": "lifespan.startup"}

    async def send(message: dict[str, Any]) -> None:
        raise AssertionError("a lifespan scope must not be answered")

    sent: Awaitable[None] = health_app({"type": "lifespan", "path": "/"}, receive, send)
    await sent
