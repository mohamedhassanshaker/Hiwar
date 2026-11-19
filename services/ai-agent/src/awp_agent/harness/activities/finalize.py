"""Stage five: finish.

Write the outputs and the context handoff through the platform MCP server, update the run's
estimated cost and eval scores, and close the trace. The handoff is what the next run
in the same room, work item or request reads first.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

from ag_ui.core import RunFinishedEvent
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.exceptions import AgentRunError
from temporalio import activity

from awp_agent import tracing
from awp_agent.clients import events, gateway_client, platform_mcp
from awp_agent.harness.types import Actor, ContextHandoff, RunStatus, RunStepRecord, TaskFrame
from awp_agent.logging import logger

log = logger("awp_agent.harness.activities.finalize")

HANDOFF_INSTRUCTIONS = """\
Write the handoff the next agent reads before it continues this work: the goal in one line,
the decisions that were taken, the questions still open, and the single next step. Use the
language of the work. Say nothing you were not told.
"""

FINISH_TOOL = "run_finish"

#: How long the handoff's model call may take, well inside the activity's own timeout.
HANDOFF_TIMEOUT_SECONDS = 60.0

#: How much of a room run's answer its handoff keeps (D351).
ROOM_HANDOFF_ANSWER_CHARS = 1000


class FinalizeInput(BaseModel):
    """What the run produced, and what the platform has to record."""

    run_id: str
    actor: Actor
    route: str
    status: RunStatus
    task: TaskFrame
    output: str = ""
    transcript: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    tool_call_count: int = 0
    estimated_cost_aed: Decimal = Decimal("0")
    eval_scores: dict[str, float] = Field(default_factory=dict)
    handoff: ContextHandoff | None = None
    #: What the run is about (`Room`, `WorkItem`, `Request`, `Console`).
    context_type: str = ""
    # The run viewer's timeline: every model, tool, approval and verify step the workflow
    # recorded. Written here rather than read back later — the workflow's own history is
    # Temporal's, not a document this application may query.
    steps: list[RunStepRecord] = Field(default_factory=list)


class FinalizeResult(BaseModel):
    """The handoff that was written and the trace it was recorded under."""

    handoff: ContextHandoff
    trace_id: str = ""
    recorded: bool = False


async def _write_handoff(route: str, task: TaskFrame, transcript: str) -> ContextHandoff:
    """Ask the model on `route` to summarise the task and transcript as a `ContextHandoff`.

    One model call through the gateway, bounded by `HANDOFF_TIMEOUT_SECONDS`. A call that
    fails, times out or cannot produce the structured output yields a handoff carrying only
    the task's title (or the start of its description).
    """
    agent: Agent[None, ContextHandoff] = Agent(
        gateway_client.model_for_route(route),
        name="awp-handoff",
        instructions=HANDOFF_INSTRUCTIONS,
        output_type=ContextHandoff,
    )
    prompt = f"Task: {task.title}\n{task.description}\n\nWhat happened:\n{transcript}"
    try:
        async with asyncio.timeout(HANDOFF_TIMEOUT_SECONDS):
            return (await agent.run(prompt)).output
    except (AgentRunError, TimeoutError) as problem:
        # The handoff is a courtesy to whatever reads this run next, not the run's own
        # result, which by this point already exists. The route is often the one that just
        # failed the mission, and a handoff it cannot write must not stop `run_finish`.
        log.warning(
            "handoff generation failed; recording the task's own title instead",
            error=str(problem),
        )
        return ContextHandoff(goal=task.title or task.description[:200])


def _room_handoff(task: TaskFrame, output: str) -> ContextHandoff:
    """A room run's handoff, from its task and answer without a model call (D351).

    The reply is posted only once `run_finish` has the handoff, and a model call there kept the
    room waiting a median 8 s after the answer had streamed; nothing reads a room's handoff
    beyond the record (D236).
    """
    answer = output.strip()
    return ContextHandoff(
        goal=task.title or task.description[:200],
        decisions=[answer[:ROOM_HANDOFF_ANSWER_CHARS]] if answer else [],
    )


def _step_payload(record: RunStepRecord) -> dict[str, object]:
    """One `RunStepRecord`, as the `run_finish` tool's `steps` schema expects it."""
    return {
        "seq": record.seq,
        "type": str(record.type),
        "name": record.name,
        "status": record.status,
        "result": record.result,
        "hooks_applied": record.hooks_applied,
        "estimated_cost_aed": str(record.estimated_cost_aed),
        "started_at": record.started_at.isoformat(),
        "ended_at": (record.ended_at or record.started_at).isoformat(),
    }


@activity.defn(name="finalize")
async def finalize(step: FinalizeInput) -> FinalizeResult:
    """Write the handoff and the run's totals, and close the trace."""
    if step.handoff is not None:
        handoff = step.handoff
    elif step.context_type == "Room":
        handoff = _room_handoff(step.task, step.output)
    else:
        handoff = await _write_handoff(step.route, step.task, step.transcript)

    recorded = False
    try:
        await platform_mcp.call_tool(
            step.actor.plumbing_token,
            FINISH_TOOL,
            {
                "run_id": step.run_id,
                "status": str(step.status),
                "output": step.output,
                "handoff": handoff.model_dump(),
                "tokens_in": step.tokens_in,
                "tokens_out": step.tokens_out,
                "tool_call_count": step.tool_call_count,
                "estimated_cost_aed": str(step.estimated_cost_aed),
                "eval_scores": step.eval_scores,
                "steps": [_step_payload(record) for record in step.steps],
            },
        )
        recorded = True
    except platform_mcp.PlatformMcpError:
        # The run itself succeeded; the platform will reconcile the header from Temporal.
        recorded = False

    trace_id = tracing.close_run(step.run_id, step.status, step.eval_scores)
    await events.publish(
        step.run_id,
        RunFinishedEvent(thread_id=step.run_id, run_id=step.run_id),
    )
    return FinalizeResult(handoff=handoff, trace_id=trace_id, recorded=recorded)
