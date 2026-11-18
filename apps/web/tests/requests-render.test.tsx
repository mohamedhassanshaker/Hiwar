import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
const { refusing, search } = vi.hoisted(() => ({
  refusing: (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })])),
  search: { query: "" },
}));
vi.mock("@/features/requests/actions", () =>
  refusing([
    "actionsForRequest",
    "addRequestTypeAttribute",
    "addRequestTypeAudience",
    "addRequestTypeRule",
    "addRequestTypeStep",
    "assignRequestToAgent",
    "createRequest",
    "createRequestType",
    "deleteRequest",
    "deleteRequestTypeStep",
    "publishRequestType",
    "removeRequestTypeAttribute",
    "requestChanges",
    "saveRequestTypeDraft",
    "setRequestTypeStepSla",
    "setRequestTypeStepTerminal",
    "takeStepAction",
  ]),
);
vi.mock("@/features/rooms/actions", () => refusing(["createRoomFromRequest"]));

// The screen reads which request to open from the query string; the router is never used on
// first render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/requests",
  useSearchParams: () => new URLSearchParams(search.query),
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { Requests } from "@/features/requests/components/requests";
import type { Request, RequestDetail, RequestType } from "@/features/requests/types";
import { PreferencesProvider } from "@/lib/preferences";

/** S-27 and S-28 on first render: the request list, and one request opened from a link. */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may }}>
        <ToastProvider>
          <ModalProvider registry={{} as ModalRegistry}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-27 and S-28 requests", () => {
  const types: RequestType[] = [
    { c: "PROC", n: "Procurement", nAr: "مشتريات", cat: "Finance", v: "v2", st: "Published", ch: "Console", dec: "None", sla: "2 days", open: 1, p: "FIN" },
    { c: "HIRE", n: "Hiring", nAr: "توظيف", cat: "People", v: "v1", st: "Draft", ch: "Console, Widget", dec: "Agent", sla: "—", open: 0, p: "" },
  ];
  const requests: Request[] = [
    { k: "REQ-1001", t: "New laptops", tAr: "أجهزة جديدة", ty: "PROC", p: "FIN", by: "p1", st: "InReview", submittedAt: "2026-10-01T08:00:00Z", ch: "Console", mode: "form" },
    { k: "REQ-1002", t: "Card reader", tAr: "قارئ بطاقات", ty: "PROC", p: "FIN", by: "ext", st: "Submitted", submittedAt: "2026-10-02T09:30:00Z", ch: "Widget", mode: "agent" },
  ];
  const details: Record<string, RequestDetail> = {
    "REQ-1001": {
      key: "REQ-1001",
      descEn: "Five laptops for the new analysts.",
      descAr: "خمسة أجهزة للمحللين الجدد.",
      steps: [
        { n: "Submitted", nAr: "مقدم", isTerminal: false, terminalOutcome: "Completed", slaValue: null, slaUnit: null, aud: [["Requester", "مقدم الطلب", "CanAct"]], out: [["Submit", "Finance approval", ""]] },
        { n: "Finance approval", nAr: "اعتماد مالي", isTerminal: false, terminalOutcome: "Completed", slaValue: 1, slaUnit: "BusinessDays", aud: [["Finance", "المالية", "CanAct"]], out: [["Approve", "Closed", ""]] },
        { n: "Closed", nAr: "مغلق", isTerminal: true, terminalOutcome: "Completed", slaValue: null, slaUnit: null, aud: [], out: [] },
      ],
      currentStep: 1,
      attributes: [["amount_aed", "18600"]],
      fields: [],
      schemaLabel: "Procurement v2",
      dueAt: "2026-10-03T12:00:00Z",
      slaAtRisk: true,
      attachments: [["quote.pdf", "120 KB"]],
      history: [{ at: "2026-10-01T08:00:00Z", who: "p1", detailEn: "Submitted the request.", detailAr: "قدّم الطلب.", attributes: null }],
      subRequests: [{ k: "REQ-1003", t: "Docking stations", tAr: "محطات إرساء", st: "Submitted" }],
      workItems: [{ k: "TSK-12", t: "Order the laptops", tAr: "طلب الأجهزة", who: "p1", st: "ToDo" }],
      parent: null,
    },
  };

  // The screen as the page renders it: one page of the list, and the request `?open=` names with its detail (D349).
  const screen = () => {
    const open = new URLSearchParams(search.query).get("open");
    const request = requests.find((one) => one.k === open);
    return (
      <Requests
        requests={requests}
        page={{ page: 1, total: requests.length, size: 50 }}
        types={types}
        filters={{ q: "", project: "", by: "", type: "", status: "", from: "", to: "" }}
        opened={request ? { request, detail: details[request.k] } : null}
      />
    );
  };

  it("draws the request list", () => {
    search.query = "";
    expect(renderScreen(screen(), ["requests:write"])).toMatchSnapshot();
  });

  it("opens the request a link names", () => {
    search.query = "open=REQ-1001";
    expect(renderScreen(screen(), ["requests:write", "rooms:write", "agents:invoke"])).toMatchSnapshot();
  });
});
