// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ attachFile: [] as unknown[], attachHeld: [] as unknown[], searchHeld: [] as unknown[] }));
const held = vi.hoisted(() => [
  { id: "11111111-1111-4111-8111-111111111111", kind: "File", name: "policy.pdf", project: "GEN", size: 10, mimeType: "application/pdf" },
  { id: "22222222-2222-4222-8222-222222222222", kind: "Artifact", name: "Tahseel G3 deck.pptx", project: "GEN", size: 10, mimeType: "application/pdf" },
]);
vi.mock("@/features/files/actions", () => ({
  attachFile: async (input: unknown) => {
    calls.attachFile.push(input);
    return { ok: true, value: undefined };
  },
  attachHeld: async (input: unknown) => {
    calls.attachHeld.push(input);
    return { ok: true, value: { name: "x" } };
  },
  // The server's search: the kind asked for, matching the query.
  searchHeld: async (input: { kind: string; q: string }) => {
    calls.searchHeld.push(input);
    return { ok: true, value: held.filter((item) => item.kind === input.kind && item.name.includes(input.q)) };
  },
  uploadFile: async () => ({ ok: true, value: {} }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/discussion-rooms/SES-1003",
  useSearchParams: () => new URLSearchParams(),
}));

import { act } from "react";
import { UploadFileModal } from "@/features/files/components/file-modals";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

/**
 * `UC-25.1-03`, `UC-23.1-07`: an attachment comes from this computer, or is a file or an
 * artifact the platform already holds, searched on the server and attached by its id.
 */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };

/** Lets the picker's debounced search run and land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)));

afterEach(async () => {
  calls.attachFile.length = 0;
  calls.attachHeld.length = 0;
  calls.searchHeld.length = 0;
  await cleanup();
});

describe("attaching held items", () => {
  for (const owner of [{ type: "Room", key: "SES-1003" }, { type: "Request", key: "REQ-9001" }, { type: "WorkItem", key: "TSK-1" }] as const) {
    it(`offers this computer, Files and Artifacts on a ${owner.type}, and attaches the chosen artifact by id`, async () => {
      const closed = vi.fn();
      await mount(withProviders(<UploadFileModal onClose={closed} go={() => undefined} owner={owner} />, directory));
      const attach = () => byText(document.body, "button", "Attach") as HTMLButtonElement;

      await click(byText(document.body, "button", "Artifacts"));
      await settle();
      expect(document.body.textContent).toContain("Tahseel G3 deck.pptx");
      expect(document.body.textContent).not.toContain("policy.pdf");
      expect(calls.searchHeld).toContainEqual({ kind: "Artifact", q: "" });
      expect(attach().disabled).toBe(true);

      await click(document.body.querySelector('[role="radio"]'));
      await click(attach());

      expect(calls.attachHeld).toEqual([
        { ownerType: owner.type, ownerKey: owner.key, kind: "Artifact", id: "22222222-2222-4222-8222-222222222222" },
      ]);
      expect(calls.attachFile).toEqual([]);
      expect(closed).toHaveBeenCalled();
    });
  }

  it("searches what it holds as the person types", async () => {
    await mount(withProviders(<UploadFileModal onClose={() => undefined} go={() => undefined} owner={{ type: "Request", key: "REQ-9001" }} />, directory));
    await click(byText(document.body, "button", "Files"));
    const search = document.body.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "nothing-like-this");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(calls.searchHeld).toContainEqual({ kind: "File", q: "nothing-like-this" });
    expect(document.body.textContent).toContain("No file you may read matches.");
  });

  it("starts on this computer's upload", async () => {
    await mount(withProviders(<UploadFileModal onClose={() => undefined} go={() => undefined} owner={{ type: "Room", key: "SES-1003" }} />, directory));
    expect(document.body.querySelector('input[type="file"]')).not.toBeNull();
    expect(document.body.querySelector('[role="radio"]')).toBeNull();
  });
});
