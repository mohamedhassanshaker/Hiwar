"""`ScheduleFireWorkflow`: what a scheduled work item's own Temporal Schedule starts.

One short-lived run per occurrence (flow F-06): `lib/temporal.ts`'s `syncWorkItemSchedule`
creates the Schedule itself, on the `maintenance` task queue, the moment a schedule is saved
with a timed cadence.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from awp_agent.maintenance.activities import fire_schedule


@workflow.defn(name="ScheduleFireWorkflow")
class ScheduleFireWorkflow:
    """Tells the platform one scheduled work item is due, and nothing else."""

    @workflow.run
    async def run(self, scheduled_work_item_id: str) -> None:
        """Run the `fire_schedule` activity once, bounded at 1 minute and 3 attempts."""
        await workflow.execute_activity(
            fire_schedule,
            scheduled_work_item_id,
            start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
