import { audit } from "@/lib/audit";
import { requireOrganisationPermission, requirePermission, requireProjectPermission, visibleProjectIds } from "@/lib/session";
import { deleteWorkItemSchedule, setWorkItemScheduleActive, syncWorkItemSchedule } from "@/lib/temporal";
import * as repository from "./repository";
import type { SaveScheduleInput, SetScheduleActiveInput } from "./schema";
import { ScheduleRejected } from "./errors";

export { ScheduleRejected } from "./errors";
export { type FiringOutcome, fire, runNow, fireScheduled } from "./firing-service";

/** S-31: the scheduled work items. */

/** One page (50 unless given) of the visible scheduled work items matching the filter, by title. Requires `schedules:read`. */
export async function loadSchedules(filter: repository.ScheduleFilter = {}) {
  await requirePermission("schedules:read");
  return repository.listSchedules(await visibleProjectIds("schedules:read"), filter);
}

/**
 * One page of the schedules matching the filter, how many match, and how many of every visible
 * schedule are active, for S-31 (D349). Requires `schedules:read`.
 */
export async function loadSchedulePage(filter: repository.ScheduleFilter) {
  await requirePermission("schedules:read");
  const visible = await visibleProjectIds("schedules:read");
  const [rows, matching, all] = await Promise.all([
    repository.listSchedules(visible, filter),
    repository.countSchedules(visible, filter),
    repository.countSchedules(visible),
  ]);
  return { rows, total: matching.total, active: all.active };
}

/**
 * Pause or resume one schedule at its row version, then its Temporal Schedule, and audit it.
 * Requires `schedules:write` in the schedule's project; a stale version is refused (`COM-10`).
 */
export async function setScheduleActive(input: SetScheduleActiveInput): Promise<void> {
  await requirePermission("schedules:write");
  const session = await requireProjectPermission("schedules:write", await projectOf(input.id));
  const temporalScheduleId = await repository.setActive(input.id, input.active, input.version, session.personId);
  await setWorkItemScheduleActive(temporalScheduleId, input.active);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "schedules:write",
    objectType: "ScheduledWorkItem",
    objectId: input.id,
    detail: { active: input.active },
  });
}

/**
 * Removes a scheduled work item and the Temporal Schedule firing it.
 *
 * The Schedule has to go first: it fires by this row's id, and a row that disappears while
 * its Schedule keeps running would fire against nothing. Firing history cascades with the
 * row, since it is the schedule's own record of itself rather than anything else's reference.
 */
export async function deleteSchedule(id: string): Promise<void> {
  await requirePermission("schedules:write");
  const session = await requireProjectPermission("schedules:write", await projectOf(id));

  const temporalScheduleId = await repository.temporalScheduleIdOf(id);
  if (temporalScheduleId) await deleteWorkItemSchedule(temporalScheduleId);
  await repository.deleteSchedule(id);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "schedules:delete",
    objectType: "ScheduledWorkItem",
    objectId: id,
  });
}

/** `UC-31.1-05`: pause or resume every schedule at once, which needs an organisation-wide grant. */
export async function setAllActive(active: boolean): Promise<number> {
  const session = await requireOrganisationPermission("schedules:write");
  const changed = await repository.setAllActive(active, session.personId);
  await Promise.all(changed.map((row) => setWorkItemScheduleActive(row.temporalScheduleId, active)));
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "schedules:write",
    objectType: "ScheduledWorkItem",
    objectLabel: "all",
    detail: { active, changed: changed.length },
  });
  return changed.length;
}

/**
 * `UC-31.2-01` … `-09`: create or edit a scheduled work item.
 *
 * The refusals that depend on the clock or on another row live here rather than in the
 * schema: a start date in the past is only in the past relative to now, and whether an
 * agent or a project exists is a question for the database.
 *
 * Requires `schedules:write` in the target project and, for an edit, in the project the
 * schedule is in now. The person who saves it becomes its owner, whom a timer firing acts as.
 */
