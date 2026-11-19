"""The readiness probe."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter
from temporalio.api.enums.v1 import TaskQueueType
from temporalio.api.taskqueue.v1 import TaskQueue
from temporalio.api.workflowservice.v1 import DescribeTaskQueueRequest

from awp_agent import tracing
from awp_agent.api.temporal import connected, temporal
from awp_agent.clients import events, gateway_client
from awp_agent.config import settings
from awp_agent.ingestion import vectors
from awp_agent.worker import QUEUES

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, Any]:
    """The readiness probe, and what the System screen aggregates for this service."""
    checks = {
        "temporal": connected(),
        "gateway": await gateway_client.gateway_healthy(),
        "events": await events.bus_healthy(),
        "vectors": await vectors.vectors_healthy(),
        "tracing": await tracing.tracing_healthy(),
    }
    return {"status": "ok" if checks["temporal"] else "degraded", "checks": checks}


@router.get("/healthz/workers")
async def workers() -> dict[str, Any]:
    """How many workers poll each task queue, for the System screen (UC-78.1-01).

    Temporal can be up while nothing serves a queue: on 2026-10-31 the three workers had
    stopped polling and every run stayed Running while each socket still answered. A queue
    with no poller is the signal; Temporal remembers recent pollers for a few minutes, so a
    worker that has just died still counts briefly. 503 when Temporal is not connected.
    """
    client = await temporal()
    namespace = settings().temporal_namespace
    queues: dict[str, dict[str, int]] = {}
    for queue in QUEUES:
        answer = await client.workflow_service.describe_task_queue(
            DescribeTaskQueueRequest(
                namespace=namespace,
                task_queue=TaskQueue(name=queue),
                task_queue_type=TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW,
            ),
            timeout=timedelta(seconds=2),
        )
        queues[queue] = {"pollers": len(answer.pollers)}
    return {"queues": queues}
