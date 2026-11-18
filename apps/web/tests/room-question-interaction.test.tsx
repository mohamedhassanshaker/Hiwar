// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// The answer the server records: the same action the Inbox and the assistant panel use.
const answers = vi.hoisted(() => ({ sent: [] as unknown[], outcome: { ok: true, runResumed: true } as object }));
vi.mock("@/features/inbox/actions", () => ({
  answerAsked: async (input: unknown) => {
    answers.sent.push(input);
    return answers.outcome;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/discussion-rooms/SES-1",
  useSearchParams: () => new URLSearchParams(),
}));

import { QuestionCard } from "@/features/rooms/components/question-card";
import type { RoomQuestion } from "@/features/rooms/types";
import type { Person } from "@/types/directory";
import { byText, cleanup, click, mount, withProviders } from "./dom";

const me: Person = { id: "p1", ini: "QA", photo: null, name: "Quality Analyst", nameAr: "محلل الجودة", role: "", roleAr: "", email: "qa@example.test" };
const directory = { me, agents: [], people: [me], projects: [], may: [] };

const question = (change: Partial<RoomQuestion> = {}): RoomQuestion => ({
  id: "00000000-0000-4000-8000-000000000001",
  question: "Which template should the Excel file follow?",
  options: [],
  answer: null,
  answeredBy: null,
  askedTo: "Quality Analyst",
  mayAnswer: true,
  ...change,
});

afterEach(async () => {
  await cleanup();
  answers.sent = [];
  answers.outcome = { ok: true, runResumed: true };
});

describe("UC-12.2-01 an agent question answered in its room", () => {
  it("should_answer_with_a_chosen_option_through_the_same_action_as_the_inbox", async () => {
    const { container } = await mount(withProviders(<QuestionCard question={question({ options: ["Tahseel", "Blank"] })} />, directory));
    expect(container.textContent).toContain("Which template should the Excel file follow?");

    await click(byText(container, "button", "Tahseel"));

    expect(answers.sent).toEqual([{ questionId: "00000000-0000-4000-8000-000000000001", answer: "Tahseel" }]);
    expect(container.textContent).toContain("Answered · the run continues");
  });

  it("should_keep_send_disabled_until_an_answer_is_typed", async () => {
    const { container } = await mount(withProviders(<QuestionCard question={question()} />, directory));
    const send = byText(container, "button", "Send answer") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("should_show_the_refusal_when_someone_else_answered_first", async () => {
    answers.outcome = { ok: false, message: "Answered by Khalid Hassan", messageAr: "أجاب خالد حسن" };
    const { container } = await mount(withProviders(<QuestionCard question={question({ options: ["Yes"] })} />, directory));

    await click(byText(container, "button", "Yes"));

    expect(container.querySelector("[role=alert]")?.textContent).toBe("Answered by Khalid Hassan");
  });

  it("should_tell_everyone_else_who_it_waits_on_and_offer_no_answer", async () => {
    const { container } = await mount(withProviders(<QuestionCard question={question({ mayAnswer: false, askedTo: "Mariam Al Suwaidi" })} />, directory));
    expect(container.textContent).toContain("Waiting for Mariam Al Suwaidi to answer");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("should_show_an_answered_question_with_its_answer", async () => {
    const { container } = await mount(withProviders(<QuestionCard question={question({ answer: "Blank", answeredBy: "Mariam Al Suwaidi", mayAnswer: false })} />, directory));
    expect(container.textContent).toContain("Mariam Al Suwaidi: Blank");
  });
});
