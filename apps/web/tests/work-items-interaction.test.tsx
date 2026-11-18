// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// The server actions the drawer calls once a person acts. Each succeeds; `changeStatus`
// also records what it was sent, which is the version the drawer names back.
const calls = vi.hoisted(() => ({ changeStatus: [] as unknown[] }));
vi.mock("@/features/work-items/actions", () => ({
  ...Object.fromEntries(
    [
      "addSubItem", "approve", "assign", "assignToAgent", "attach", "comment", "createWorkItem", "deleteWorkItem", "reopen",
      "requestChanges", "saveView", "searchWorkItems", "setSubItemDone", "similarOpenItems", "submitForReview", "unblock",
    ].map((name) => [name, async () => ({ ok: true })]),
  ),
  changeStatus: async (input: unknown) => {
    calls.changeStatus.push(input);
    return { ok: true };
  },
}));
vi.mock("@/features/rooms/actions", () => ({ createRoom: async () => ({ ok: true }), createRoomFromWorkItem: async () => ({ ok: true }) }));
vi.mock("@/features/rooms/directory", () => ({ allowedAgentsFor: async () => null }));

// `?open=` opens a drawer on first render, as a link from elsewhere does.
const query = vi.hoisted(() => ({ value: "", pushed: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => query.pushed.push(href), replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/work-items",
  useSearchParams: () => new URLSearchParams(query.value),
}));

import type { WorkItemStatus } from "@/db/schema/enums";
import { Tasks } from "@/features/work-items/components/work-items";
import { ALLOWED_TRANSITIONS } from "@/features/work-items/transitions";
import type { Task, WorkItemDetail } from "@/features/work-items/types";
import type { Person, Project } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const project: Project = { k: "PRJ", n: "Project", nAr: "مشروع", st: "Active", own: "p1", unit: "", sens: "Internal", items: 1, prog: 0 };
const directory = { me, agents: [], people: [me], projects: [project], may: ["work_items:write" as const] };

const brief: Task = {
  k: "PRJ-1", p: "PRJ", t: "Write the brief", tAr: "كتابة الموجز", type: "Task", st: "ToDo", who: "p1", pri: "High",
  dueAt: null, sub: 1, done: 0, version: 3, hot: true, fromComment: false,
};
const detail = (subs: WorkItemDetail["subs"]): Record<string, WorkItemDetail> => ({
  "PRJ-1": { rt: ["Change request", "طلب تغيير"], org: null, rev: "", sch: "—", desc: null, at: [], subs, act: [], attachments: [], comment: null },
});
const draft: WorkItemDetail["subs"] = [["PRJ-3", "Draft", "مسودة", "p1", 0]];

/** The screen as the page renders it on the board: the server's cards, and the item `?open=` names with its detail. */
const screenOf = (items: Task[], details: Record<string, WorkItemDetail>, open: string | null = null) => {
  const item = open ? items.find((one) => one.k === open) : undefined;
  return (
    <Tasks
      items={items}
      board
      page={{ page: 1, total: items.length, size: 50 }}
      columns={Object.fromEntries(items.map((one) => [one.st, items.filter((other) => other.st === one.st).length]))}
      scopes={{ hot: items.filter((one) => one.hot).length, comments: 0, all: items.length }}
      filters={{ scope: "hot", q: "", project: "", type: "", status: "", pri: "", who: "", from: "", to: "" }}
      views={[]}
      opened={item ? { item, detail: details[item.k] } : null}
    />
  );
};

/** The status tag beside the drawer's title. */
const drawerStatus = () => document.querySelector(".awp-drawer h2")?.nextElementSibling?.firstElementChild?.textContent;

/** The drawer's "Move to…" list, opened, as the labels it offers. */
async function moveOptions(): Promise<string[]> {
  const drawer = document.querySelector(".awp-drawer");
  if (!drawer) throw new Error("no drawer is open");
  await click(byText(drawer, '[role="combobox"]', "Move to…"));
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((option) => option.textContent?.trim() ?? "");
}

