import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Server actions are a network boundary and first render calls none of them, so each is a
// stub that would refuse if it ever were called.
const { refusing } = vi.hoisted(() => ({
  refusing: (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })])),
}));
vi.mock("@/features/rooms/actions", () =>
  refusing([
    "closeRoom",
    "createWorkItemFromMessage",
    "deleteRoom",
    "forkRoom",
    "postMessage",
    "recordFeedback",
    "setParticipant",
    "setRoomAdmin",
    "setTurnTaking",
  ]),
);
vi.mock("@/features/engage/actions", () => refusing(["mirrorRoom"]));
vi.mock("@/features/inbox/actions", () => refusing(["decide"]));
// The App Router is not mounted under `react-dom/server`; navigation is never reached on first render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/discussion-rooms/SES-1",
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { SessionRoom, type RoomScreen } from "@/features/rooms/components/room";
import { PreferencesProvider } from "@/lib/preferences";
import type { Agent } from "@/types/directory";

/** S-23 on first render, held as a snapshot (see `tests/screen-render.test.tsx`). */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const other = { id: "p2", ini: "RV", photo: null, name: "Reviewer", nameAr: "المراجع", role: "", roleAr: "", email: "rv@example.test" };
const agent: Agent = {
  id: "ops",
  ini: "OP",
  name: "Operations Agent",
  nameAr: "وكيل العمليات",
  unit: "Operations",
  unitAr: "العمليات",
  ver: "v3",
  model: "reasoning-default",
  status: "Idle",
  profile: "Conversational",
  runs: 4,
  cost: 1.5,
};
/** No modal is open on first render, so the host needs no registered modal. */
const noModals = {} as ModalRegistry;

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [agent], people: [me, other], projects: [], may }}>
        <ToastProvider>
          <ModalProvider registry={noModals}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

const approval = {
  key: "APR-7",
  action: "work_item_edit",
  risk: "High",
  changesEn: "Status to Done",
  changesAr: "الحالة إلى منجز",
  approvers: "Quality Analyst",
  status: "Pending",
  inboxItemId: "inbox-1",
  requester: "Quality Analyst",
  mayDecide: true,
};

const detail: RoomScreen = {
  room: {
    key: "SES-1",
    version: 2,
    p: "PRJ-1",
    t: "West gate repair",
    tAr: "إصلاح البوابة الغربية",
    type: "Chat",
    src: "Console",
    st: "Active",
    who: ["p1", "p2", "ops"],
    msgs: 3,
    lastActivityAt: "2026-10-19T08:00:00.000Z",
    cost: 0.42,
    kind: "Chat",
  },
  roomId: "room-1",
  projectNameEn: "Facilities",
  projectNameAr: "المرافق",
  participants: [
    { id: "p1", role: "Owner", isAgent: false, working: false, runId: null },
    { id: "p2", role: "Member", isAgent: false, working: false, runId: null },
    { id: "ops", role: "MemberAgent", isAgent: true, working: true, runId: "11111111-1111-4111-8111-111111111111" },
  ],
  turnTaking: "MentionOnly",
  earlier: false,
  waitingQuestions: [],
  messages: [
    {
      id: "m1",
      seq: 1,
      sender: "p1",
      at: "2026-10-19T07:55:00.000Z",
      en: "@ops the west gate will not close.",
      ar: "@ops البوابة الغربية لا تغلق.",
      artifact: null,
      attachment: { name: "gate-photo.jpg" },
      question: null,
      approval: null,
      agentMeta: null,
      steps: [],
    },
    {
      id: "m2",
      seq: 2,
      sender: "ops",
      at: "2026-10-19T07:58:00.000Z",
      en: "I drafted the repair order.",
      ar: "صغت أمر الإصلاح.",
      artifact: { name: "Repair order", noteEn: "Draft for review", noteAr: "مسودة للمراجعة" },
      attachment: null,
      question: null,
      approval,
      agentMeta: { version: "v3", runKey: "RUN-9" },
      steps: [
        { id: "s1", name: "work_item_search", args: { query: "west gate" }, state: "done", result: "[]" },
        { id: "s2", name: "work_item_create", args: { title: "Repair the west gate" }, state: "done", result: "WI-12" },
      ],
    },
    {
      id: "m3",
      seq: 3,
      sender: "ops",
      at: "2026-10-19T08:00:00.000Z",
      en: "A second change waits on its requester.",
      ar: "تغيير ثانٍ ينتظر صاحب الطلب.",
      artifact: null,
      attachment: null,
      question: null,
      approval: { ...approval, key: "APR-8", risk: "Low", mayDecide: false, approvers: "Reviewer", requester: "Reviewer" },
      agentMeta: { version: "v3", runKey: null },
      steps: [],
    },
  ],
  linkedWorkItems: [{ key: "WI-12", titleEn: "Replace the hinge", titleAr: "استبدال المفصلة" }],
  files: [
    { name: "gate-photo.jpg", kind: "attachment", mimeType: "image/jpeg", size: 20480, by: "p1", at: "2026-10-19T07:55:00.000Z" },
    { name: "Repair order", kind: "artifact", mimeType: null, size: null, by: "ops", at: "2026-10-19T07:58:00.000Z" },
  ],
  contextUsage: null,
  feedback: { m2: "Helpful" },
  postRefusal: null,
  mayModerate: true,
  mayManage: true,
};

