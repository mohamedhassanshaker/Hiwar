/**
 * When a schedule fires, and what it is allowed to produce (`UC-31.2-05`, `-08`, `-09`).
 *
 * The decisions are here, apart from the database, because the same rules apply whether a
 * firing came from the timer or from Run now, and because "would this be skipped?" is a
 * question the screen asks before anything is written.
 */

/** Why a firing produced nothing. `null` means it may go ahead. */
export type SkipReason =
  | { reason: "ProjectPaused"; detail: string }
  | { reason: "ProjectArchived"; detail: string }
  | { reason: "SchedulePaused"; detail: string }
  | { reason: "NonWorkingDay"; detail: string };

export type FiringConditions = {
  scheduleStatus: string;
  projectStatus: string;
  skipHolidaysAndWeekends: boolean;
  /** The day the firing is for, as `YYYY-MM-DD` in the schedule's own time zone. */
  day: string;
  /** ISO weekday of that day, Monday 1 … Sunday 7. */
  weekday: number;
  /** The working days of the organisation's calendar, as ISO weekdays. */
  workingDays: number[];
  /** Whether the organisation's holiday calendar names that day. */
  isHoliday: boolean;
};

/**
 * `UC-21.2-06` and `UC-31.2-09`: a paused or archived project stops its schedules, and
 * `UC-31.2-05`: a firing that lands on a holiday or a non-working day is skipped rather
 * than moved, so the record says what happened on the day it was due.
 */
export function skipReasonFor(conditions: FiringConditions): SkipReason | null {
  if (conditions.scheduleStatus !== "Active") {
    return { reason: "SchedulePaused", detail: "The schedule is paused." };
  }
  if (conditions.projectStatus === "Paused") {
    return { reason: "ProjectPaused", detail: "The project is paused." };
  }
  if (conditions.projectStatus === "Archived") {
    return { reason: "ProjectArchived", detail: "The project is archived." };
  }
  if (conditions.skipHolidaysAndWeekends) {
    if (conditions.isHoliday) {
      return { reason: "NonWorkingDay", detail: `${conditions.day} is a public holiday.` };
    }
    if (!conditions.workingDays.includes(conditions.weekday)) {
      return { reason: "NonWorkingDay", detail: `${conditions.day} is not a working day.` };
    }
  }
  return null;
}

/** The next time a repeating schedule is due after a given moment, or null for Once and OnEvent. */
export function nextRunAfter(
  repeats: string,
  from: Date,
  timeOfDay: string | null,
): Date | null {
  if (repeats === "Once" || repeats === "OnEvent") return null;
  const [hours, minutes] = (timeOfDay ?? "09:00").split(":").map(Number);
  const next = new Date(from);
  next.setUTCHours(0, 0, 0, 0);
  if (repeats === "Daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (repeats === "Weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCHours(hours || 0, minutes || 0, 0, 0);
  return next;
}
