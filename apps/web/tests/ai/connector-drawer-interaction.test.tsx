// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/connectors",
}));

const sent = vi.hoisted(() => ({ saved: [] as Record<string, unknown>[], imported: [] as Record<string, unknown>[], connected: [] as string[] }));
vi.mock("@/features/connectors/actions", () => ({
  saveConnector: async (input: Record<string, unknown>) => {
    sent.saved.push(input);
    return { ok: true, value: { code: input.code } };
  },
  importApiConnector: async (input: Record<string, unknown>) => {
    sent.imported.push(input);
    return { ok: true, value: { code: input.code, title: "Ledger", serverUrl: "", tools: 2, skipped: [], awaitsCredential: false } };
  },
  connectOAuth: async (input: { connectorCode: string }) => {
    sent.connected.push(input.connectorCode);
    return { ok: false, reason: "The authorization server did not answer.", reasonAr: "لم يستجب خادم التفويض." };
  },
  testConnector: async () => ({ ok: false, message: "not called", messageAr: "not called" }),
  testApiConnector: async () => ({ ok: true, httpStatus: 200, tools: [] }),
  refreshConnectorTools: async () => ({ ok: true, added: [], removed: [] }),
  removeConnector: async () => ({ ok: true, affectedAgents: [] }),
}));

import { ConnectorDrawer } from "@/features/connectors/components/connector-drawer";
import type { Connector } from "@/features/connectors/types";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

const api: Connector = {
  n: "open-meteo",
  name: "Open-Meteo Weather API",
  nameAr: "Open-Meteo Weather API",
  d: "",
  dAr: "",
  kind: "REST API (OpenAPI)",
  transport: "OpenApi",
  url: "https://api.open-meteo.com",
  command: "",
  auth: "ApiKey",
  credential: { type: "ApiKey", in: "query", name: "apikey", hasSecret: true },
  st: "Connected",
  on: true,
  def: "T0",
  tools: [{ name: "forecast", tier: "T0", available: true }],
  catalogueId: null,
  version: 3,
  builtin: false,
};

const blank: Connector = { ...api, n: "", name: "", nameAr: "", transport: "StreamableHttp", url: "https://", auth: "None", credential: { type: "None" }, tools: [], on: false };

const opened = (c: Connector, isNew = false) =>
  withProviders(
    <ConnectorDrawer c={c} isNew={isNew} readOnly={false} onDone={() => undefined} onClose={() => undefined} oauthCallbackUrl="https://awp.test/api/connectors/oauth/callback" />,
    { me, agents: [], people: [me], projects: [], may: ["connectors:write"] },
  );

const drawer = (c: Connector, isNew = false) => mount(opened(c, isNew));

/** Chooses an option of the select with this label. */
async function pick(label: string, option: string) {
  await click(document.querySelector(`button[aria-label="${label}"]`));
  await click(byText(document.body, '[role="option"]', option));
}

async function type(label: string, text: string) {
  const field = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  await cleanup();
  sent.saved.length = 0;
  sent.imported.length = 0;
  sent.connected.length = 0;
});

describe("D283 D296 a REST API connector's drawer", () => {
  it("asks for no transport, keeps the stored key when left empty, and saves it as a REST API", async () => {
    await drawer(api);
    expect(document.querySelector('button[aria-label="Transport"]')).toBeNull();
    expect(document.body.textContent).toContain("Stored. Leave empty to keep it.");

    await click(byText(document.body, "button", "Save changes"));
    expect(sent.saved).toHaveLength(1);
    expect(sent.saved[0]).toMatchObject({ transport: "OpenApi", authType: "ApiKey", credential: { type: "ApiKey", in: "query", name: "apikey" } });
    expect((sent.saved[0].credential as { value?: string }).value).toBeUndefined();
  });

  it("should_save_at_the_version_the_page_holds_now_when_a_handshake_moved_it_while_the_drawer_was_open", async () => {
    const { rerender } = await drawer(api);
    // A failed Refresh tools records status Error, and the version trigger moves the row on.
    await rerender(opened({ ...api, st: "Error", version: 4 }));

    await click(byText(document.body, "button", "Save changes"));
    expect(sent.saved).toHaveLength(1);
    expect(sent.saved[0]).toMatchObject({ version: 4 });
  });
});

describe("D228 adding a connector coded like the built-in one", () => {
  it("stays the form when the typed code is platform, so Add can answer the refusal", async () => {
    await drawer(blank, true);
    await type("Code", "platform");
    expect(document.querySelector('input[aria-label="Code"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Server URL"]')).not.toBeNull();
    await type("Server URL", "https://mcp.example.test/mcp");
    await click(byText(document.body, "button", "Add connector"));
    expect(sent.saved).toHaveLength(1);
    expect(sent.saved[0]).toMatchObject({ code: "platform" });
  });
});

describe("D296 adding a connector", () => {
  it("asks which kind first: a REST API is registered from its document, with typed credentials", async () => {
    await drawer(blank, true);
    expect(document.querySelector('button[aria-label="Transport"]')).not.toBeNull();

    await pick("Type", "REST API (OpenAPI)");
    expect(document.querySelector('button[aria-label="Transport"]')).toBeNull();
    // No document yet, so nothing to register.
    expect((byText(document.body, "button", "Add connector") as HTMLButtonElement).disabled).toBe(true);

    await type("Code", "ledger");
    const file = document.querySelector('input[aria-label="OpenAPI or Swagger file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(file, "files", { value: [new File(['{"openapi":"3.0.3"}'], "ledger.json")] });
      file.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await pick("Authentication", "OAuth 2 client credentials");
    await type("Token URL", "https://auth.ledger.test/token");
    await type("Client ID", "platform");
    await type("Client secret", "c-secret");

    await click(byText(document.body, "button", "Add connector"));
    expect(sent.saved).toEqual([]);
    expect(sent.imported).toHaveLength(1);
    expect(sent.imported[0]).toMatchObject({
      code: "ledger",
      document: '{"openapi":"3.0.3"}',
      authType: "ClientCredentials",
      credential: { type: "ClientCredentials", tokenUrl: "https://auth.ledger.test/token", clientId: "platform", clientSecret: "c-secret" },
    });
  });

  it("offers OAuth sign-in to an MCP server, which is connected once saved", async () => {
    const saved: Connector = {
      ...api,
      n: "jira",
      transport: "StreamableHttp",
      url: "https://mcp.jira.test/mcp",
      auth: "OAuth",
      credential: { type: "OAuth", hasSecret: false, connected: false },
    };
    await drawer(saved);
    expect(document.body.textContent).toContain("Not connected");
    expect(document.body.textContent).toContain("https://awp.test/api/connectors/oauth/callback");

    await click(byText(document.body, "button", "Connect"));
    expect(sent.connected).toEqual(["jira"]);
    expect(document.body.textContent).toContain("The authorization server did not answer.");
  });
});
