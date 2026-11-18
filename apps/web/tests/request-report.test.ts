import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/requests/repository", () => ({}));
vi.mock("@/features/governance/service", () => ({ loadRecordAudit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requirePermission: vi.fn(), visibleProjectIds: vi.fn() }));

const { reachableFrom } = await import("@/features/requests/report-service");

/** D388: which sub-requests a request's report shows, given the ones the person may see. */

const node = (key: string, parentKey: string) => ({
  key,
  parentKey,
  titleEn: key,
  titleAr: key,
  typeEn: "T",
  typeAr: "T",
  status: "Submitted",
  stepEn: "",
  stepAr: "",
  submittedAt: null,
  dueAt: null,
});

describe("reachableFrom", () => {
  it("should_keep_every_depth_below_the_root_whatever_order_the_rows_come_in", () => {
    const tree = reachableFrom("REQ-1", [node("REQ-4", "REQ-3"), node("REQ-3", "REQ-2"), node("REQ-2", "REQ-1")]);
    expect(tree.map((row) => row.key)).toEqual(["REQ-2", "REQ-3", "REQ-4"]);
  });

  it("should_leave_out_a_request_whose_parent_the_person_may_not_see_and_everything_below_it", () => {
    // REQ-3 is below REQ-2, which was filtered out as not visible: neither it nor REQ-5 may show.
    const tree = reachableFrom("REQ-1", [node("REQ-3", "REQ-2"), node("REQ-5", "REQ-3"), node("REQ-4", "REQ-1")]);
    expect(tree.map((row) => row.key)).toEqual(["REQ-4"]);
  });
});
