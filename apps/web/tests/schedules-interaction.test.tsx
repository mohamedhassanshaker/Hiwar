// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/schedules/actions", () => ({
  setScheduleActive: async () => ({ ok: true, value: undefined }),
  runNow: async () => ({ ok: true, value: { outcome: "Created", createdKey: "FIN-9" } }),
  setAllSchedulesActive: async () => 0,
  deleteSchedule: async () => ({ ok: true, value: undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/routines",
  useSearchParams: () => new URLSearchParams(),
}));

import { Routines } from "@/features/schedules/components/scheduled-work-items";
import type { Schedule } from "@/features/schedules/types";
import type { Person } from "@/types/directory";
import { cleanup, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };

afterEach(cleanup);

describe("UC-31.1-01 UC-31.2-04 the schedule list's audience column", () => {
  const forGroup: Schedule = {
    id: "s1", version: 1, n: "Weekly close", nAr: "الإقفال الأسبوعي", a: "", isAgent: false,
    audienceType: "Group", groupNameEn: "Finance Approvers", groupNameAr: "معتمدو المالية", p: "FIN",
    repeats: "Weekly", eventName: null, timeOfDay: "09:00", skipHolidaysAndWeekends: false, nextRunAt: null, on: true, last: null,
  };

  it("names a group audience as the group, not as the person signed in", async () => {
    const screen = await mount(withProviders(<Routines schedules={[forGroup]} page={{ page: 1, total: 1, size: 50 }} active={1} filters={{ audience: "all", project: "any", q: "" }} />, directory));
    const text = screen.container.querySelector("tbody")?.textContent ?? "";

    expect(text).toContain("Finance Approvers");
    expect(text).toContain("Group");
    expect(text).not.toContain("Human");
    // The signed-in person's avatar initials.
    expect(text).not.toContain("QA");
  });
});
