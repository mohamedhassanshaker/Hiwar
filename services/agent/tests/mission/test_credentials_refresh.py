"""A run token lives 30 minutes, and a mission can outlive it (D82, D95).

The mission workflow is the real one; only its model turns are written out, as in
`test_approval_timeout.py`. What is checked is the token the run holds afterwards, since
every activity the run schedules is given the run's deps.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast

from pydantic_ai.agent import AgentRunResult
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from pydantic_ai.messages import ModelMessage, ToolCallPart
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults
from pydantic_ai.usage import RunUsage
from temporalio import activity, workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    from awp_agent.harness.activities.credentials import RefreshRequest
    from awp_agent.harness.activities.finalize import FinalizeInput
    from awp_agent.harness.types import RunCredentials, RunStatus
    from awp_agent.mission.approvals import ApprovalWanted
    from awp_agent.mission.deps import MissionDeps
    from awp_agent.mission.runtime import Mission, MissionOutcome, MissionWorkflow

CALL_ID = "call-publish-1"


@dataclass
class _Result:
    output: Any
    usage: RunUsage = field(default_factory=RunUsage)

    def all_messages(self) -> list[ModelMessage]:
        return []


def _tokens(mission: Mission) -> str:
    return f"{mission.deps.mcp_token} {mission.deps.harness_token}"


@workflow.defn(name="ResumedMission")
class ResumedMission(MissionWorkflow):
    """Asks for a T2 call, then reports the tokens it resumed with."""

    async def _run_until_cancelled(
        self, mission: Mission, results: DeferredToolResults | None
    ) -> AgentRunResult[Any]:
        if results is None:
            publish = ToolCallPart(
                tool_name="request_type_publish", args={"code": "RT-1"}, tool_call_id=CALL_ID
            )
            return cast(AgentRunResult[Any], _Result(DeferredToolRequests(approvals=[publish])))
        return cast(AgentRunResult[Any], _Result(_tokens(mission)))

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


@workflow.defn(name="LongMission")
class LongMission(MissionWorkflow):
    """Works for 40 minutes with the refresh running beside it, as a real run has."""

    async def _run_until_cancelled(
        self, mission: Mission, results: DeferredToolResults | None
    ) -> AgentRunResult[Any]:
        refreshing = asyncio.create_task(self._keep_fresh(mission.deps))
        await workflow.sleep(timedelta(minutes=40))
        refreshing.cancel()
        return cast(AgentRunResult[Any], _Result(_tokens(mission)))

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


refreshed: list[RefreshRequest] = []


@activity.defn(name="refresh_credentials")
async def mint(request: RefreshRequest) -> RunCredentials:
    refreshed.append(request)
    return RunCredentials(
        mcp_token=f"model-{len(refreshed)}", harness_token=f"harness-{len(refreshed)}"
    )


@activity.defn(name="create_approval")
async def raise_approval(_wanted: ApprovalWanted) -> str:
    return "approval-1"


@activity.defn(name="finalize")
async def record_outcome(_outcome: FinalizeInput) -> None:
    return None


def _deps(run_id: str) -> MissionDeps:
    return MissionDeps(
        run_id=run_id,
        person_id="person-1",
        mcp_token="model-token",
        harness_token="harness-token",
        route="reasoning-default",
        granted_tools=["request_type_publish"],
        tool_tiers={"request_type_publish": "T2"},
    )


async def test_a_decision_brings_fresh_tokens_that_the_resumed_run_carries_on_with(
    temporal_env: WorkflowEnvironment,
) -> None:
    """An approval can come after the run's tokens expired; the platform sends new ones with
    it, and every call after the pause goes out on them."""
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="resumed",
        workflows=[ResumedMission],
        activities=[raise_approval, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        handle = await client.start_workflow(
            ResumedMission.run,
            Mission(prompt="Publish RT-1", deps=_deps("run-r")),
            id="resumed",
            task_queue="resumed",
        )
        for _ in range(200):
            if str(await handle.query("status")) == RunStatus.WAITING:
                break
            await asyncio.sleep(0.05)
        await handle.signal(
            "approve",
            {
                "call_id": CALL_ID,
                "approved": True,
                "decided_by": "p-2",
                "mcp_token": "model-new",
                "harness_token": "harness-new",
            },
        )
        outcome = await handle.result()

    assert outcome.output == "model-new harness-new"


async def test_a_run_working_past_its_tokens_lifetime_replaces_them_before_they_expire(
    temporal_env: WorkflowEnvironment,
) -> None:
    """Refreshed at 25 minutes, on the run's own plumbing credential, so a 40-minute run
    never calls the platform with an expired token."""
    refreshed.clear()
    client = temporal_env.client
    async with Worker(
        client,
        task_queue="long",
        workflows=[LongMission],
        activities=[mint, record_outcome],
        plugins=[PydanticAIPlugin()],
    ):
        outcome = await client.execute_workflow(
            LongMission.run,
            Mission(prompt="Work a while", deps=_deps("run-l")),
            id="long",
            task_queue="long",
        )

    assert outcome.output == "model-1 harness-1"
    assert [(one.run_id, one.actor.plumbing_token) for one in refreshed] == [
        ("run-l", "harness-token")
    ]
