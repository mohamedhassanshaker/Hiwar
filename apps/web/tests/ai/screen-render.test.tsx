import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A screen calls its server actions over the network once a person acts; first render calls
// none, so each is a stub that would refuse if it ever were called.
vi.mock("@/features/models/actions", () =>
  Object.fromEntries(
    [
      "addCloudProvider",
      "addCustomProvider",
      "discoverModels",
      "removeConnection",
      "removeProvider",
      "removeRoute",
      "saveConnection",
      "saveRoute",
      "setProviderActive",
      "testConnection",
      "testConnectionDraft",
    ].map((name) => [name, async () => ({ ok: false, reason: `${name} is not called on first render` })]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ToastProvider } from "@/components/shared/toast";
import { Models } from "@/features/models/components/models";
import type { ModelRoute, Provider } from "@/features/models/types";
import { PreferencesProvider } from "@/lib/preferences";

/**
 * What each console screen draws on first render, held as a snapshot.
 *
 * A screen is rendered with fixed props through `react-dom/server`, so the snapshot is the
 * markup a person sees before touching anything. It fails when a change alters that markup:
 * a moved component that lost a prop, a label that changed, a branch that now renders
 * differently.
 */
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

describe("S-59 and S-60 models and routes", () => {
  const providers: Provider[] = [
    {
      id: "prov-1",
      n: "Azure OpenAI",
      ini: "A",
      c: "var(--chart-1)",
      kind: "Cloud",
      on: true,
      models: ["gpt-4o"],
      conns: [
        {
          id: "conn-1",
          n: "Primary",
          ep: "https://example.test",
          auth: "ApiKey",
          region: "uaenorth",
          on: true,
          allow: ["gpt-4o", "gpt-4o-mini"],
          realtime: [],
          kinds: {},
          windows: {},
          st: "Failed",
          checkedAt: "2026-10-20T08:00:00.000Z",
          lastTest: [
            { model: "gpt-4o", ok: true, detail: "120 ms", ms: 120 },
            { model: "gpt-4o-mini", ok: false, detail: "Authentication failed (401).", ms: 80 },
          ],
        },
      ],
    },
    { id: "prov-2", n: "Local vLLM", ini: "L", c: "var(--chart-2)", kind: "Custom", engine: "vLLM", on: false, models: [], conns: [] },
  ];
  const routes: ModelRoute[] = [
    { a: "reasoning-default", use: ["Reasoning", "الاستدلال"], kind: "Standard", chain: [["prov-1", "conn-1", "gpt-4o"]], agents: 3 },
  ];

  it("draws the provider cards for somebody who may change them", () => {
    expect(renderScreen(<Models providers={providers} routes={routes} />, ["models:write"])).toMatchSnapshot();
  });

  it("draws them read-only without models:write", () => {
    expect(renderScreen(<Models providers={providers} routes={routes} />)).toMatchSnapshot();
  });
});
