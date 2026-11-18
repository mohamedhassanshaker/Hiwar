import { describe, expect, it } from "vitest";

import { runPeriodOf } from "@/features/agents/run-periods";
import { DEFAULT_RUN_SORT, nextRunSort, runSortOf } from "@/features/agents/run-sort";

/** D383: the Runs screen reads its order and period from the address. */

describe("D383 the order a run list is in", () => {
  it("is newest first when the address names none, or a column it does not know", () => {
    expect(runSortOf(undefined, undefined)).toEqual({ column: "started", dir: "desc" });
    expect(runSortOf("tokens; drop table", "asc")).toEqual(DEFAULT_RUN_SORT);
  });

  it("takes a known column and direction, descending when the direction is unreadable", () => {
    expect(runSortOf("duration", "asc")).toEqual({ column: "duration", dir: "asc" });
    expect(runSortOf("cost", "sideways")).toEqual({ column: "cost", dir: "desc" });
  });

  it("turns the order round on the same column and starts a new column descending", () => {
    expect(nextRunSort(DEFAULT_RUN_SORT, "started")).toEqual({ column: "started", dir: "asc" });
    expect(nextRunSort({ column: "started", dir: "asc" }, "started")).toEqual({ column: "started", dir: "desc" });
    expect(nextRunSort({ column: "started", dir: "asc" }, "agent")).toEqual({ column: "agent", dir: "desc" });
  });
});

describe("D300 the period a run list reaches back", () => {
  it("takes the periods offered and reads anything else as any time", () => {
    expect(runPeriodOf("168")).toBe(168);
    expect(runPeriodOf("5")).toBe(0);
    expect(runPeriodOf(undefined)).toBe(0);
  });
});
