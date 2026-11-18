import { describe, expect, it } from "vitest";

import { dayAfter, dayStart } from "@/lib/paging";

/**
 * D342: a list's date filters come from the address, and an unreadable one falls back to no filter. A value shaped
 * like a date but naming no real day used to become an invalid date that crashed the screen (TC-AGT-245).
 */
describe("dayStart", () => {
  it("should_read_a_real_day_as_its_start_in_dubai_time", () => {
    expect(dayStart("2026-10-31")?.toISOString()).toBe("2026-10-30T20:00:00.000Z");
  });

  it("should_ignore_a_month_or_day_that_does_not_exist", () => {
    expect(dayStart("2026-13-45")).toBeUndefined();
    expect(dayStart("2026-02-31")).toBeUndefined();
  });

  it("should_ignore_text_that_is_not_a_date", () => {
    expect(dayStart("garbage")).toBeUndefined();
    expect(dayStart("")).toBeUndefined();
    expect(dayStart(undefined)).toBeUndefined();
  });

  it("should_accept_the_29th_of_february_in_a_leap_year_only", () => {
    expect(dayStart("2028-02-29")).toBeDefined();
    expect(dayStart("2026-02-29")).toBeUndefined();
  });
});

describe("dayAfter", () => {
  it("should_give_the_start_of_the_next_day_so_the_to_day_is_included", () => {
    expect(dayAfter("2026-10-31")?.toISOString()).toBe("2026-10-31T20:00:00.000Z");
  });

  it("should_ignore_a_day_that_does_not_exist", () => {
    expect(dayAfter("2026-13-45")).toBeUndefined();
  });
});
