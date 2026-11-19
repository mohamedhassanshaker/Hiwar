"""The Temporal worker entrypoint.

One process per task queue, so `agent-runs`, `ingestion` and `maintenance` scale apart —
the Helm chart runs one Deployment per queue from `.Values.agentWorkers`. The same Pydantic
data converter is used here and in `temporal_client`, or a payload written by one would not
deserialise in the other.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import replace
from typing import Any

import uvicorn
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.converter import DataConverter
from temporalio.service import RPCError, RPCStatusCode
from temporalio.worker import Worker

from awp_agent.config import settings
from awp_agent.harness.activities.approvals import open_trace
from awp_agent.harness.activities.credentials import refresh_credentials
from awp_agent.harness.activities.finalize import finalize
from awp_agent.ingestion.activities import (
    count_entities,
    extract_graph,
    index_document,
    parse_document,
)
from awp_agent.ingestion.workflow import IngestionWorkflow
from awp_agent.logging import configure, logger, use_selector_event_loop
from awp_agent.maintenance.activities import fire_schedule
from awp_agent.maintenance.workflow import ScheduleFireWorkflow
from awp_agent.mission.approvals import create_approval
from awp_agent.mission.delegation import register_child_mission
from awp_agent.mission.questions import create_question
from awp_agent.mission.runtime import MissionWorkflow
from awp_agent.mission.sandbox import release_sandbox
from awp_agent.temporal.codec import AesGcmCodec
from awp_agent.temporal.codec import enabled as codec_enabled
from awp_agent.temporal.storage import external_storage

log = logger("awp_agent.worker")

HEALTH_PATH = "/healthz"
DEFAULT_HEALTH_PORT = 8010

AGENT_RUNS = "agent-runs"
INGESTION = "ingestion"
MAINTENANCE = "maintenance"

QUEUES: dict[str, tuple[Sequence[type], Sequence[Callable[..., Any]]]] = {
    # One loop (D01, D120). `MissionWorkflow` brings the model request, the toolsets and
    # the tool calls through `PydanticAIPlugin`; what is registered beside it is the
    # platform's own half — the approval record, the question, the child mission, and
    # writing the outcome back.
    AGENT_RUNS: (
        [MissionWorkflow],
        [
            finalize,
            open_trace,
            refresh_credentials,
            create_approval,
            create_question,
            register_child_mission,
            release_sandbox,
        ],
    ),
    INGESTION: (
        [IngestionWorkflow],
        [parse_document, index_document, extract_graph, count_entities],
    ),
    MAINTENANCE: ([ScheduleFireWorkflow], [fire_schedule]),
}


async def health_app(
    scope: dict[str, Any],
    receive: Callable[[], Awaitable[dict[str, Any]]],
    send: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    """The only HTTP the worker serves: what its liveness probe asks for."""
    if scope["type"] != "http":
        return
    found = scope["path"] == HEALTH_PATH
    await send(
        {
            "type": "http.response.start",
            "status": 200 if found else 404,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": b'{"status":"ok"}' if found else b"{}"})


async def serve_health(port: int) -> None:
    """Answer the liveness probe for as long as the worker is serving its task queue."""
    config = uvicorn.Config(health_app, host="0.0.0.0", port=port, log_level="warning")
    await uvicorn.Server(config).serve()


def data_converter() -> DataConverter:
    """The Pydantic data converter, with payload encryption (D81) and external storage (D287).

    The codec is composed onto the converter rather than replacing it: the Pydantic
    payload converter still decides how a model becomes bytes, and the codec encrypts
    whatever those bytes are. One mechanism covers workflow arguments, activity inputs
    and results alike, so a sensitive field added to a payload later is covered because
    it is a payload — not because somebody remembered. A large payload, encrypted, is kept
    in the object store with a reference in the history (D287).
    """
    return replace(
        pydantic_data_converter,
        payload_codec=AesGcmCodec() if codec_enabled() else None,
        external_storage=external_storage(),
    )


async def connect() -> Client:
    """A Temporal client with the platform's data converter."""
    config = settings()
    return await Client.connect(
        config.temporal_address,
        namespace=config.temporal_namespace,
        data_converter=data_converter(),
    )


async def require_namespace(client: Client, namespace: str) -> None:
    """Stop the process when the Temporal namespace is not registered yet.

    A worker started before `scripts/temporal-namespace.sh` has registered the namespace
    connects, logs a NotFound warning and then serves nothing for ever without exiting, so
    Kubernetes never restarts it: on 2026-10-31 every run stayed Running until the three
    workers were restarted by hand. Exiting instead lets the restart policy try again, with
    its back-off, until the namespace exists.
    """
    try:
        await client.workflow_service.describe_namespace(
            DescribeNamespaceRequest(namespace=namespace)
        )
    except RPCError as error:
        if error.status != RPCStatusCode.NOT_FOUND:
            raise
        log.error("worker.namespace_missing", namespace=namespace)
        raise SystemExit(f"Temporal namespace {namespace} is not registered yet") from error


async def run_worker(task_queue: str, health_port: int | None = None) -> None:
    """Serve one task queue until the process is stopped.

    With a health port, the liveness endpoint is served from inside the worker's own
    context, so it stops answering the moment the worker stops.
    """
    if task_queue not in QUEUES:
        raise SystemExit(f"{task_queue} is not one of {', '.join(sorted(QUEUES))}")
    workflows, activities = QUEUES[task_queue]
    client = await connect()
    await require_namespace(client, settings().temporal_namespace)
    log.info("worker.start", task_queue=task_queue, namespace=settings().temporal_namespace)
    # `PydanticAIPlugin` walks each registered workflow's `__pydantic_ai_agents__` and
    # registers that agent's durable activities — the model request and the toolsets —
    # which is how `MissionWorkflow` gets its loop without the platform naming any of it.
    async with Worker(
        client,
        task_queue=task_queue,
        workflows=workflows,
        activities=activities,
        plugins=[PydanticAIPlugin()],
    ):
        if health_port is None:
            await asyncio.Event().wait()
        else:
            await serve_health(health_port)


def main() -> None:
    """The container entrypoint: `awp-agent-worker [task-queue]`."""
    configure(settings().log_level)
    use_selector_event_loop()
    queue = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TEMPORAL_TASK_QUEUE", AGENT_RUNS)
    port = int(os.environ.get("AWP_WORKER_HEALTH_PORT", DEFAULT_HEALTH_PORT))
    asyncio.run(run_worker(queue, port))


if __name__ == "__main__":
    main()
