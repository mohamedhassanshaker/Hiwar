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

import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalProps, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { PreferencesProvider } from "@/lib/preferences";
import { Tasks } from "@/features/work-items/components/work-items";
import type { Task, WorkItemDetail } from "@/features/work-items/types";
import type { Person, Project } from "@/types/directory";
import { byText, cleanup, click, mount } from "./dom";

/**
 * A work item's attachments list both the files attached to it and the artifacts an agent saved
 * against it. Each opens the preview as what it is, because the two are read from different
 * places: an artifact opened as an attachment was "no longer there".
 */

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const project: Project = { k: "PRJ", n: "Project", nAr: "مشروع", st: "Active", own: "p1", unit: "", sens: "Internal", items: 1, prog: 0 };
const task: Task = {
  k: "PRJ-1", p: "PRJ", t: "Forecast deck", tAr: "عرض التوقعات", type: "Task", st: "InProgress", who: "p1", pri: "Medium",
  dueAt: null, sub: 0, done: 0, version: 1, hot: false, fromComment: false,
};
const details: Record<string, WorkItemDetail> = {
  "PRJ-1": {
    rt: ["—", "—"], org: null, rev: "", sch: "—", desc: null, at: [], subs: [], act: [], comment: null,
    attachments: [["brief.pdf", "12 KB", "attachment"], ["Dubai forecast", "31 KB", "artifact"]],
  },
};

afterEach(cleanup);

describe("a work item's attachments", () => {
  it("opens an attachment through the item and a linked artifact as an artifact", async () => {
    const opened: ModalProps[] = [];
    const Preview = (props: ModalProps) => {
      opened.push(props);
      return null;
    };
    const { container } = await mount(
      <PreferencesProvider>
        <DirectoryProvider value={{ me, agents: [], people: [me], projects: [project], may: ["work_items:write"] }}>
          <ToastProvider>
            <ModalProvider registry={{ preview: Preview } as unknown as ModalRegistry}>
              <Tasks items={[task]} board
      page={{ page: 1, total: 1, size: 50 }}
      columns={{ [task.st]: 1 }}
      scopes={{ hot: 0, comments: 0, all: 1 }}
      filters={{ scope: "all", q: "", project: "", type: "", status: "", pri: "", who: "", from: "", to: "" }}
      views={[]} opened={{ item: task, detail: details["PRJ-1"] }} />
            </ModalProvider>
          </ToastProvider>
        </DirectoryProvider>
      </PreferencesProvider>,
    );

    await click(byText(container, "button", "brief.pdf"));
    expect(opened.at(-1)).toMatchObject({ item: { n: "brief.pdf", kind: "attachment" }, owner: { type: "WorkItem", key: "PRJ-1" } });

    await click(byText(container, "button", "Dubai forecast"));
    expect(opened.at(-1)).toMatchObject({ item: { n: "Dubai forecast", kind: "artifact" } });
    expect(opened.at(-1)?.owner).toBeUndefined();
  });
});
