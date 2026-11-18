// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/knowledge",
  useSearchParams: () => new URLSearchParams(),
}));

import { ActionModal } from "@/components/shared/action-modal";
import { useAction } from "@/hooks/use-action";
import { orThrow, type Outcome } from "@/lib/outcome";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };

/** A Delete dialog whose server action answers `outcome`, wired the way the screens wire it. */
function DeleteDialog({ outcome }: { outcome: Outcome<void> }) {
  const [run] = useAction();
  return (
    <ActionModal
      onClose={() => undefined}
      go={() => undefined}
      def={{
        title: "Delete collection",
        desc: "Deleting removes its sources.",
        confirm: "Delete",
        onDone: () =>
          run(async () => {
            orThrow(outcome);
            return "Collection deleted.";
          }),
      }}
    />
  );
}

afterEach(cleanup);

describe("the confirm dialog", () => {
  it("D355 says Done only once the server agreed", async () => {
    await mount(withProviders(<DeleteDialog outcome={{ ok: true }} />, directory));

    await click(byText(document.body, "button", "Delete"));

    expect(byText(document.body, "b", "Done")).toBeDefined();
  });

  it("D355 keeps the dialog open with the refusal when the server refused", async () => {
    await mount(withProviders(<DeleteDialog outcome={{ ok: false, reason: "The knowledge index refused the removal (500)" }} />, directory));

    await click(byText(document.body, "button", "Delete"));

    expect(byText(document.body, "b", "Done")).toBeUndefined();
    expect(byText(document.body, "button", "Delete")).toBeDefined();
    expect(document.body.textContent).toContain("The knowledge index refused the removal (500)");
  });
});
