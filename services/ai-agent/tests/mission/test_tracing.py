"""What a mission records in Phoenix: the model calls with their prompt and answer, in the
run's own trace. The mission runs on the Temporal test server with a scripted model, and the
spans are read from an in-memory exporter instead of Phoenix.
"""

from __future__ import annotations

import json

from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from temporalio import activity, workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    from awp_agent.harness.activities.finalize import FinalizeInput
    from awp_agent.harness.types import RunStatus
    from awp_agent.mission.deps import MissionDeps
    from awp_agent.mission.runtime import Mission, MissionOutcome, MissionWorkflow
    from tests.mission.traced_agent import ANSWER, EXPORTED, TRACED_AGENT, TRACED_MODEL

RUN_ID = "0a1b2c3d-0000-4000-8000-0000000000aa"


@workflow.defn(name="TracedMission")
class TracedMission(MissionWorkflow):
    """The real mission workflow, on the scripted model and the traced agent."""

    __pydantic_ai_agents__ = [TRACED_AGENT]  # noqa: RUF012 - the base declares it
    mission_agent = TRACED_AGENT
    mission_model = TRACED_MODEL

    @workflow.run
    async def run(self, mission: Mission) -> MissionOutcome:
        return await super().run(mission)


@activity.defn(name="finalize")
async def _finalize(_outcome: FinalizeInput) -> None:
    return None


async def test_a_mission_s_model_call_reaches_the_run_s_trace_with_its_prompt_and_answer(
    temporal_env: WorkflowEnvironment,
) -> None:
    EXPORTED.clear()
    deps = MissionDeps(
        run_id=RUN_ID,
        person_id="person-1",
        mcp_token="model-token",
        harness_token="harness-token",
        route="reasoning-default",
        granted_tools=[],
    )
    async with Worker(
        temporal_env.client,
        task_queue="traced",
        workflows=[TracedMission],
        activities=[_finalize],
        plugins=[PydanticAIPlugin()],
    ):
        outcome = await temporal_env.client.execute_workflow(
            TracedMission.run,
            Mission(prompt="Approve refund R-17?", deps=deps),
            id="traced-mission",
            task_queue="traced",
        )

    assert outcome.status is RunStatus.SUCCEEDED
    chats = [span for span in EXPORTED.get_finished_spans() if span.name.startswith("chat")]
    # One model call, recorded once although the workflow ran more than one task.
    assert len(chats) == 1
    attributes = chats[0].attributes or {}
    assert "Approve refund R-17?" in json.dumps(attributes.get("gen_ai.input.messages"))
    assert ANSWER in json.dumps(attributes.get("gen_ai.output.messages"))
    # "Open trace" on the run viewer looks the trace up by the run id.
    assert chats[0].context is not None
    assert format(chats[0].context.trace_id, "032x") == RUN_ID.replace("-", "")
