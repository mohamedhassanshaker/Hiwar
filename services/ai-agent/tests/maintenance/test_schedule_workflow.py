"""The schedule workflow, on the Temporal test server.

The workflow is the real one; its activity is a stand-in registered under the real activity
name, so what is tested is what the workflow asks for and how often it tries before it gives up.
"""

from __future__ import annotations

import logging
from collections import Counter

import pytest
from temporalio import activity, workflow
from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    from awp_agent.maintenance.workflow import ScheduleFireWorkflow

#: How many times the activity was started.
ATTEMPTS: Counter[str] = Counter()
#: What the activity was handed, in order.
RECEIVED: list[str] = []
#: Whether the activity fails every attempt, as an unreachable platform would.
FAILING: set[str] = set()


@activity.defn(name="fire_schedule")
async def fire_schedule(schedule_id: str) -> None:
    ATTEMPTS["fire_schedule"] += 1
    if "fire_schedule" in FAILING:
        raise RuntimeError("the platform is unavailable")
    RECEIVED.append(schedule_id)


@pytest.fixture(autouse=True)
def _fresh(caplog: pytest.LogCaptureFixture) -> None:
    ATTEMPTS.clear()
    RECEIVED.clear()
    FAILING.clear()
    # A failing attempt logs its traceback; the count is what the tests read.
    caplog.set_level(logging.ERROR, logger="temporalio.activity")


async def _fire(env: WorkflowEnvironment, schedule_id: str) -> None:
    async with Worker(
        env.client,
        task_queue="maintenance-test",
        workflows=[ScheduleFireWorkflow],
        activities=[fire_schedule],
    ):
        await env.client.execute_workflow(
            ScheduleFireWorkflow.run,
            schedule_id,
            id=f"maintenance-test-{schedule_id}",
            task_queue="maintenance-test",
        )


async def test_a_schedule_firing_names_the_scheduled_item(
    temporal_env: WorkflowEnvironment,
) -> None:
    await _fire(temporal_env, "sched-42")

    assert RECEIVED == ["sched-42"]
    assert ATTEMPTS["fire_schedule"] == 1


async def test_a_firing_that_keeps_failing_is_tried_three_times_and_the_workflow_fails(
    temporal_env: WorkflowEnvironment,
) -> None:
    """A platform that stays down fails the workflow after three attempts, rather than
    leaving it retrying with nobody told."""
    FAILING.add("fire_schedule")

    with pytest.raises(WorkflowFailureError):
        await _fire(temporal_env, "sched-42")

    assert ATTEMPTS["fire_schedule"] == 3
