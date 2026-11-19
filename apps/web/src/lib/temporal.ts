import { Client, Connection, DAYS_OF_WEEK, MONTHS, ScheduleAlreadyRunning } from "@temporalio/client";
import type { CalendarSpec, ScheduleOptionsAction, ScheduleSpec } from "@temporalio/client";

import { env } from "./env";

/**
 * The Temporal client (stack specification 4.2).
 *
 * The console starts, signals, queries and cancels workflows; it never executes one. A
 * run is a workflow in the `awp` namespace, an approval or an answer is a signal that
 * resumes it, and a scheduled work item is a Temporal Schedule.
 *
 * One connection per process, opened the first time something needs it, so a deployment
 * without Temporal configured still serves every screen that does not use it.
 */

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

/** Whether Temporal is configured at all. */
export function temporalConfigured(): boolean {
  return Boolean(env().TEMPORAL_ADDRESS);
}

/**
 * The process's Temporal client, connected on first use; concurrent callers share one connection
 * attempt. Throws when `TEMPORAL_ADDRESS` is not set. A failed connection is not retried: later
 * calls get the same rejection.
 */
export async function temporal(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    const configured = env();
    if (!configured.TEMPORAL_ADDRESS) {
      throw new Error("TEMPORAL_ADDRESS is not set; no workflow can be reached");
    }
    connecting = Connection.connect({ address: configured.TEMPORAL_ADDRESS }).then((connection) => {
      client = new Client({ connection, namespace: configured.TEMPORAL_NAMESPACE });
      return client;
    });
  }
  return connecting;
}

/** The signal names the harness waits on (specification 5.3, stage three). */
export const signals = {
  /** An Inbox decision on a T2 tool call. */
  approval: "approval",
  /** A person's answer to an agent question. */
  answer: "answer",
  /** A message posted into a room while a run is already going. */
  roomMessage: "room_message",
};

/** Resume a waiting run with a decision or an answer. */
export async function signalRun(workflowId: string, signal: string, payload: unknown): Promise<void> {
  const handle = (await temporal()).workflow.getHandle(workflowId);
  await handle.signal(signal, payload);
}

/** Stop a run after its current step (UC-52.1-05). */
export async function cancelRun(workflowId: string): Promise<void> {
  const handle = (await temporal()).workflow.getHandle(workflowId);
  await handle.cancel();
}

/**
 * A scheduled work item's own timing (`UC-31.2-*`), as little as a Temporal Schedule needs
 * to fire it. `null` fields are never produced for anything but `OnEvent`, which has no
 * Schedule at all — it is triggered from wherever the named event actually happens.
 */
export type ScheduleCadence = {
  id: string;
  repeats: "Once" | "Daily" | "Weekly" | "Monthly" | "OnEvent";
  startDate: string;
  timeOfDay: string | null;
  timeZone: string;
};

/** The deterministic id the Schedule is stored and looked up under. */
export function temporalScheduleIdFor(scheduledWorkItemId: string): string {
  return `schedule-${scheduledWorkItemId}`;
}

/** The maintenance workflow every scheduled work item's Schedule starts (`MAINTENANCE` queue). */
const SCHEDULE_FIRE_WORKFLOW = "ScheduleFireWorkflow";
const MAINTENANCE_QUEUE = "maintenance";

/**
 * The calendar spec for a cadence, at its time of day (09:00 when none). Once fires on the start
 * date, Weekly on its weekday, Monthly on its day of the month, and Daily every day.
 */
function calendarSpecFor(cadence: ScheduleCadence): CalendarSpec {
  const [hour, minute] = (cadence.timeOfDay ?? "09:00").split(":").map(Number);
  const start = new Date(`${cadence.startDate}T00:00:00Z`);
  const common = { hour: hour || 0, minute: minute || 0, second: 0 };
  switch (cadence.repeats) {
    case "Once":
      // All fields of a calendar spec must match for a time to fire, so naming the exact
      // year, month and day alongside the time gives exactly one occurrence.
      return { ...common, year: start.getUTCFullYear(), month: MONTHS[start.getUTCMonth()], dayOfMonth: start.getUTCDate() };
    case "Weekly": {
      // The start date's weekday, as an index into DAYS_OF_WEEK, which begins on Sunday.
      const isoWeekday = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
      return { ...common, dayOfWeek: DAYS_OF_WEEK[isoWeekday % 7] };
    }
    case "Monthly":
      return { ...common, dayOfMonth: start.getUTCDate() };
    default:
      return common;
  }
}

/**
 * Create or update the Temporal Schedule a scheduled work item fires through.
 *
 * `UC-31.2-*`: every repeating cadence and the one-off "Once" case are a native Temporal
 * calendar spec, in the schedule's own time zone — the platform does not run its own timer.
 * `OnEvent` carries none: `null` is returned and whatever Schedule this row had before (a
 * cadence that changed away from a timed one) is removed. A deployment with no Temporal
 * configured — `make dev-local` — leaves the row to fire only through "Run now".
 */
export async function syncWorkItemSchedule(cadence: ScheduleCadence): Promise<string | null> {
  if (!temporalConfigured()) return null;
  const scheduleId = temporalScheduleIdFor(cadence.id);
  if (cadence.repeats === "OnEvent") {
    await deleteWorkItemSchedule(scheduleId);
    return null;
  }

  const spec: ScheduleSpec = { calendars: [calendarSpecFor(cadence)], timezone: cadence.timeZone };
  const action: ScheduleOptionsAction = {
    type: "startWorkflow",
    workflowType: SCHEDULE_FIRE_WORKFLOW,
    taskQueue: MAINTENANCE_QUEUE,
    args: [cadence.id],
  };
  const client = await temporal();
  try {
    await client.schedule.create({ scheduleId, spec, action });
  } catch (problem) {
    if (!(problem instanceof ScheduleAlreadyRunning)) throw problem;
    // The update carries the Schedule's own pause state forward explicitly — omitting it
    // is not "leave it alone", and a cadence edit must never itself resume a paused row.
    await client.schedule.getHandle(scheduleId).update((previous) => ({ spec, action, state: previous.state }));
  }
  return scheduleId;
}

/** `UC-31.1-04`, `UC-31.1-05`: pause or resume the Schedule behind one or every row. */
export async function setWorkItemScheduleActive(scheduleId: string | null, active: boolean): Promise<void> {
  if (!scheduleId || !temporalConfigured()) return;
  const handle = (await temporal()).schedule.getHandle(scheduleId);
  try {
    if (active) await handle.unpause("resumed from the console");
    else await handle.pause("paused from the console");
  } catch {
    // The row named a Schedule that no longer exists — nothing left to pause or resume.
  }
}

/** Removes the Temporal Schedule behind a scheduled work item, idempotently. */
export async function deleteWorkItemSchedule(scheduleId: string): Promise<void> {
  try {
    await (await temporal()).schedule.getHandle(scheduleId).delete();
  } catch {
    // Already gone, or never existed.
  }
}
