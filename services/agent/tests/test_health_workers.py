"""`/healthz/workers` reports a task queue nobody polls, so a stalled worker shows up."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from awp_agent.api import health
from awp_agent.main import app


def client_with_pollers(pollers: dict[str, int]) -> Any:
    """A Temporal client whose task queues report `pollers[queue]` workers polling them."""

    async def describe_task_queue(request: Any, **_options: Any) -> object:
        return SimpleNamespace(pollers=[object()] * pollers.get(request.task_queue.name, 0))

    return SimpleNamespace(
        workflow_service=SimpleNamespace(describe_task_queue=describe_task_queue)
    )


@pytest.fixture
def api() -> TestClient:
    return TestClient(app)


def answering(client: Any) -> Any:
    async def temporal() -> Any:
        return client

    return temporal


def test_should_count_the_workers_polling_each_queue(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    pollers = {"agent-runs": 1, "ingestion": 2, "maintenance": 1}
    monkeypatch.setattr(health, "temporal", answering(client_with_pollers(pollers)))

    answer = api.get("/healthz/workers")

    assert answer.status_code == 200
    assert answer.json() == {
        "queues": {
            "agent-runs": {"pollers": 1},
            "ingestion": {"pollers": 2},
            "maintenance": {"pollers": 1},
        }
    }


def test_should_report_zero_for_a_queue_nobody_polls(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "temporal", answering(client_with_pollers({"ingestion": 1})))

    answer = api.get("/healthz/workers")

    assert answer.json()["queues"]["agent-runs"] == {"pollers": 0}
    assert answer.json()["queues"]["maintenance"] == {"pollers": 0}


def test_should_answer_503_when_temporal_is_not_connected(api: TestClient) -> None:
    assert api.get("/healthz/workers").status_code == 503
