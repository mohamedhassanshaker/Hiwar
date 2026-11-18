// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// What the server says this person may do: the step is free, then theirs once taken.
const server = vi.hoisted(() => ({ taken: false }));
vi.mock("@/features/requests/actions", () => ({
  actionsForRequest: async () => ({
    actions: ["Approve"],
    reason: null,
    reasonAr: null,
    claim: { by: server.taken ? "Quality Analyst" : null, mine: server.taken, mayTake: !server.taken },
  }),
  takeRequestStep: async () => {
    server.taken = true;
    return { ok: true, value: undefined };
  },
  releaseRequestStep: async () => ({ ok: true, value: undefined }),
  assignRequestToAgent: async () => ({ ok: true, value: { started: true, reason: null } }),
  deleteRequest: async () => ({ ok: true, value: undefined }),
  rejectRequest: async () => ({ ok: true, value: undefined }),
  requestChanges: async () => ({ ok: true, value: { toStepName: null } }),
  takeStepAction: async () => ({ ok: true, value: { toStepName: null, status: "Completed", noMatchingRoute: false } }),
}));
vi.mock("@/features/rooms/actions", () => ({ createRoomFromRequest: async () => ({ ok: true, value: "SES-1" }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/requests",
  useSearchParams: () => new URLSearchParams(),
}));

import { RequestView } from "@/features/requests/components/request-view";
import type { Request } from "@/features/requests/types";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

/** D219: the step's actions live in its action window, which taking the step opens. */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const request: Request = {
  k: "REQ-1001",
  t: "New laptops",
  tAr: "أجهزة جديدة",
  ty: "PROC",
  p: "FIN",
  by: "p2",
  st: "InReview",
  submittedAt: "2026-10-01T08:00:00Z",
  ch: "Console",
  mode: "form",
};

afterEach(async () => {
  server.taken = false;
  await cleanup();
});

describe("acting on a request step", () => {
  it("offers only Take this step until the step is taken, then opens the action window", async () => {
    await mount(
      withProviders(
        <RequestView r={request} detail={undefined} types={[]} back={() => undefined} go={() => undefined} />,
        { me, agents: [], people: [me], projects: [], may: ["requests:write"] },
      ),
    );
    const button = (label: string) => byText(document.body, "button", label);
    // Let the first actionsForRequest settle.
    await click(document.body);

    expect(button("Take this step")).toBeDefined();
    for (const label of ["Approve", "Return", "Reject", "Assign to agent"]) expect(button(label)).toBeUndefined();

    await click(button("Take this step"));

    for (const label of ["Approve", "Return", "Reject", "Assign to agent"]) expect(button(label)).toBeDefined();
    expect(button("Take this step")).toBeUndefined();
    expect(button("Release step")).toBeDefined();
  });
});