export async function saveSchedule(input: SaveScheduleInput): Promise<string> {
  const session = await requirePermission("schedules:write");
  if (input.id) await requireProjectPermission("schedules:write", await projectOf(input.id));

  // `UC-31.2-07`: a schedule that runs once and is already past would never fire, so it is
  // refused rather than created in a state that does nothing.
  if (input.repeats === "Once" && input.startDate < new Date().toISOString().slice(0, 10)) {
    throw new ScheduleRejected("A schedule that runs once cannot start in the past.", "لا يمكن أن يبدأ تشغيل لمرة واحدة في الماضي.");
  }

  // `UC-31.2-06`: an agent is given nothing but its instructions, so a schedule without
  // them would fire and hand the agent no task at all.
  if (input.audienceType === "Agent" && !input.instructionsEn?.trim()) {
    throw new ScheduleRejected("Agents need instructions.", "الوكلاء يحتاجون إلى تعليمات.");
  }

  const targets = await repository.resolveTargets(input.projectKey, input.createsRequestTypeCode);
  if (!targets.projectId) throw new ScheduleRejected("No such project.", "لا يوجد مشروع بهذا المعرّف.");
  if (input.createsRequestTypeCode && !targets.requestTypeId) throw new ScheduleRejected("No such request type.", "لا يوجد نوع طلب بهذا المعرّف.");
  await requireProjectPermission("schedules:write", targets.projectId);

  const audienceId = await repository.resolveAudience(input.audienceType, input.audience);
  if (!audienceId) throw new ScheduleRejected("No such person, agent or group.", "لا يوجد شخص أو وكيل أو مجموعة بهذا المعرّف.");

  const start = new Date(`${input.startDate}T${input.timeOfDay}:00Z`);
  const id = await repository.saveSchedule({
    id: input.id,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    projectId: targets.projectId,
    createsWorkItemType: input.createsWorkItemType ?? null,
    createsRequestTypeId: targets.requestTypeId,
    audienceType: input.audienceType,
    audienceId,
    repeats: input.repeats,
    eventName: input.eventName ?? null,
    startDate: input.startDate,
    timeOfDay: input.timeOfDay,
    timeZone: input.timeZone,
    skipHolidaysAndWeekends: input.skipHolidaysAndWeekends,
    instructionsEn: input.instructionsEn ?? null,
    instructionsAr: input.instructionsAr ?? null,
    // An event schedule has no next time; everything else is next due at its start.
    nextRunAt: input.repeats === "OnEvent" ? null : start,
    personId: session.personId,
  });

  // `UC-31.2-*`: the Temporal Schedule is what actually fires this row from here on; a
  // deployment with no Temporal configured (`make dev-local`) leaves it reachable through
  // Run now only, which `syncWorkItemSchedule` already knows to skip.
  const temporalScheduleId = await syncWorkItemSchedule({
    id,
    repeats: input.repeats,
    startDate: input.startDate,
    timeOfDay: input.timeOfDay,
    timeZone: input.timeZone,
  });
  await repository.setTemporalScheduleId(id, temporalScheduleId);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "schedules:write",
    objectType: "ScheduledWorkItem",
    objectId: id,
    detail: { created: !input.id, repeats: input.repeats, audience: input.audienceType },
  });
  return id;
}

/** The project a schedule belongs to, for the permission check before a change to it. */
async function projectOf(id: string): Promise<string> {
  const projectId = await repository.projectIdOf(id);
  if (!projectId) throw new ScheduleRejected("That scheduled work item no longer exists.", "لم يعد بند العمل المجدول هذا موجوداً.");
  return projectId;
}

/**
 * The organisation's working days and whether one day is a holiday.
 *
 * Reference data about the organisation rather than anybody's records, so it carries no
 * permission check: the channel gateway reads it with no session at all, to decide whether
 * an inbound message arrived inside working hours.
 */
export async function workingCalendarFor(day: string): Promise<{ workingDays: number[]; isHoliday: boolean }> {
  return repository.workingCalendar(day);
}
