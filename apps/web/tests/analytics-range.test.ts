import { describe, expect, it } from "vitest";

import { rangeStart } from "@/server/analytics";

describe("ANA-001 date range", () => {
  it("FR-001: 7, 30 and 90 days start at midnight UTC so the range holds that many calendar days, today included", () => {
    const now = new Date("2026-11-20T15:30:00Z");
    expect(rangeStart(7, now).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(rangeStart(30, now).toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(rangeStart(90, now).toISOString()).toBe("2026-08-23T00:00:00.000Z");
  });
});
