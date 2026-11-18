import { describe, expect, it } from "vitest";

import { nextRunAfter, skipReasonFor } from "@/features/schedules/firing";

/**
 * S-31: when a schedule produces work and when it records that it did not.
 *
 * A firing that is skipped has to say why on the day it was due, because a schedule that
 * silently produced nothing is indistinguishable from one that never ran.
 */

const working = { workingDays: [1, 2, 3, 4, 5], isHoliday: false, skipHolidaysAndWeekends: true };

describe("when a schedule fires", () => {
  it("UC-31.2-09 skips a firing whose project is paused, and says so", () => {
    const skip = skipReasonFor({
      ...working,
      scheduleStatus: "Active",
      projectStatus: "Paused",
      day: "2026-10-13",
      weekday: 2,
    });
    expect(skip?.reason).toBe("ProjectPaused");
    expect(skip?.detail).toMatch(/paused/i);

    const archived = skipReasonFor({
      ...working,
      scheduleStatus: "Active",
      projectStatus: "Archived",
      day: "2026-10-13",
      weekday: 2,
    });
    expect(archived?.reason).toBe("ProjectArchived");
  });

  it("UC-31.2-05 skips a holiday and a non-working day when the schedule asks it to", () => {
    const holiday = skipReasonFor({
      ...working,
      isHoliday: true,
      scheduleStatus: "Active",
      projectStatus: "Active",
      day: "2026-12-02",
      weekday: 3,
    });
    expect(holiday?.reason).toBe("NonWorkingDay");

    const weekend = skipReasonFor({
      ...working,
      scheduleStatus: "Active",
      projectStatus: "Active",
      day: "2026-10-17",
      weekday: 6,
    });
    expect(weekend?.reason).toBe("NonWorkingDay");

    // The same Saturday fires when the schedule does not skip them.
    expect(
      skipReasonFor({
        ...working,
        skipHolidaysAndWeekends: false,
        scheduleStatus: "Active",
        projectStatus: "Active",
        day: "2026-10-17",
        weekday: 6,
      }),
    ).toBeNull();
  });

  it("UC-31.1-06 a paused schedule produces nothing while its project is fine", () => {
    expect(
      skipReasonFor({ ...working, scheduleStatus: "Paused", projectStatus: "Active", day: "2026-10-13", weekday: 2 })
        ?.reason,
    ).toBe("SchedulePaused");
  });

  it("UC-31.2-01 a repeating schedule has a next run, and Once and On event do not", () => {
    const from = new Date("2026-10-13T09:00:00Z");
    expect(nextRunAfter("Daily", from, "09:00")?.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(nextRunAfter("Weekly", from, "09:00")?.toISOString()).toBe("2026-10-20T09:00:00.000Z");
    expect(nextRunAfter("Monthly", from, "09:00")?.toISOString()).toBe("2026-11-13T09:00:00.000Z");

    // `UC-31.2-03`: an event schedule has no next time, because an event is not a clock.
    expect(nextRunAfter("Once", from, "09:00")).toBeNull();
    expect(nextRunAfter("OnEvent", from, "09:00")).toBeNull();
  });
});
