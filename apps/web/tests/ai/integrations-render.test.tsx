import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// First render calls no server action, so each is a stub that would refuse if it ever were.
vi.mock("@/features/integrations/actions", () =>
  Object.fromEntries(
    [
      "createClient",
      "createKey",
      "deleteClient",
      "revokeKey",
      "rotateKey",
      "setAgui",
      "setClientStatus",
      "setMcp",
      "setPermissions",
      "testMcpConnection",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Integrations } from "@/features/integrations/components/integrations";
import type { Client, ClientDetail, ClientOption } from "@/features/integrations/types";
import { PreferencesProvider } from "@/lib/preferences";

/** What the integrations screen draws on first render, held as a snapshot. */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may }}>
        <ToastProvider>{node}</ToastProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-76 and S-77 integrations", () => {
  const clients: Client[] = [
    { id: "cli_erp", n: "ERP", nAr: "نظام الموارد", own: "p1", perms: ["work_items:read"], agents: ["exp"], keys: 2, mcp: true, agui: false, lastUsedAt: null, st: "Active" },
    { id: "cli_portal", n: "Portal", nAr: "البوابة", own: "p1", perms: ["agents:invoke"], agents: [], keys: 0, mcp: false, agui: true, lastUsedAt: null, st: "Inactive" },
  ];
  const details: Record<string, ClientDetail> = {
    cli_erp: {
      keys: [],
      mcp: { enabled: true, authType: "ApiKey", exposedTools: ["work_item_search"], lastTestAt: null, lastTestResult: null },
      agui: { enabled: false, allowedEvents: [], allowedOrigins: [] },
    },
  };
  const tools: ClientOption[] = [{ code: "work_item_search", en: "Search work items", ar: "البحث في عناصر العمل" }];
  const permissions: ClientOption[] = [{ code: "work_items:read", en: "Read work items", ar: "قراءة عناصر العمل" }];

  it("draws the client list", () => {
    expect(
      renderScreen(
        <Integrations clients={clients} details={details} base="https://platform.example.test" tools={tools} permissions={permissions} />,
        ["integrations:write"],
      ),
    ).toMatchSnapshot();
  });
});
