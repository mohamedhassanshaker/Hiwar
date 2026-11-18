import * as requests from "@/features/requests/service";
import * as workItems from "@/features/work-items/service";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { requirePermission, requireProjectPermission, runAs } from "@/lib/session";
import { nextRunAfter, skipReasonFor } from "./firing";
import * as repository from "./repository";
import { ScheduleRejected } from "./errors";

/** What one firing did, which is what the list shows as Last run. */
export type FiringOutcome = { outcome: "Created" | "Skipped" | "Failed"; detail: string | null; createdKey: string | null };

/**
 * Fire one schedule now (`UC-31.1-03`).
 *
 * This is the only place a schedule turns into work, so Run now and the timer produce the
 * same thing under the same rules. Every firing is recorded, including the ones that
 * produce nothing: a schedule that quietly did nothing cannot be told from one that never
 * ran at all.
 *
 * Run now needs `schedules:write` in the schedule's project. A timer firing acts as the
 * schedule's owner, and what it creates is checked by the request and work item create paths.
 */
export async function fire(id: string, manual: boolean): Promise<FiringOutcome> {
  const session = await requirePermission("schedules:write");

  const schedule = await repository.readForFiring(id);
  if (!schedule) throw new ScheduleRejected("That scheduled work item no longer exists.", "لم يعد بند العمل المجدول هذا موجوداً.");
  if (manual) await requireProjectPermission("schedules:write", schedule.projectId);

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const calendar = await repository.workingCalendar(day);
  const skip = skipReasonFor({
    // Run now is a person asking for this firing, so a paused schedule is not a reason to
    // refuse it; a paused project still is, because the project is closed to new work.
    scheduleStatus: manual ? "Active" : schedule.status,
    projectStatus: schedule.projectStatus,
    skipHolidaysAndWeekends: !manual && schedule.skipHolidaysAndWeekends,
    day,
    weekday: now.getUTCDay() === 0 ? 7 : now.getUTCDay(),
    workingDays: calendar.workingDays,
    isHoliday: calendar.isHoliday,
  });

  if (skip) {
    await repository.recordFiring({ scheduleId: id, outcome: "Skipped", error: skip.detail, personId: session.personId });
    await auditFiring(session, manual, schedule.id, "Skipped", skip.detail);
    return { outcome: "Skipped", detail: skip.detail, createdKey: null };
  }

  try {
    const created = await createFrom(schedule);
    await repository.recordFiring({
      scheduleId: id,
      outcome: "Created",
      workItemId: created.workItemId,
      requestId: created.requestId,
      personId: session.personId,
    });
    await repository.setNextRun(id, nextRunAfter(schedule.repeats, now, schedule.timeOfDay), session.personId);
    await auditFiring(session, manual, schedule.id, "Created", created.key);
    return { outcome: "Created", detail: null, createdKey: created.key };
  } catch (problem) {
    const detail = problem instanceof Error ? problem.message : String(problem);
    logger().warn({ schedule: id, problem: detail }, "a schedule fired and produced nothing");
    await repository.recordFiring({ scheduleId: id, outcome: "Failed", error: detail, personId: session.personId });
    await auditFiring(session, manual, schedule.id, "Failed", detail);
    return { outcome: "Failed", detail, createdKey: null };
  }
}

/**
 * What a firing produces: a work item, or a request when the schedule names a request type
 * (`UC-31.2-02`).
 *
 * `UC-31.2-08`: an agent that is paused or in error is still the assignee. The item is
 * created and waits for them, because the work was due whether or not the agent can start
 * it, and an item nobody can see is worse than one nobody has started.
 */
async function createFrom(schedule: NonNullable<Awaited<ReturnType<typeof repository.readForFiring>>>): Promise<{
  key: string;
  workItemId: string | null;
  requestId: string | null;
}> {
  if (schedule.createsRequestTypeId) {
    const key = await requests.createFromSchedule({
      requestTypeId: schedule.createsRequestTypeId,
      projectId: schedule.projectId,
      titleEn: schedule.titleEn,
      titleAr: schedule.titleAr,
      descriptionEn: schedule.instructionsEn,
    });
    return { key: key.key, workItemId: null, requestId: key.id };
  }

  // `UC-31.2-04`: a group audience has no one principal, so the item is created unassigned
  // and belongs to the group's queue until somebody takes it.
  const assignee =
    schedule.audienceType === "Group"
      ? undefined
      : schedule.audienceType === "Agent"
        ? (schedule.audienceAgentCode ?? undefined)
        : schedule.audienceId;

  const key = await workItems.createWorkItem({
    projectKey: schedule.projectKey,
    type: (schedule.createsWorkItemType ?? "Task") as "Task",
    titleEn: schedule.titleEn,
    titleAr: schedule.titleAr,
    descriptionEn: schedule.instructionsEn ?? undefined,
    assignee,
    priority: "Medium",
  });
  return { key, workItemId: await repository.workItemIdByKey(key), requestId: null };
}

/**
 * Audits one firing with its outcome and a note (the created key or the reason): a Run now as
 * `schedules:run_now` by the person, a timer firing as `schedules:fire` by the system on behalf
 * of the schedule's owner.
 */
async function auditFiring(
  session: { personId: string; nameEn: string },
  manual: boolean,
  scheduleId: string,
  outcome: string,
  detail: string | null,
): Promise<void> {
  await audit({
    actor: manual
      ? { type: "Person", id: session.personId, label: session.nameEn }
      : { type: "System", id: null, label: "Scheduled firing" },
    action: manual ? "schedules:run_now" : "schedules:fire",
    objectType: "ScheduledWorkItem",
    objectId: scheduleId,
    detail: { outcome, note: detail, ...(manual ? {} : { onBehalfOf: session.personId }) },
  });
}

/** `UC-31.1-03`: the Run now button. */
export async function runNow(id: string): Promise<FiringOutcome> {
  return fire(id, true);
}

/**
 * Flow F-06: fire one schedule from its own Temporal Schedule rather than from a person
 * on the screen. There is no cookie here, so `fire()` runs under the identity of whoever
 * last saved the schedule (its `created_by`) — the same `runAs` a platform MCP call uses to
 * let an agent act for a person — which is what makes the rule genuinely the schedule's own
 * rather than an invented system identity with permissions nobody granted.
 */
export async function fireScheduled(id: string): Promise<FiringOutcome> {
  const schedule = await repository.readForFiring(id);
  if (!schedule) throw new ScheduleRejected("That scheduled work item no longer exists.", "لم يعد بند العمل المجدول هذا موجوداً.");
  if (!schedule.createdBy) {
    throw new ScheduleRejected("This schedule has no owner left to fire it.", "لم يعد لهذا الجدول مالك لتشغيله.");
  }
  return runAs(schedule.createdBy, { id: "system", label: "Scheduled firing" }, () => fire(id, false));
}
