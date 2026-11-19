import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The panel reads the path it was opened on; the router only moves once a person acts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard",
}));

// The AG-UI client posts to the runtime route once a question is asked, and its package
// loads a stylesheet Node cannot import, so the provider is a pass-through and each agent
// is ready and never run.
vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: ({ children }: { children: ReactNode }) => children,
  useAgent: () => ({
    isReady: true,
    agent: {
      addMessage: () => undefined,
      runAgent: async () => {
        throw new Error("no agent runs on first render");
      },
    },
  }),
}));

// Called over the network once a person acts; first render calls none of them.
vi.mock("@/features/assistant/actions", () =>
  Object.fromEntries(
    ["deleteSavedChat", "listSavedChats", "readSavedChat", "saveChat"].map((name) => [
      name,
      async () => {
        throw new Error(`${name} is not called on first render`);
      },
    ]),
  ),
);

import type { PermissionCode } from "@/authz/permissions";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider, type ModalRegistry } from "@/components/shared/modal-host";
import { ToastProvider } from "@/components/shared/toast";
import { PageAssistant } from "@/features/assistant/components/page-assistant";
import { PreferencesProvider } from "@/lib/preferences";

/**
 * S-03 the page assistant on first render, held as a snapshot: the panel as it opens on the
 * dashboard, one agent with no hand-off to another (D371).
 */
const me = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };

function renderScreen(node: ReactNode, may: PermissionCode[] = []): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <DirectoryProvider value={{ me, agents: [], people: [me], projects: [], may }}>
        {/* No modal is open on first render, so none needs registering. */}
        <ModalProvider registry={{} as ModalRegistry}>
          <ToastProvider>{node}</ToastProvider>
        </ModalProvider>
      </DirectoryProvider>
    </PreferencesProvider>,
  );
}

describe("S-03 the page assistant", () => {
  it("opens on the dashboard with its suggestions, as one agent with no hand-off", () => {
    const html = renderScreen(<PageAssistant hidden={false} onClose={() => undefined} />, ["agents:invoke"]);
    expect(html).not.toMatch(/Request a change to the setup|طلب تغيير على الإعداد/);
    expect(html).toMatchSnapshot();
  });
});
