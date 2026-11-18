import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { likeLiteral } from "@/db/search";
import { assertWritten } from "@/lib/concurrency";
import type { Schedule } from "./types";

/** The only module in `schedules` that touches Drizzle. */

const lastOutcome = sql<string | null>`(
  select sr.outcome from work.schedule_run sr
  where sr.scheduled_work_item_id = ${s.scheduledWorkItem.id}
  order by sr.fired_at desc limit 1
)`;

/**
 * Which schedules a list returns (D349): an agent audience or any other, one project by key,
 * a title containing `text`; `limit` (50 unless given, at most 200) from `offset`.
 */
export type ScheduleFilter = { audience?: "agent" | "human"; projectKey?: string; text?: string; limit?: number; offset?: number };

/** The WHERE clause of the visible projects (`null` for every project) and a filter. */
function scheduleWhere(visibleIds: string[] | null, filter: ScheduleFilter) {
  const text = filter.text?.trim();
  return and(
    visibleIds === null ? undefined : visibleIds.length > 0 ? inArray(s.scheduledWorkItem.projectId, visibleIds) : sql`false`,
    filter.audience === undefined
      ? undefined
      : filter.audience === "agent"
        ? eq(s.scheduledWorkItem.audienceType, "Agent")
        : sql`${s.scheduledWorkItem.audienceType} <> 'Agent'`,
    filter.projectKey === undefined
      ? undefined
      : sql`${s.scheduledWorkItem.projectId} = (select p.id from work.project p where p.key = ${filter.projectKey})`,
    text
      ? or(
          sql`${s.scheduledWorkItem.titleEn} ilike ${`%${likeLiteral(text)}%`}`,
          sql`${s.scheduledWorkItem.titleAr} ilike ${`%${likeLiteral(text)}%`}`,
        )
      : undefined,
  );
}

