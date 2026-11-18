// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// `createProject` records what it was sent; the org units are listed for the picker.
const calls = vi.hoisted(() => ({ createProject: [] as unknown[] }));
vi.mock("@/features/projects/actions", () => ({
  createProject: async (input: unknown) => {
    calls.createProject.push(input);
    return { ok: true };
  },
}));
vi.mock("@/features/organisation/actions", () => ({ listOrgUnitChoices: async () => [{ nameEn: "Finance" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));

import { NewProjectModal } from "@/features/projects/components/create-modals";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: ["projects:write" as const] };

/** Types `value` into a text field the way a person does, so React sees the change. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(cleanup);

describe("the New Project dialog", () => {
  it("UC-20.2-01 sends the description typed with the project it creates", async () => {
    await mount(withProviders(<NewProjectModal onClose={() => undefined} go={() => undefined} />, directory));
    const dialog = document.body;

    await type(dialog.querySelector("input.awp-input") as HTMLInputElement, "Customer Onboarding");
    await type(dialog.querySelector("textarea") as HTMLTextAreaElement, "Bringing new customers on board.");
    await click(byText(dialog, "button", "Create project"));

    expect(calls.createProject).toHaveLength(1);
    expect(calls.createProject[0]).toMatchObject({
      nameEn: "Customer Onboarding",
      descriptionEn: "Bringing new customers on board.",
      descriptionAr: "Bringing new customers on board.",
    });
  });
});
