// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({ value: {} as unknown, asked: [] as unknown[] }));
vi.mock("@/features/files/actions", () => ({
  loadPreview: async (input: unknown) => {
    answer.asked.push(input);
    return { ok: true, value: answer.value };
  },
  deleteItem: async () => ({ ok: true, value: undefined }),
  setFileStatus: async () => ({ ok: true, value: undefined }),
  setScopeOfUse: async () => ({ ok: true, value: undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/discussion-rooms/SES-1016",
  useSearchParams: () => new URLSearchParams(),
}));

import { PreviewModal } from "@/features/files/components/preview-modal";
import type { Person } from "@/types/directory";
import { byText, cleanup, mount, withProviders } from "./dom";

/**
 * `UC-32.1-02`, `UC-32.1-06`: the preview draws what the server says it can, whatever the
 * screen that opened it knew of the type, and a room opens it to read, not to manage.
 */
const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };
const item = { n: "E2E features.xlsx", w: "p1", p: "GEN", l: "SES-1016", s: "—" };

afterEach(async () => {
  answer.asked.length = 0;
  await cleanup();
});

describe("the preview", () => {
  it("draws a spreadsheet the parser read as a table, with no type given by the opener", async () => {
    answer.value = { mode: "text", text: "| Feature | Description |\n| --- | --- |\n| Requests | Raise and route work |" };
    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={item} />, directory));
    expect(answer.asked).toEqual([{ name: "E2E features.xlsx", kind: "artifact" }]);
    const cells = [...document.querySelectorAll("td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["Requests", "Raise and route work"]);
    expect(document.body.textContent).not.toContain("This format cannot be previewed");
  });

  it("frames a type the browser draws, and says why when nothing can be drawn", async () => {
    answer.value = { mode: "inline" };
    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={{ ...item, n: "policy.pdf" }} />, directory));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("/api/files?name=policy.pdf&kind=artifact");
    await cleanup();

    answer.value = { mode: "none", reason: "The assistant could not read that file." };
    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={item} />, directory));
    expect(document.body.textContent).toContain("This format cannot be previewed.");
    expect(document.body.textContent).toContain("The assistant could not read that file.");
  });

  it("opened from a room to read, offers Download only and no details", async () => {
    answer.value = { mode: "inline" };
    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={item} viewOnly />, directory));
    const buttons = [...document.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).toContain("Download");
    expect(buttons).not.toContain("Delete");
    expect(buttons).not.toContain("Deactivate");
    expect(document.querySelector("dl.awp-kv")).toBeNull();
    await cleanup();

    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={item} />, directory));
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toContain("Delete");
    expect(document.querySelector("dl.awp-kv")).not.toBeNull();
  });

  it("offers the scope of use to change only to the file's uploader, as the server allows (UC-33.1-07)", async () => {
    answer.value = { mode: "inline" };
    const writer = { ...directory, may: ["files:write" as const] };
    const file = { ...item, n: "policy.pdf", kind: "file" as const, scope: "AllProject", grantIds: [] };
    const scopeButton = () => byText(document, "button", "Only me");
    const readOnlyScope = () => byText(document, "dt", "Scope of use");

    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={{ ...file, w: "p2" }} />, writer));
    expect(scopeButton()).toBeUndefined();
    expect(readOnlyScope()).toBeDefined();
    expect(document.body.textContent).toContain("All project members & agents");
    await cleanup();

    await mount(withProviders(<PreviewModal onClose={() => undefined} go={() => undefined} item={{ ...file, w: "p1" }} />, writer));
    expect(scopeButton()).toBeDefined();
    expect(readOnlyScope()).toBeUndefined();
  });
});
