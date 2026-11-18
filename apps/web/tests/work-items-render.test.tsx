import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
vi.mock("@/features/work-items/actions", () =>
  Object.fromEntries(
    [
      "addSubItem",
      "approve",
      "assignToAgent",
      "attach",
      "changeStatus",
      "comment",
      "createWorkItem",
      "deleteWorkItem",
      "reopen",
      "requestChanges",
      "saveView",
      "searchWorkItems",
      "setSubItemDone",
      "similarOpenItems",
      "submitForReview",
      "unblock",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);
vi.mock("@/features/rooms/actions", () =>
  Object.fromEntries(
    ["createRoom", "createRoomFromWorkItem"].map((name) => [
      name,
      async () => ({ ok: false, reason: `${name} is not called on first render` }),
    ]),
  ),
);
vi.mock("@/features/rooms/directory", () => ({ allowedAgentsFor: async () => null }));

// The App Router is not mounted under `react-dom/server`; the query string is the one input
// the board reads from it, and `?open=` is what opens the drawer on first render.
const query = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/work-items",
  useSearchParams: () => new URLSearchParams(query.value),
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { Tasks } from "@/features/work-items/components/work-items";
import { NewWorkItemModal } from "@/features/work-items/components/work-modals";
import { NewRoomModal } from "@/features/work-items/components/new-room-modal";
import type { SavedView, Task, WorkItemDetail } from "@/features/work-items/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Agent, Person, Project } from "@/types/directory";

/** S-24 and S-25 on first render, held as a snapshot (see `screen-render.test.tsx`). */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const reviewer: Person = { id: "p2", ini: "RV", photo: null, name: "Reviewer", nameAr: "المراجع", role: "", roleAr: "", email: "rv@example.test" };
const agent: Agent = { id: "a1", ini: "PA", name: "Platform Assistant", nameAr: "مساعد المنصة", unit: "", unitAr: "", ver: "v1", model: "reasoning-default", status: "Idle", profile: "conversational", runs: 0, cost: 0 };
const project: Project = { k: "PRJ", n: "Project", nAr: "مشروع", st: "Active", own: "p1", unit: "", sens: "Internal", items: 2, prog: 50 };

/** No modal is open on first render, so the registry the provider would draw from is empty. */
const noModals = {} as ModalRegistry;

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [agent], people: [me, reviewer], projects: [project], may }}>
        <ToastProvider>
          <ModalProvider registry={noModals}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-24 and S-25 work items", () => {
  const items: Task[] = [
    { k: "PRJ-1", p: "PRJ", t: "Write the brief", tAr: "كتابة الموجز", type: "Task", st: "InProgress", who: "p1", pri: "High", dueAt: "2026-01-15", sub: 2, done: 1, version: 3, hot: true, fromComment: false },
    { k: "PRJ-2", p: "PRJ", t: "Fix the import", tAr: "إصلاح الاستيراد", type: "Bug", st: "Blocked", who: "a1", pri: "Medium", dueAt: null, sub: 0, done: 0, version: 1, hot: false, fromComment: true },
  ];
  const details: Record<string, WorkItemDetail> = {
    "PRJ-1": {
      rt: ["Change request", "طلب تغيير"],
      org: ["REQ-7", "requests"],
      rev: "p2",
      sch: "—",
      desc: "Move the vendor list into the shared drive. Acceptance criteria: one folder per vendor.",
      at: [["Severity", "High"]],
      subs: [["PRJ-3", "Draft", "مسودة", "p1", 1], ["PRJ-4", "Review", "مراجعة", "p2"]],
      act: [["p1", "moved it to In progress", "2026-01-10T09:00:00Z"]],
      attachments: [["brief.pdf", "files/brief.pdf", "attachment"]],
      comment: null,
    },
  };
  const views: SavedView[] = [{ name: "Mine", filter: { assignee: "p1" } }];
  // The screen as the page renders it: the board's cards, and the item `?open=` names with its detail (D349).
  const screen = (open: string | null) => (
    <Tasks
      items={items.filter((item) => item.hot)}
      board
      page={{ page: 1, total: 1, size: 50 }}
      columns={{ InProgress: 1 }}
      scopes={{ hot: 1, comments: 1, all: 2 }}
      filters={{ scope: "hot", q: "", project: "", type: "", status: "", pri: "", who: "", from: "", to: "" }}
      views={views}
      opened={open ? { item: items.find((item) => item.k === open)!, detail: details[open] } : null}
    />
  );

  it("draws the board", () => {
    query.value = "";
    expect(renderScreen(screen(null), ["work_items:write"])).toMatchSnapshot();
  });

  it("draws the drawer of the item the address opens", () => {
    query.value = "open=PRJ-1";
    expect(renderScreen(screen("PRJ-1"), ["work_items:write"])).toMatchSnapshot();
  });

  it("draws the new work item and new room forms", () => {
    query.value = "";
    const go = () => undefined;
    const close = () => undefined;
    expect(renderScreen(<NewWorkItemModal onClose={close} go={go} />)).toMatchSnapshot();
    expect(renderScreen(<NewRoomModal onClose={close} go={go} />)).toMatchSnapshot();
  });
});
