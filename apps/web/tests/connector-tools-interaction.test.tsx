// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { action: string; input: unknown }[] = [];
// The tab's server actions, recorded rather than run: what is under test is which one a
// click sends, with what.
vi.mock("@/features/agents/actions", () =>
  Object.fromEntries(
    ["changeToolGrant", "revokeTool", "setPlatformTool", "setToolMode"].map((action) => [
      action,
      async (input: unknown) => {
        calls.push({ action, input });
        return { ok: true };
      },
    ]),
  ),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
}));

import { ConnectorTools } from "@/features/agents/components/connector-tools";
import type { AgentDetail } from "@/features/agents/types";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const person = { id: "p1", ini: "QA", photo: null, name: "", nameAr: "", role: "", roleAr: "", email: "" };
const directory = { me: person, agents: [], people: [], projects: [], may: [] };

const configuration = {
  catalogue: [
    { name: "work_item_read", tier: "T0", harness: false },
    { name: "work_item_delete", tier: "T2", harness: false },
    { name: "write_handoff", tier: null, harness: true },
  ],
  granted: ["work_item_read", "write_handoff"],
  connectorTools: ["stocks/quotes", "stocks/history"],
  skills: [{ id: "s1", name: "claims-triage", declaredTools: ["work_item_read", "erp/claims.write"] }],
};

const detail = {
  tools: [
    { id: "11111111-1111-4111-8111-111111111111", ref: "stocks/quotes", tier: "T0", mode: "Auto" },
    { id: "22222222-2222-4222-8222-222222222222", ref: "stocks/history", tier: "T0", mode: "Auto" },
  ],
  toolShelf: [{ id: "33333333-3333-4333-8333-333333333333", ref: "stocks/news", tier: "T0" }],
} as unknown as AgentDetail;

afterEach(async () => {
  calls.length = 0;
  await cleanup();
});

describe("S-51 connector tools (D228)", () => {
  it("shows one record per connector, the Platform connector first, until one is opened", async () => {
    const { container } = await mount(
      withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory),
    );
    const records = [...container.querySelectorAll("button[data-connector]")].map((record) => record.textContent);
    expect(records).toHaveLength(2);
    expect(records[0]).toContain("Platform");
    expect(records[1]).toContain("stocks");
    expect(records[1]).toContain("2 tools");
    // Closed records list no tool.
    expect(container.textContent).not.toContain("history");
  });

  it("opens a connector onto its tools, and the remove icon takes one away", async () => {
    const { container } = await mount(
      withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory),
    );
    await click(container.querySelector('button[data-connector="stocks"]'));
    expect(container.textContent).toContain("history");
    await click(container.querySelector('button[aria-label="Remove history"]'));
    expect(calls).toEqual([
      { action: "revokeTool", input: { code: "ss", connectorToolId: "22222222-2222-4222-8222-222222222222" } },
    ]);
  });

  it("takes a Platform tool away through the platform grant", async () => {
    const { container } = await mount(
      withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory),
    );
    await click(container.querySelector('button[data-connector="platform"]'));
    await click(container.querySelector('button[aria-label="Remove work_item_read"]'));
    expect(calls).toEqual([{ action: "setPlatformTool", input: { code: "ss", tool: "work_item_read", enabled: false } }]);
  });

  it("D238 Add or remove tools: ticking a connector takes all its tools, and unticking a held one removes it", async () => {
    await mount(withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory));
    await click(byText(document.body, "button", "Add or remove tools"));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    // Collapsed: the connector reads as a count until it is opened.
    expect(dialog.textContent).toContain("2 of 3 tools");
    expect(dialog.textContent).not.toContain("news");

    await click(dialog.querySelector('input[aria-label="stocks"]'));
    expect(dialog.textContent).toContain("3 of 3 tools");
    await click(dialog.querySelector('button[aria-label="Choose stocks tools"]'));
    const history = [...dialog.querySelectorAll("label")].find((label) => label.textContent?.includes("history"));
    await click(history?.querySelector("input"));
    await click(byText(dialog, "button", "Save"));
    expect(calls).toEqual([
      {
        action: "changeToolGrant",
        input: {
          code: "ss",
          grantPlatform: [],
          revokePlatform: [],
          grantTools: ["33333333-3333-4333-8333-333333333333"],
          revokeTools: ["22222222-2222-4222-8222-222222222222"],
        },
      },
    ]);
  });

  it("D238 asks before an approval-class Platform tool is granted", async () => {
    await mount(withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory));
    await click(byText(document.body, "button", "Add or remove tools"));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    await click(dialog.querySelector('button[aria-label="Choose Platform tools"]'));
    const remove = [...dialog.querySelectorAll("label")].find((label) => label.textContent?.includes("work_item_delete"));
    await click(remove?.querySelector("input"));
    await click(byText(dialog, "button", "Save"));
    expect(calls).toEqual([]);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("work_item_delete delete, publish or apply something");
    await click(byText(dialog, "button", "Grant them and save"));
    expect(calls).toEqual([
      { action: "changeToolGrant", input: { code: "ss", grantPlatform: ["work_item_delete"], revokePlatform: [], grantTools: [], revokeTools: [] } },
    ]);
  });

  it("warns that a skill declares a tool the grant does not reach", async () => {
    const { container } = await mount(
      withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable />, directory),
    );
    expect(container.textContent).toContain("claims-triage declares erp/claims.write");
  });

  it("offers no change to somebody who may only read the grant", async () => {
    const { container } = await mount(
      withProviders(<ConnectorTools code="ss" detail={detail} configuration={configuration} editable={false} />, directory),
    );
    await click(container.querySelector('button[data-connector="stocks"]'));
    expect(container.querySelector('button[aria-label^="Remove"]')).toBeNull();
    expect(byText(container, "button", "Add or remove tools")).toBeUndefined();
    expect(byText(container, "p", "You may see this grant but not change it.")).toBeDefined();
  });
});
