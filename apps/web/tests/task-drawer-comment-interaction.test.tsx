// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/work-items/actions", () =>
  Object.fromEntries(
    [
      "addSubItem", "approve", "assign", "assignToAgent", "attach", "changeStatus", "comment", "createWorkItem", "deleteWorkItem",
      "reopen", "requestChanges", "saveView", "searchWorkItems", "setSubItemDone", "similarOpenItems", "submitForReview", "unblock",
    ].map((name) => [name, async () => ({ ok: true })]),
  ),
);
vi.mock("@/features/rooms/actions", () => ({ createRoom: async () => ({ ok: true }), createRoomFromWorkItem: async () => ({ ok: true }) }));
vi.mock("@/features/rooms/directory", () => ({ allowedAgentsFor: async () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/work-items",
  useSearchParams: () => new URLSearchParams("open=PRJ-1"),
}));

import { Tasks } from "@/features/work-items/components/work-items";
import type { Task, WorkItemDetail } from "@/features/work-items/types";
import type { Person, Project } from "@/types/directory";
import { cleanup, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const project: Project = { k: "PRJ", n: "Project", nAr: "مشروع", st: "Active", own: "p1", unit: "", sens: "Internal", items: 1, prog: 0 };
const directory = { me, agents: [], people: [me], projects: [project], may: ["work_items:write" as const] };

const task: Task = {
  k: "PRJ-1", p: "PRJ", t: "Fix the total", tAr: "تصحيح المجموع", type: "Task", st: "ToDo", who: "p1", pri: "High",
  dueAt: null, sub: 0, done: 0, version: 1, hot: false, fromComment: true,
};
const detail = (commentText: string): Record<string, WorkItemDetail> => ({
  "PRJ-1": {
    rt: ["—", "—"], org: ["q:live", "inbox"] as never, rev: "", sch: "—", desc: "This total is wrong.", at: [], subs: [], act: [],
    attachments: [["comment-capture.jpg", "12 KB", "attachment"]], comment: { card: "live", text: commentText, captureUrl: null },
  },
});

afterEach(cleanup);

describe("a work item raised from a comment", () => {
  it("shows its own description once the comment is deleted", async () => {
    await mount(withProviders(<Tasks items={[task]} board
      page={{ page: 1, total: 1, size: 50 }}
      columns={{ [task.st]: 1 }}
      scopes={{ hot: 0, comments: 0, all: 1 }}
      filters={{ scope: "all", q: "", project: "", type: "", status: "", pri: "", who: "", from: "", to: "" }}
      views={[]} opened={{ item: task, detail: detail("")["PRJ-1"] }} />, directory));
    const drawer = document.querySelector(".awp-drawer");
    expect(drawer?.textContent).toContain("This total is wrong.");
  });
});
