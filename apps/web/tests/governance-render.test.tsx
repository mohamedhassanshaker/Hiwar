import type { ReactNode } from "react";
import { DEFAULT_MAIL_SETTINGS } from "@/db/queries/mail";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
vi.mock("@/features/governance/actions", () =>
  Object.fromEntries(
    [
      "exportAudit",
      "saveBrandColour",
      "saveBrandingAsset",
      "saveGeneralSettings",
      "setAgentsPaused",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

// The App Router is not mounted under `react-dom/server`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(),
}));

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { Audit, Logs } from "@/features/governance/components/govern";
import { Docs } from "@/features/governance/components/docs";
import { SystemPage } from "@/features/governance/components/system-page";
import { Settings } from "@/features/governance/components/settings";
import type { AuditRow, DocPage, LogRow, Settings as SettingsData, SystemState } from "@/features/governance/types";
import { PreferencesProvider } from "@/lib/preferences";
import type { Person } from "@/types/directory";

/** S-73 to S-75, S-78 and S-79 on first render, held as snapshots (see `screen-render.test.tsx`). */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

/** No modal is open on first render, so the registry the provider would draw from is empty. */
const noModals = {} as ModalRegistry;

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may }}>
        <ToastProvider>
          <ModalProvider registry={noModals}>{node}</ModalProvider>
        </ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-73 to S-79 governance screens", () => {
  it("draws the audit log", () => {
    const rows: AuditRow[] = [
      { at: "2026-01-10T09:00:00Z", actorType: "Person", actor: "p1", actorLabel: "Quality Analyst", action: "work_items:write", objectType: "WorkItem", objectLabel: "PRJ-1", detail: "{}", outcome: "Allowed" },
      { at: "2026-01-10T09:05:00Z", actorType: "Agent", actor: "a1", actorLabel: "pa", action: "settings:write", objectType: "Settings", objectLabel: null, detail: "{}", outcome: "Denied" },
    ];
    expect(renderScreen(<Audit rows={rows} page={{ page: 1, total: rows.length, size: 50 }} actor="all" period="7d" action="" />, ["audit:read", "exports:create"])).toMatchSnapshot();
  });

  it("draws the service log", () => {
    const rows: LogRow[] = [
      { at: "2026-01-10T09:00:00Z", level: "info", service: "awp-web", correlationId: "c-1", message: "a request was served" },
      { at: "2026-01-10T09:01:00Z", level: "error", service: "awp-agent", correlationId: null, message: "an ingestion run did not start" },
    ];
    expect(renderScreen(<Logs rows={rows} page={{ page: 1, total: rows.length, size: 50 }} services={["awp-agent", "awp-web"]} level="all" service="all" runId="" />)).toMatchSnapshot();
  });

  it("draws the settings", () => {
    const settings: SettingsData = {
      mail: { ...DEFAULT_MAIL_SETTINGS, hasPassword: false },
      organisation: { nameEn: "Tahseel", nameAr: "تحصيل", timeZone: "Asia/Dubai", languages: ["en", "ar"] },
      workingCalendarEn: "Working week",
      workingCalendarAr: "أسبوع العمل",
      holidayCalendarEn: "UAE holidays",
      holidayCalendarAr: "عطلات الإمارات",
      workingCalendarId: "cal-1",
      holidayCalendarId: "cal-2",
      brandColour: "#0677FF",
      versionNumber: 4,
      branding: [{ kind: "Favicon", contentRef: "files/favicon.png" }],
      flags: [
        { key: "graph-retrieval-graphiti", group: "Knowledge", nameEn: "Graph retrieval", nameAr: "الاسترجاع الرسومي", enabled: true },
        { key: "embedded-deployments", group: "Engage", nameEn: "Embedded deployments", nameAr: "النشر المضمّن", enabled: false },
      ],
    };
    expect(renderScreen(<Settings settings={settings} />, ["settings:read", "settings:write"])).toMatchSnapshot();
  });

  it("draws the system state", () => {
    const state: SystemState = {
      agentsPaused: false,
      pausedAt: null,
      activeRuns: 3,
      queueDepth: 1,
      activeRooms: 2,
      services: [
        { name: "postgres", version: "18", status: "Healthy" },
        { name: "agent", version: null, status: "Error", detail: "connect ECONNREFUSED" },
      ],
      checkedAt: "2026-01-10T09:00:00Z",
    };
    expect(renderScreen(<SystemPage state={state} />, ["system:read", "system:operate"])).toMatchSnapshot();
  });

  it("draws the documentation", () => {
    const pages: DocPage[] = [
      { slug: "getting-started", titleEn: "Getting started", titleAr: "البدء", bodyEn: "Open the **Dashboard**.", bodyAr: "افتح **لوحة التحكم**." },
      { slug: "requests", titleEn: "Requests", titleAr: "الطلبات", bodyEn: "Raise a request.", bodyAr: "ارفع طلباً." },
    ];
    expect(renderScreen(<Docs pages={pages} />)).toMatchSnapshot();
  });
});
