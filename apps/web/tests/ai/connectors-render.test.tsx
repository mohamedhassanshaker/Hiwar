import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The screen calls its server actions only once a person acts; first render calls none.
vi.mock("@/features/connectors/actions", () =>
  Object.fromEntries(
    [
      "connectOAuth",
      "importApiConnector",
      "refreshConnectorTools",
      "removeConnector",
      "saveConnector",
      "setConnectorEnabled",
      "setToolTier",
      "testConnector",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Connectors } from "@/features/connectors/components/connectors";
import type { Connector } from "@/features/connectors/types";
import { PreferencesProvider } from "@/lib/preferences";

/** What the S-54 Connectors screen draws on first render, held as a snapshot. */
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

describe("S-54 connectors", () => {
  const connectors: Connector[] = [
    {
      n: "erp",
      name: "ERP",
      nameAr: "نظام الموارد",
      d: "Finance ledger",
      dAr: "دفتر المالية",
      kind: "Remote MCP",
      transport: "StreamableHttp",
      url: "https://erp.example.test/mcp",
      command: "",
      auth: "OAuth",
      credential: { type: "OAuth", hasSecret: false, connected: true },
      st: "Connected",
      on: true,
      def: "T1",
      tools: [
        { name: "read_invoice", tier: "T0", available: true },
        { name: "post_entry", tier: "T2", available: true },
        { name: "new_tool", tier: "T1", available: false },
      ],
      catalogueId: null,
      version: 3,
      builtin: false,
    },
    {
      n: "sandbox-fs",
      name: "sandbox-fs",
      nameAr: "sandbox-fs",
      d: "",
      dAr: "",
      kind: "Local MCP (stdio)",
      transport: "Stdio",
      url: "",
      command: "npx -y server-fs",
      auth: "None",
      credential: { type: "None" },
      st: "Disabled",
      on: false,
      def: "T1",
      tools: [],
      catalogueId: null,
      version: 1,
      builtin: false,
    },
  ];

  it("draws the connected list for somebody who may change it", () => {
    const html = renderScreen(<Connectors connectors={connectors} oauthCallbackUrl="https://awp.test/api/connectors/oauth/callback" />, ["connectors:write"]);
    // The connected list is the whole screen: no Browse tab, and no tab bar.
    expect(html).toContain("sandbox-fs");
    expect(html).not.toContain("Browse");
    expect(html).not.toContain('role="tab"');
    expect(html).toMatchSnapshot();
  });

  it("draws it read-only without connectors:write", () => {
    expect(renderScreen(<Connectors connectors={connectors} oauthCallbackUrl="https://awp.test/api/connectors/oauth/callback" />)).toMatchSnapshot();
  });
});
