"""An approval nobody decides in time is a denial the model reads, not a failed mission.

The mission workflow is the real one; only its model is replaced. `ApprovalMission`
answers the two model turns itself: the first asks for a T2 call, the second reports what
the platform told it about that call. Raising the approval and writing the outcome back
are the platform's activities, answered here by stand-ins on the test worker.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, cast

from pydantic_ai.agent import AgentRunResult
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from pydantic_ai.messages import ModelMessage, ToolCallPart
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolDenied
from pydantic_ai.usage import RunUsage
from temporalio import activity, workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

# Passed through, as `mission/runtime.py` does: the sandbox re-imports this module, and the
# platform client behind these modules is HTTP code a workflow may not load itself.
with workflow.unsafe.imports_passed_through():
    from awp_agent.harness.activities.finalize import FinalizeInput
    from awp_agent.harness.types import RunStatus
    from awp_agent.mission.approvals import ApprovalWanted
    from awp_agent.mission.deps import MissionDeps
    from awp_agent.mission.runtime import Mission, MissionOutcome, MissionWorkflow

CALL_ID = "call-publish-1"


@dataclass
class _Result:
    """What the workflow reads of a run: its output, its messages and its usage."""

    output: Any
    usage: RunUsage = field(default_factory=RunUsage)

    def all_messages(self) -> list[ModelMessage]:
        return []


@workflow.defn(name="ApprovalMission")
class ApprovalMission(MissionWorkflow):
    """The mission workflow, with the model's two turns written out."""

    async def _run_until_cancelled(
        self, mission: Mission, results: DeferredToolResults | None
    ) -> AgentRunResult[Any]:
        if results is None:
            publish = ToolCallPart(
                tool_name="request_type_publish", args={"code": "RT-1"}, tool_call_id=CALL_ID
            )
            return cast(AgentRunResult[Any], _Result(DeferredToolRequests(approvals=[publish])))
        decided = results.approvals[CALL_ID]
        presented = (getattr(decided, "override_args", None) or {}).get("__approval")
        told = decided.message if isinstance(decided, ToolDenied) else f"approved with {presented}"
        return cast(AgentRunResult[Any], _Result(f"the platform said: {told}"))

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


@activity.defn(name="create_approval")
async def raise_approval(_wanted: ApprovalWanted) -> str:
    return "approval-1"


@activity.defn(name="finalize")
async def record_outcome(_outcome: FinalizeInput) -> None:
    return None


async def test_an_approval_nobody_decides_in_time_is_a_denial_the_mission_carries_on_from(
    temporal_env: WorkflowEnvironment,
) -> None:
    client = temporal_env.client
    deps = MissionDeps(
        run_id="run-a",
        person_id="person-1",
        mcp_token="model-token",
        harness_token="harness-token",
        route="reasoning-default",
        granted_tools=["request_type_publish"],
        tool_tiers={"request_type_publish": "T2"},
    )
    async with Worker(
        client,
        task_queue="approvals",
        workflows=[ApprovalMission],
        activities=[raise_approval, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        # The time-skipping server moves past the 24-hour wait once nothing else runs.
        handle = await client.start_workflow(
            ApprovalMission.run,
            Mission(prompt="Publish RT-1", deps=deps),
            id="mission-approval-expired",
            task_queue="approvals",
        )
        outcome = await handle.result()
        steps = await handle.query("steps")

    assert outcome.status is RunStatus.SUCCEEDED
    assert outcome.output == "the platform said: nobody approved this call in time"
    assert [(step["kind"], step["name"], step["outcome"]) for step in steps] == [
        ("Approval", "request_type_publish", "Expired")
    ]


async def test_an_approved_call_runs_again_carrying_the_approval_it_was_given(
    temporal_env: WorkflowEnvironment,
) -> None:
    """The server spends an approval only when the retried call presents it (D49, D71);
    an approved call that came back without it would be refused all over again."""
    client = temporal_env.client
    deps = MissionDeps(
        run_id="run-b",
        person_id="person-1",
        mcp_token="model-token",
        harness_token="harness-token",
        route="reasoning-default",
        granted_tools=["request_type_publish"],
        tool_tiers={"request_type_publish": "T2"},
    )
    async with Worker(
        client,
        task_queue="approvals-yes",
        workflows=[ApprovalMission],
        activities=[raise_approval, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        handle = await client.start_workflow(
            ApprovalMission.run,
            Mission(prompt="Publish RT-1", deps=deps),
            id="mission-approval-approved",
            task_queue="approvals-yes",
        )
        for _ in range(200):
            if str(await handle.query("status")) == RunStatus.WAITING:
                break
            await asyncio.sleep(0.05)
        await handle.signal(
            "approve", {"call_id": CALL_ID, "approved": True, "decided_by": "p-2", "note": ""}
        )
        outcome = await handle.result()

    assert outcome.output == "the platform said: approved with approval-1"


async def test_a_rejected_call_is_told_as_a_rejection_not_an_expiry(
    temporal_env: WorkflowEnvironment,
) -> None:
    """The model has to tell its person somebody said no, and why, not that nobody answered."""
    client = temporal_env.client
    deps = MissionDeps(
        run_id="run-c",
        person_id="person-1",
        mcp_token="model-token",
        harness_token="harness-token",
        route="reasoning-default",
        granted_tools=["request_type_publish"],
        tool_tiers={"request_type_publish": "T2"},
    )
    told: list[str] = []
    async with Worker(
        client,
        task_queue="approvals-no",
        workflows=[ApprovalMission],
        activities=[raise_approval, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        for run_id, note, changes in (
            ("mission-approval-rejected", "", False),
            ("mission-approval-rejected-why", "wrong code", False),
            ("mission-approval-changes", "use RT-2", True),
        ):
            handle = await client.start_workflow(
                ApprovalMission.run,
                Mission(prompt="Publish RT-1", deps=deps),
                id=run_id,
                task_queue="approvals-no",
            )
            for _ in range(200):
                if str(await handle.query("status")) == RunStatus.WAITING:
                    break
                await asyncio.sleep(0.05)
            await handle.signal(
                "approve",
                {
                    "call_id": CALL_ID,
                    "approved": False,
                    "decided_by": "p-2",
                    "note": note,
                    "changes_requested": changes,
                },
            )
            told.append((await handle.result()).output)
            steps = await handle.query("steps")
            assert [step["outcome"] for step in steps] == ["Denied"]

    assert told == [
        "the platform said: a person rejected this call",
        "the platform said: a person rejected this call: wrong code",
        # D285: a change request is told as one, so the model changes the call, not gives up.
        "the platform said: a person asked for changes to this call before it runs: use RT-2",
    ]