/** How many schedules of the visible projects match the filter, and how many of those are active. */
export async function countSchedules(visibleIds: string[] | null, filter: ScheduleFilter = {}): Promise<{ total: number; active: number }> {
  const [row] = await dbRo()
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${s.scheduledWorkItem.status} = 'Active')::int`,
    })
    .from(s.scheduledWorkItem)
    .where(scheduleWhere(visibleIds, filter));
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

/**
 * One page of the scheduled work items of the visible projects (`null` for every project)
 * that match the filter, each with its project, audience (an agent by code, a person by id, a
 * group by its names), timing, next run and the outcome of its latest firing; by English title.
 */
export async function listSchedules(visibleIds: string[] | null, filter: ScheduleFilter = {}): Promise<Schedule[]> {
  const rows = await dbRo()
    .select({
      id: s.scheduledWorkItem.id,
      version: s.scheduledWorkItem.version,
      n: s.scheduledWorkItem.titleEn,
      nAr: s.scheduledWorkItem.titleAr,
      audienceType: s.scheduledWorkItem.audienceType,
      audiencePerson: s.person.id,
      audienceAgent: s.agent.code,
      groupNameEn: s.group.nameEn,
      groupNameAr: s.group.nameAr,
      p: s.project.key,
      repeats: s.scheduledWorkItem.repeats,
      eventName: s.scheduledWorkItem.eventName,
      timeOfDay: s.scheduledWorkItem.timeOfDay,
      skipHolidaysAndWeekends: s.scheduledWorkItem.skipHolidaysAndWeekends,
      nextRunAt: s.scheduledWorkItem.nextRunAt,
      status: s.scheduledWorkItem.status,
      last: lastOutcome,
    })
    .from(s.scheduledWorkItem)
    .innerJoin(s.project, eq(s.project.id, s.scheduledWorkItem.projectId))
    .leftJoin(s.person, eq(s.person.id, s.scheduledWorkItem.audienceId))
    .leftJoin(s.agent, eq(s.agent.id, s.scheduledWorkItem.audienceId))
    .leftJoin(s.group, eq(s.group.id, s.scheduledWorkItem.audienceId))
    .where(scheduleWhere(visibleIds, filter))
    .orderBy(asc(s.scheduledWorkItem.titleEn), asc(s.scheduledWorkItem.id))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0);

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    n: row.n,
    nAr: row.nAr,
    a: (row.audienceType === "Agent" ? row.audienceAgent : row.audiencePerson) ?? "",
    isAgent: row.audienceType === "Agent",
    audienceType: row.audienceType,
    groupNameEn: row.audienceType === "Group" ? row.groupNameEn : null,
    groupNameAr: row.audienceType === "Group" ? row.groupNameAr : null,
    p: row.p,
    repeats: row.repeats,
    eventName: row.eventName,
    timeOfDay: row.timeOfDay,
    skipHolidaysAndWeekends: row.skipHolidaysAndWeekends,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    on: row.status === "Active",
    last: row.last,
  }));
}

/** Pauses or resumes a scheduled work item, refusing a stale write (`COM-10`). */
export async function setActive(id: string, active: boolean, version: number, personId: string): Promise<string | null> {
  const rows = await db()
    .update(s.scheduledWorkItem)
    .set({ status: active ? "Active" : "Paused", updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.scheduledWorkItem.id, id), eq(s.scheduledWorkItem.version, version)))
    .returning({ id: s.scheduledWorkItem.id, temporalScheduleId: s.scheduledWorkItem.temporalScheduleId });
  assertWritten(rows, "ScheduledWorkItem");
  return rows[0].temporalScheduleId;
}

/** The project a schedule is in, or null when no schedule has the id. */
export async function projectIdOf(id: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ projectId: s.scheduledWorkItem.projectId })
    .from(s.scheduledWorkItem)
    .where(eq(s.scheduledWorkItem.id, id))
    .limit(1);
  return row?.projectId ?? null;
}

/** The Temporal Schedule id a save created or updated, stored back on its own row. */
export async function setTemporalScheduleId(id: string, temporalScheduleId: string | null): Promise<void> {
  await db().update(s.scheduledWorkItem).set({ temporalScheduleId }).where(eq(s.scheduledWorkItem.id, id));
}

/** The Temporal Schedule id a row fires through, read before the row is removed. */
export async function temporalScheduleIdOf(id: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ temporalScheduleId: s.scheduledWorkItem.temporalScheduleId })
    .from(s.scheduledWorkItem)
    .where(eq(s.scheduledWorkItem.id, id))
    .limit(1);
  return row?.temporalScheduleId ?? null;
}

/** `UC-31.1-*`: the row and its firing history, which cascades with it. */
export async function deleteSchedule(id: string): Promise<void> {
  await db().delete(s.scheduledWorkItem).where(eq(s.scheduledWorkItem.id, id));
}

/** Everything one firing needs to decide, in one read. */
export async function readForFiring(id: string): Promise<{
  id: string;
  titleEn: string;
  titleAr: string;
  projectId: string;
  projectKey: string;
  projectStatus: string;
  status: string;
  repeats: string;
  timeOfDay: string | null;
  timeZone: string;
  skipHolidaysAndWeekends: boolean;
  createsWorkItemType: string | null;
  createsRequestTypeId: string | null;
  instructionsEn: string | null;
  audienceType: string;
  audienceId: string;
  audienceAgentCode: string | null;
  audienceAgentStatus: string | null;
  createdBy: string | null;
  createdByNameEn: string | null;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.scheduledWorkItem.id,
      titleEn: s.scheduledWorkItem.titleEn,
      titleAr: s.scheduledWorkItem.titleAr,
      projectId: s.project.id,
      projectKey: s.project.key,
      projectStatus: s.project.status,
      status: s.scheduledWorkItem.status,
      repeats: s.scheduledWorkItem.repeats,
      timeOfDay: s.scheduledWorkItem.timeOfDay,
      timeZone: s.scheduledWorkItem.timeZone,
      skipHolidaysAndWeekends: s.scheduledWorkItem.skipHolidaysAndWeekends,
      createsWorkItemType: s.scheduledWorkItem.createsWorkItemType,
      createsRequestTypeId: s.scheduledWorkItem.createsRequestTypeId,
      instructionsEn: s.scheduledWorkItem.instructionsEn,
      audienceType: s.scheduledWorkItem.audienceType,
      audienceId: s.scheduledWorkItem.audienceId,
      audienceAgentCode: s.agent.code,
      audienceAgentStatus: s.agent.status,
      createdBy: s.scheduledWorkItem.createdBy,
      createdByNameEn: s.person.nameEn,
    })
    .from(s.scheduledWorkItem)
    .innerJoin(s.project, eq(s.project.id, s.scheduledWorkItem.projectId))
    .leftJoin(s.agent, eq(s.agent.id, s.scheduledWorkItem.audienceId))
    .leftJoin(s.person, eq(s.person.id, s.scheduledWorkItem.createdBy))
    .where(eq(s.scheduledWorkItem.id, id))
    .limit(1);
  return row ?? null;
}

/** The organisation's working days and whether one day is a holiday on its calendar. */
export async function workingCalendar(day: string): Promise<{ workingDays: number[]; isHoliday: boolean }> {
  const [organisation] = await dbRo()
    .select({ workingCalendarId: s.organisation.workingCalendarId, holidayCalendarId: s.organisation.holidayCalendarId })
    .from(s.organisation)
    .limit(1);
  // Without a configured calendar the platform treats every day as a working day, which
  // fires rather than silently skipping.
  if (!organisation) return { workingDays: [1, 2, 3, 4, 5, 6, 7], isHoliday: false };

  const [working] = organisation.workingCalendarId
    ? await dbRo().select({ days: s.calendar.workingDays }).from(s.calendar).where(eq(s.calendar.id, organisation.workingCalendarId)).limit(1)
    : [undefined];
  const [holiday] = organisation.holidayCalendarId
    ? await dbRo()
        .select({ id: s.calendarHoliday.id })
        .from(s.calendarHoliday)
        .where(and(eq(s.calendarHoliday.calendarId, organisation.holidayCalendarId), eq(s.calendarHoliday.date, day)))
        .limit(1)
    : [undefined];
  return { workingDays: working?.days ?? [1, 2, 3, 4, 5, 6, 7], isHoliday: holiday !== undefined };
}

/** Records what one firing did, which is what the list's "Last run" column reads. */
export async function recordFiring(input: {
  scheduleId: string;
  outcome: string;
  workItemId?: string | null;
  requestId?: string | null;
  error?: string | null;
  personId: string;
}): Promise<void> {
  await db().insert(s.scheduleRun).values({
    scheduledWorkItemId: input.scheduleId,
    firedAt: new Date(),
    outcome: input.outcome,
    createdWorkItemId: input.workItemId ?? null,
    createdRequestId: input.requestId ?? null,
    error: input.error ?? null,
    createdBy: input.personId,
  });
}

/** Moves the schedule on to its next due time after a firing. */
export async function setNextRun(id: string, nextRunAt: Date | null, personId: string): Promise<void> {
  await db()
    .update(s.scheduledWorkItem)
    .set({ nextRunAt, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.scheduledWorkItem.id, id));
}

/** `UC-31.1-05`: pause or resume every schedule at once. Returns how many changed. */
export async function setAllActive(
  active: boolean,
  personId: string,
): Promise<{ id: string; temporalScheduleId: string | null }[]> {
  return db()
    .update(s.scheduledWorkItem)
    .set({ status: active ? "Active" : "Paused", updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.scheduledWorkItem.status, active ? "Paused" : "Active"))
    .returning({ id: s.scheduledWorkItem.id, temporalScheduleId: s.scheduledWorkItem.temporalScheduleId });
}

/** The row id of a work item, so a firing can record what it created. */
export async function workItemIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.workItem.id }).from(s.workItem).where(eq(s.workItem.key, key)).limit(1);
  return row?.id ?? null;
}

/** The principal behind a schedule's audience: an agent code, a person id or a group id. */
export async function resolveAudience(audienceType: string, audience: string): Promise<string | null> {
  if (audienceType === "Agent") {
    const [agent] = await dbRo().select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, audience)).limit(1);
    return agent?.id ?? null;
  }
  if (audienceType === "Group") {
    const [group] = await dbRo().select({ id: s.group.id }).from(s.group).where(eq(s.group.id, audience)).limit(1);
    return group?.id ?? null;
  }
  const [person] = await dbRo().select({ id: s.person.id }).from(s.person).where(eq(s.person.id, audience)).limit(1);
  return person?.id ?? null;
}

/** The ids behind the project key and request type code a schedule names. */
export async function resolveTargets(projectKey: string, requestTypeCode: string | undefined): Promise<{
  projectId: string | null;
  projectStatus: string | null;
  requestTypeId: string | null;
}> {
  const [project] = await dbRo()
    .select({ id: s.project.id, status: s.project.status })
    .from(s.project)
    .where(eq(s.project.key, projectKey))
    .limit(1);
  const [requestType] = requestTypeCode
    ? await dbRo().select({ id: s.requestType.id }).from(s.requestType).where(eq(s.requestType.code, requestTypeCode)).limit(1)
    : [undefined];
  return {
    projectId: project?.id ?? null,
    projectStatus: project?.status ?? null,
    requestTypeId: requestType?.id ?? null,
  };
}

export type ScheduleWrite = {
  id?: string;
  titleEn: string;
  titleAr: string;
  projectId: string;
  createsWorkItemType: string | null;
  createsRequestTypeId: string | null;
  audienceType: string;
  audienceId: string;
  repeats: string;
  eventName: string | null;
  startDate: string;
  timeOfDay: string;
  timeZone: string;
  skipHolidaysAndWeekends: boolean;
  instructionsEn: string | null;
  instructionsAr: string | null;
  nextRunAt: Date | null;
  personId: string;
};

/** Creates or updates a scheduled work item, returning its id; the person saving it owns it. */
export async function saveSchedule(input: ScheduleWrite): Promise<string> {
  const values = {
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    projectId: input.projectId,
    createsWorkItemType: input.createsWorkItemType,
    createsRequestTypeId: input.createsRequestTypeId,
    audienceType: input.audienceType,
    audienceId: input.audienceId,
    repeats: input.repeats,
    eventName: input.eventName,
    startDate: input.startDate,
    timeOfDay: input.timeOfDay,
    timeZone: input.timeZone,
    skipHolidaysAndWeekends: input.skipHolidaysAndWeekends,
    instructionsEn: input.instructionsEn,
    instructionsAr: input.instructionsAr,
    nextRunAt: input.nextRunAt,
    createdBy: input.personId,
    updatedAt: new Date(),
    updatedBy: input.personId,
  };
  if (input.id) {
    await db().update(s.scheduledWorkItem).set(values).where(eq(s.scheduledWorkItem.id, input.id));
    return input.id;
  }
  const [created] = await db()
    .insert(s.scheduledWorkItem)
    .values(values)
    .returning({ id: s.scheduledWorkItem.id });
  return created.id;
}

/** `UC-31.1-04`: one schedule in the shape its modal fills in and sends back. */
export type ScheduleForm = {
  id: string;
  titleEn: string;
  titleAr: string;
  projectKey: string;
  createsWorkItemType: string | null;
  createsRequestTypeCode: string | null;
  audienceType: string;
  /** An agent code, a person id or a group id, as the modal's choices are keyed. */
  audience: string;
  repeats: string;
  eventName: string | null;
  startDate: string;
  timeOfDay: string;
  timeZone: string;
  skipHolidaysAndWeekends: boolean;
  instructionsEn: string | null;
  instructionsAr: string | null;
};

/**
 * `UC-31.1-04`: one schedule as the modal prefills it: the request type by code, an agent
 * audience by code and any other by id, with the start date empty and the time 09:00 when
 * unset. Null when it does not exist.
 */
export async function readForEditing(id: string): Promise<ScheduleForm | null> {
  const [row] = await dbRo()
    .select({
      id: s.scheduledWorkItem.id,
      titleEn: s.scheduledWorkItem.titleEn,
      titleAr: s.scheduledWorkItem.titleAr,
      projectKey: s.project.key,
      createsWorkItemType: s.scheduledWorkItem.createsWorkItemType,
      createsRequestTypeCode: sql<string | null>`(
        select rt.code from work.request_type rt
        join work.request_type_version rtv on rtv.request_type_id = rt.id
        where rtv.id = ${s.scheduledWorkItem.createsRequestTypeId}
      )`,
      audienceType: s.scheduledWorkItem.audienceType,
      audienceId: s.scheduledWorkItem.audienceId,
      // An agent is chosen by code in the modal; a person and a group by their own id.
      agentCode: sql<string | null>`(select a.code from ai.agent a where a.id = ${outer(s.scheduledWorkItem.audienceId)})`,
      repeats: s.scheduledWorkItem.repeats,
      eventName: s.scheduledWorkItem.eventName,
      startDate: s.scheduledWorkItem.startDate,
      timeOfDay: s.scheduledWorkItem.timeOfDay,
      timeZone: s.scheduledWorkItem.timeZone,
      skipHolidaysAndWeekends: s.scheduledWorkItem.skipHolidaysAndWeekends,
      instructionsEn: s.scheduledWorkItem.instructionsEn,
      instructionsAr: s.scheduledWorkItem.instructionsAr,
    })
    .from(s.scheduledWorkItem)
    .innerJoin(s.project, eq(s.project.id, s.scheduledWorkItem.projectId))
    .where(eq(s.scheduledWorkItem.id, id))
    .limit(1);
  if (!row) return null;

  const { audienceId, agentCode, ...rest } = row;
  return {
    ...rest,
    audience: row.audienceType === "Agent" ? (agentCode ?? audienceId) : audienceId,
    startDate: row.startDate ?? "",
    timeOfDay: row.timeOfDay ?? "09:00",
  };
}

/** The groups a schedule may be addressed to (`UC-31.2-04`). */
export async function listGroups(): Promise<{ id: string; nameEn: string; nameAr: string }[]> {
  return dbRo()
    .select({ id: s.group.id, nameEn: s.group.nameEn, nameAr: s.group.nameAr })
    .from(s.group)
    .orderBy(asc(s.group.nameEn));
}
