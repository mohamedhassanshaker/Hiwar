// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// What the server answers once a person acts. Each returns success, so a test sees the call
// the screen made and the list it is then given.
const calls = vi.hoisted(() => ({ setScheduleActive: [] as unknown[] }));
vi.mock("@/features/files/actions", () =>
  Object.fromEntries(
    ["attachFile", "deleteItem", "setFileStatus", "setScopeOfUse", "uploadFile"].map((name) => [name, async () => ({ ok: true, value: undefined })]),
  ),
);
vi.mock("@/features/schedules/actions", () => ({
  setScheduleActive: async (input: unknown) => {
    calls.setScheduleActive.push(input);
    return { ok: true, value: undefined };
  },
  runNow: async () => ({ ok: true, value: { outcome: "Created", createdKey: "FIN-9" } }),
  saveSchedule: async () => ({ ok: true, value: "s9" }),
  setAllSchedulesActive: async () => 0,
  deleteSchedule: async () => ({ ok: true, value: undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/files",
  useSearchParams: () => new URLSearchParams(),
}));

import { Artifacts, Files } from "@/features/files/components/project-items";
import type { ProjectItem } from "@/features/files/types";
import { Routines } from "@/features/schedules/components/scheduled-work-items";
import type { Schedule } from "@/features/schedules/types";
import type { Person, Project } from "@/types/directory";
import { cleanup, click, mount, withProviders } from "./dom";

/**
 * D186: a list the server re-supplies after an action renders from its props. The
 * static-markup tests draw one render; these re-render with the list the server sends next.
 */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const project: Project = { k: "FIN", n: "Finance operations", nAr: "العمليات المالية", st: "Active", own: "p1", unit: "Finance", sens: "Internal", items: 2, prog: 50 };
const directory = { me, agents: [], people: [me], projects: [project], may: [] };

afterEach(cleanup);

describe("D186 lists follow the rows the server sends", () => {
  const policy: ProjectItem = { n: "policy.pdf", s: "120 KB", p: "FIN", w: "p1", scope: "AllProject", st: "Active", v: 1 };
  const added: ProjectItem = { n: "ledger.csv", s: "2 KB", p: "FIN", w: "p1", scope: "OnlyMe", st: "Active", v: 1 };
  const onePage = { page: { page: 1, total: 2, size: 50 }, filters: { project: "", q: "" } };

  it("shows a file uploaded after the first render", async () => {
    const screen = await mount(withProviders(<Files items={[policy]} mayWrite {...onePage} />, directory));
    expect(screen.container.textContent).not.toContain("ledger.csv");

    await screen.rerender(withProviders(<Files items={[policy, added]} mayWrite {...onePage} />, directory));
    expect(screen.container.textContent).toContain("ledger.csv");
  });

  it("shows an artifact produced after the first render", async () => {
    const screen = await mount(withProviders(<Artifacts items={[policy]} mayWrite {...onePage} />, directory));
    await screen.rerender(withProviders(<Artifacts items={[policy, added]} mayWrite {...onePage} />, directory));
    expect(screen.container.textContent).toContain("ledger.csv");
  });

  const nightly: Schedule = {
    id: "s1", version: 1, n: "Nightly reconciliation", nAr: "التسوية الليلية", a: "p1", isAgent: false,
    audienceType: "Person", groupNameEn: null, groupNameAr: null, p: "FIN",
    repeats: "Daily", eventName: null, timeOfDay: "02:00", skipHolidaysAndWeekends: false, nextRunAt: null, on: true, last: null,
  };
  const weekly: Schedule = { ...nightly, id: "s2", n: "Weekly close", nAr: "الإقفال الأسبوعي", repeats: "Weekly" };

  it("shows a scheduled work item created after the first render", async () => {
    const screen = await mount(withProviders(<Routines schedules={[nightly]} page={{ page: 1, total: 1, size: 50 }} active={1} filters={{ audience: "all", project: "any", q: "" }} />, directory));
    expect(screen.container.textContent).not.toContain("Weekly close");

    await screen.rerender(withProviders(<Routines schedules={[nightly, weekly]} page={{ page: 1, total: 1, size: 50 }} active={1} filters={{ audience: "all", project: "any", q: "" }} />, directory));
    expect(screen.container.textContent).toContain("Weekly close");
  });

  it("pauses a schedule against the version the server last sent", async () => {
    calls.setScheduleActive.length = 0;
    const screen = await mount(withProviders(<Routines schedules={[nightly]} page={{ page: 1, total: 1, size: 50 }} active={1} filters={{ audience: "all", project: "any", q: "" }} />, directory));
    // Paused and resumed elsewhere: the server's row is the same schedule at version 3.
    await screen.rerender(withProviders(<Routines schedules={[{ ...nightly, version: 3 }]} page={{ page: 1, total: 1, size: 50 }} active={1} filters={{ audience: "all", project: "any", q: "" }} />, directory));

    const toggle = screen.container.querySelector<HTMLElement>('[role="switch"]');
    await click(toggle);
    expect(calls.setScheduleActive).toEqual([{ id: "s1", active: false, version: 3 }]);
  });
});