afterEach(async () => {
  await cleanup();
  query.value = "";
  query.pushed.length = 0;
  calls.changeStatus.length = 0;
});

describe("D194 the open drawer follows the item the server sends", () => {
  it("shows the new status after a move and sends the new version with the next one", async () => {
    const screen = await mount(withProviders(screenOf([brief], detail(draft)), directory));
    // A card opens its drawer through the address, which the server answers with the item (D349).
    await click(byText(screen.container, "button.awp-card span", "PRJ-1 · PRJ")?.closest("button"));
    expect(query.pushed).toEqual(["/work-items?open=PRJ-1"]);
    await screen.rerender(withProviders(screenOf([brief], detail(draft), "PRJ-1"), directory));
    expect(drawerStatus()).toBe("To do");

    // The move was written and the page revalidated: the same item, a status and version on.
    await screen.rerender(withProviders(screenOf([{ ...brief, st: "InProgress", version: 4 }], detail(draft), "PRJ-1"), directory));
    expect(drawerStatus()).toBe("In progress");

    await moveOptions();
    // Blocked is a move from both statuses, so the click lands whichever one the drawer holds.
    await click(byText(document.body, '[role="option"]', "Blocked"));
    expect(calls.changeStatus).toEqual([{ key: "PRJ-1", status: "Blocked", version: 4 }]);
  });
});

describe("D186 the drawer's sub items follow the detail the server sends", () => {
  it("shows a sub item added after the drawer opened", async () => {
    query.value = "open=PRJ-1";
    const screen = await mount(withProviders(screenOf([brief], detail(draft), "PRJ-1"), directory));
    expect(document.querySelector(".awp-drawer")?.textContent).not.toContain("Check the totals");

    const added: WorkItemDetail["subs"] = [...draft, ["PRJ-5", "Check the totals", "مراجعة المجاميع", "p1", 0]];
    await screen.rerender(withProviders(screenOf([{ ...brief, sub: 2 }], detail(added), "PRJ-1"), directory));
    expect(document.querySelector(".awp-drawer")?.textContent).toContain("Check the totals");
  });
});

describe("D192 the drawer offers the moves the platform allows", () => {
  // The board's column labels, written out rather than read from the screen's own table.
  const label: Record<WorkItemStatus, string> = {
    Backlog: "Backlog", ToDo: "To do", InProgress: "In progress", InReview: "In review", Blocked: "Blocked", Done: "Done", Cancelled: "Cancelled",
  };

  // In review, Blocked and Done carry their own actions (approve, unblock, reopen) instead.
  it.each(["Backlog", "ToDo", "InProgress", "Cancelled"] as const)("from %s, exactly the allowed transitions", async (status) => {
    query.value = "open=PRJ-1";
    await mount(withProviders(screenOf([{ ...brief, st: status }], detail(draft), "PRJ-1"), directory));
    expect(await moveOptions()).toEqual(["Move to…", ...ALLOWED_TRANSITIONS[status].map((to) => label[to])]);
  });

  it("from In progress, every move but back to Backlog", async () => {
    query.value = "open=PRJ-1";
    await mount(withProviders(screenOf([{ ...brief, st: "InProgress" }], detail(draft), "PRJ-1"), directory));
    expect(await moveOptions()).toEqual(["Move to…", "To do", "In review", "Blocked", "Done", "Cancelled"]);
  });
});

describe("D197 the drawer offers a review only where the service takes one", () => {
  it.each([
    ["ToDo", true],
    ["InProgress", true],
    ["Backlog", false],
    ["Cancelled", false],
  ] as const)("from %s, Submit for review is offered: %s", async (status, offered) => {
    query.value = "open=PRJ-1";
    await mount(withProviders(screenOf([{ ...brief, st: status }], detail(draft), "PRJ-1"), directory));
    expect(byText(document, ".awp-drawer button", "Submit for review") !== undefined).toBe(offered);
  });
});
