// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// A decision the server accepts; the screen is then re-rendered with the item resolved, as the
// server sends it after `revalidatePath`.
vi.mock("@/features/inbox/actions", () => ({
  answer: async () => ({ ok: true }),
  decide: async () => ({ ok: true }),
}));
// The live refresh needs a server stream; the re-render below stands in for it.
vi.mock("@/components/shared/live-region", () => ({ LiveRegion: () => null }));
// The address the screen is opened at; a test sets it before mounting.
const address = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(address.search),
}));

import { CommentsProvider } from "@/features/comments/components/comment-store";
import { Inbox } from "@/features/inbox/components/inbox";
import type { InboxItem } from "@/features/inbox/types";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: ["approvals:decide" as const] };

const approval = (id: string, title: string, resolved = false): InboxItem => ({
  id,
  kind: "approval",
  risk: "Medium",
  from: "p1",
  t: title,
  tAr: title,
  at: "2026-10-21T06:00:00.000Z",
  tool: "work_item_edit",
  args: "{}",
  evidence: [],
  runKey: null,
  workItemKey: null,
  policy: "AnyOf",
  resolved,
  roomKey: null,
  options: [],
  blocked: null,
  blockedAr: null,
  registration: false,
  link: null,
});

/**
 * The Inbox inside the comment store it reads quick requests from, with none, showing one page
 * of open items as the server sends it, with the counts of what is open and resolved.
 */
const inbox = (items: InboxItem[], { resolved = 0, selected = null }: { resolved?: number; selected?: InboxItem | null } = {}) =>
  withProviders(
    <CommentsProvider initial={[]}>
      <Inbox
        items={items}
        counts={{ open: { approval: items.length }, resolved }}
        selected={selected}
        filter="all"
        page={{ page: 1, total: items.length, size: 50 }}
        mayRaiseTasks={false}
      />
    </CommentsProvider>,
    directory,
  );

afterEach(() => {
  address.search = "";
  return cleanup();
});

describe("D201 the Inbox keeps a decided item in the pane", () => {
  it("shows the approval just decided as resolved, not the next one waiting", async () => {
    const first = approval("i1", "Close TSK-1");
    const second = approval("i2", "Close TSK-2");
    const screen = await mount(inbox([first, second]));

    await click(byText(document, "button", "Approve"));
    // The server's next page of open items no longer has it.
    await screen.rerender(inbox([second], { resolved: 1 }));

    const pane = document.querySelectorAll(".awp-inbox > .awp-card")[1];
    expect(pane?.textContent).toContain("Close TSK-1");
    expect(pane?.textContent).toContain("Resolved — the run was told");
    expect(pane?.textContent).not.toContain("Close TSK-2");
  });
});

describe("D349 an Inbox item the address selects", () => {
  it("opens even when it is not on the page the server sent", async () => {
    address.search = "sel=i9";
    const far = approval("i9", "Close TSK-9");
    await mount(inbox([approval("i1", "Close TSK-1")], { selected: far }));

    const pane = document.querySelectorAll(".awp-inbox > .awp-card")[1];
    expect(pane?.textContent).toContain("Close TSK-9");
  });
});
