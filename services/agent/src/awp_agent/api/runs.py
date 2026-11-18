"""The AG-UI run endpoints: start a mission, stream it, signal it, read its outcome."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import EventType, RunStartedEvent
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from temporalio.client import WorkflowFailureError
from temporalio.service import RPCError

from awp_agent.api.temporal import temporal
from awp_agent.clients import events
from awp_agent.config import settings
from awp_agent.harness.types import (
    AnswerSignal,
    ApprovalSignal,
    RunInput,
    RunResult,
    RunStatus,
)
from awp_agent.mission.runtime import Mission, MissionWorkflow, mission_deps
from awp_agent.mission.skills import granted_skills

router = APIRouter()


class StartRunResponse(BaseModel):
    """What the console gets back when it starts a run."""

    run_id: str
    workflow_id: str


def workflow_id(run_id: str) -> str:
    """One workflow per run, named after it, so a retry can never start a second one."""
    return f"run-{run_id}"


@router.post("/agui/runs", response_model=StartRunResponse)
async def start_run(request: RunInput) -> StartRunResponse:
    """Start an agent run as a Temporal workflow and return straight away."""
    client = await temporal()
    await events.publish(
        request.run_id, RunStartedEvent(thread_id=request.context_id, run_id=request.run_id)
    )
    # Read here: the mission is a workflow, which may not touch the filesystem or the
    # object store.
    skills = await granted_skills(request.skills, settings().skills_path)
    await client.start_workflow(
        MissionWorkflow.run,
        Mission(
            prompt=request.task.description or request.task.title,
            deps=mission_deps(request, skills),
            title=request.task.title,
        ),
        id=workflow_id(request.run_id),
        task_queue=settings().temporal_task_queue,
    )
    return StartRunResponse(run_id=request.run_id, workflow_id=workflow_id(request.run_id))


#: The AG-UI events after which a run sends nothing more.
TERMINAL_EVENTS = frozenset({EventType.RUN_FINISHED.value, EventType.RUN_ERROR.value})


def _event_type(payload: str) -> str | None:
    """An encoded event's `type`, or None for a payload that is not an event object."""
    try:
        decoded = json.loads(payload)
    except ValueError:
        return None
    return decoded.get("type") if isinstance(decoded, dict) else None


@router.get("/agui/runs/{run_id}/stream")
async def stream_run(run_id: str) -> StreamingResponse:
    """The AG-UI event stream of one run, as server-sent events.

    It closes after the run's terminal event: an AG-UI client ends a run when its stream ends,
    so a stream left open keeps the run looking busy after it has finished.
    """

    async def body() -> AsyncIterator[str]:
        """Each published event as one `data:` frame, ending after the terminal event."""
        async for payload in events.stream(run_id):
            yield f"data: {payload}\n\n"
            if _event_type(payload) in TERMINAL_EVENTS:
                return

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )


@router.get("/agui/runs/{run_id}/events")
async def run_events(run_id: str) -> list[str]:
    """Every event published for a run so far. Used by the run viewer, which does not stream."""
    return await events.backlog(run_id)


@router.get("/agui/runs/{run_id}")
async def run_status(run_id: str) -> dict[str, Any]:
    """The run's status and timeline, read from the workflow rather than a copy of it."""
    client = await temporal()
    handle = client.get_workflow_handle(workflow_id(run_id))
    try:
        status: RunStatus = await handle.query("status")
        steps = await handle.query("steps")
    except RPCError as problem:
        raise HTTPException(status_code=404, detail=f"no run {run_id}") from problem
    return {"runId": run_id, "status": status, "steps": steps}


@router.post("/agui/runs/{run_id}/approve")
async def approve(run_id: str, decision: ApprovalSignal) -> Response:
    """Deliver an Inbox decision or a room confirmation to a waiting run."""
    client = await temporal()
    await client.get_workflow_handle(workflow_id(run_id)).signal("approve", decision)
    return Response(status_code=202)


@router.post("/agui/runs/{run_id}/answer")
async def answer(run_id: str, reply: AnswerSignal) -> Response:
    """Deliver a person's answer to an agent question."""
    client = await temporal()
    await client.get_workflow_handle(workflow_id(run_id)).signal("answer", reply)
    return Response(status_code=202)


@router.post("/agui/runs/{run_id}/cancel")
async def cancel(run_id: str) -> Response:
    """Ask a run to stop at its next safe point."""
    client = await temporal()
    await client.get_workflow_handle(workflow_id(run_id)).signal("cancel")
    return Response(status_code=202)


@router.get("/agui/runs/{run_id}/result", response_model=RunResult)
async def result(run_id: str) -> RunResult:
    """Wait for a run and return its result. Used by the request and work-item flows.

    The mission returns an outcome — a status and an answer — and the callers want a
    `RunResult`. The rest of that shape is the platform's own record, already written by
    `finalize`, so it is left at its defaults here rather than restated from the mission.
    """
    client = await temporal()
    handle = client.get_workflow_handle_for(MissionWorkflow.run, workflow_id(run_id))
    try:
        outcome = await handle.result()
    except WorkflowFailureError as problem:
        raise HTTPException(status_code=500, detail=str(problem)) from problem
    return RunResult(run_id=run_id, status=outcome.status, output=outcome.output)