describe("S-23 a discussion room", () => {
  it("draws the thread, its approval cards and the moderator's controls", () => {
    expect(renderScreen(<SessionRoom detail={detail} />, ["rooms:write", "rooms:moderate"])).toMatchSnapshot();
  });

  it("draws a closed room for an observer who may not post or moderate", () => {
    const closed: RoomScreen = {
      ...detail,
      room: { ...detail.room, st: "Closed" },
      mayModerate: false,
      mayManage: false,
      postRefusal: { en: "Observers read the room but do not post.", ar: "المراقبون يقرؤون الغرفة ولا يكتبون فيها." },
      feedback: {},
    };
    expect(renderScreen(<SessionRoom detail={closed} />)).toMatchSnapshot();
  });

  it("D392 offers an admin the means to manage participants, and everybody else the list", () => {
    const admin = renderScreen(<SessionRoom detail={detail} />);
    expect(admin).toContain('aria-label="Options for Reviewer"');
    expect(admin).toContain('aria-label="Add participant"');
    // The Owner is always an admin and cannot be removed: no options for them.
    expect(admin).not.toContain('aria-label="Options for Quality Analyst"');

    const member = renderScreen(<SessionRoom detail={{ ...detail, mayManage: false }} />);
    expect(member).not.toContain("Options for");
    expect(member).not.toContain('aria-label="Add participant"');
    expect(member).toContain("Only the room&#x27;s admins can add or remove participants.");
    // The turn-taking select is read-only for them, and enabled for an admin.
    expect(member).toContain('disabled="" aria-label="Turn-taking"');
    expect(admin).not.toContain('disabled="" aria-label="Turn-taking"');
  });

  it("D392 offers to raise a work item or a request from an agent's message as from a person's", () => {
    const html = renderScreen(<SessionRoom detail={detail} />);
    // Three messages with text, two of them an agent's.
    expect(html.match(/Create work item/g)).toHaveLength(3);
    expect(html.match(/Create request/g)).toHaveLength(3);
  });

  it("D352 folds an agent reply's tool calls to one line above its text", () => {
    const html = renderScreen(<SessionRoom detail={detail} />);
    expect(html).toContain('aria-expanded="false"><span>2 steps done</span>');
    expect(html).not.toContain("Repair the west gate");
    expect(html.indexOf("2 steps done")).toBeLessThan(html.indexOf("I drafted the repair order."));
  });

  it("D349 offers the earlier messages only when the room has more than it read", () => {
    expect(renderScreen(<SessionRoom detail={detail} />)).not.toContain("Show earlier messages");
    expect(renderScreen(<SessionRoom detail={{ ...detail, earlier: true }} />)).toContain("Show earlier messages");
  });

  it("shows the lead agent's context window and what its last reply read of it", () => {
    const usage = { agent: "ops", route: "local-private", window: 4096, lastTokensIn: 3900 };
    const html = renderScreen(<SessionRoom detail={{ ...detail, contextUsage: usage }} />);
    expect(html).toContain("Operations Agent");
    expect(html).toContain("local-private");
    expect(html).toContain(`Window: ${(4096).toLocaleString()} tokens`);
    expect(html).toContain(`Last reply read: ${(3900).toLocaleString()} tokens`);
    expect(html).toMatch(/<meter[^>]*max="4096"[^>]*value="3900"/);
  });

  it("says a context window that is not recorded, and a room with no reply yet, without a meter", () => {
    const usage = { agent: "ops", route: "local-private", window: null, lastTokensIn: null };
    const html = renderScreen(<SessionRoom detail={{ ...detail, contextUsage: usage }} />);
    expect(html).toContain("Window: not recorded");
    expect(html).toContain("Last reply read: no reply yet");
    expect(html).not.toContain("<meter");
    expect(renderScreen(<SessionRoom detail={detail} />)).toContain("No lead agent.");
  });

  it("UC-12.2-01 offers a run's waiting question in the room to the person it was asked of", () => {
    const waiting = {
      id: "00000000-0000-4000-8000-000000000002",
      question: "Which template should the Excel file follow?",
      options: [],
      answer: null,
      answeredBy: null,
      askedTo: "Quality Analyst",
      mayAnswer: true,
    };
    const html = renderScreen(<SessionRoom detail={{ ...detail, waitingQuestions: [waiting] }} />);
    expect(html).toContain("Which template should the Excel file follow?");
    expect(html).toContain("Send answer");
  });
});
