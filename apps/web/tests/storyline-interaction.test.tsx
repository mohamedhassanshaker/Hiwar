// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/embedded-deployment",
}));

const saved = vi.hoisted(() => ({ steps: [] as { name: string; messageEn: string | null }[], published: 0 }));
vi.mock("@/features/engage/actions", () => ({
  saveStorylineStep: async (input: { name: string; messageEn: string | null }) => {
    saved.steps.push({ name: input.name, messageEn: input.messageEn });
    return { ok: true };
  },
  publishStorylineDraft: async () => {
    saved.published += 1;
    return { ok: true, value: 4 };
  },
  addStorylineStep: async () => ({ ok: true }),
  deleteStorylineStep: async () => ({ ok: true }),
  setStorylineMode: async () => ({ ok: true }),
  simulateStoryline: async () => ({ ok: true }),
  requestTypeFields: async () => [],
}));

import { act } from "react";
import { Storyline, type DraftView } from "@/features/engage/components/storyline";
import type { Step } from "@/features/engage/storyline-types";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const step = (over: Partial<Step> & Pick<Step, "name" | "type">): Step => ({
  messageEn: null,
  messageAr: null,
  sendVerbatim: false,
  slot: null,
  maxAttempts: null,
  verifyMethod: null,
  handoffQueue: null,
  toolRefs: [],
  skillRefs: [],
  agentCode: null,
  nextStepName: null,
  onError: "Handoff",
  config: {},
  ...over,
});

const draft: DraftView = {
  code: "shj3",
  nameEn: "Shj3",
  nameAr: "Shj3",
  versionNumber: 2,
  mode: "Guided",
  publishedVersionNumber: 1,
  steps: [step({ name: "start", type: "Message", messageEn: "", nextStepName: "done" }), step({ name: "done", type: "End" })],
};

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const screen = () =>
  mount(
    withProviders(<Storyline draft={draft} options={{ tools: [], skills: [] }} defaultAgent="def" />, {
      me,
      agents: [],
      people: [me],
      projects: [],
      may: ["channels:write"],
    }),
  );

/** Types into the field as React sees it, one keystroke at a time. */
async function type(field: HTMLTextAreaElement, text: string) {
  for (let length = 1; length <= text.length; length += 1) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text.slice(0, length));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

const settle = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(async () => {
  await cleanup();
  saved.steps.length = 0;
  saved.published = 0;
});

describe("S-64 a step's message as it is typed", () => {
  it("is saved once typing pauses, with the last text, and says nothing when it saved", async () => {
    const { container } = await screen();
    const message = container.querySelector("textarea") as HTMLTextAreaElement;
    await type(message, "hello");
    expect(saved.steps).toEqual([]);

    await settle(700);
    expect(saved.steps).toEqual([{ name: "start", messageEn: "hello" }]);
    expect(document.body.textContent).not.toContain("Saved.");
  });

  it("is saved before the draft is published, so the published version has it", async () => {
    const { container } = await screen();
    await type(container.querySelector("textarea") as HTMLTextAreaElement, "hi");
    await click(byText(container, "button", "Publish"));
    await settle(10);
    expect(saved.steps).toEqual([{ name: "start", messageEn: "hi" }]);
    expect(saved.published).toBe(1);
  });
});
