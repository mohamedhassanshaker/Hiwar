import { describe, expect, it } from "vitest";

import { checkField, extractByPattern, shown } from "@/features/engage/fields";
import { degrade, messagesOf, presentResult, quickActionChips, type ProtocolInput } from "@/features/engage/protocol";
import { advance, newConversation } from "@/features/engage/storyline";
import type { Conversation, Step, Storyline } from "@/features/engage/storyline-types";

/**
 * The embedded widget's message protocol, typed fields and engine phases (widget
 * specification sections 6, 7 and 10, D231). The server builds what the widget renders from
 * these, so they are the widget's contract.
 */

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

/** Pay a bill: the service, the account, a confirmation. */
function payBills(mode: Storyline["mode"] = "Guided"): Storyline {
  return {
    code: "pay_bills",
    versionNumber: 1,
    mode,
    steps: [
      step({
        name: "service",
        type: "Ask",
        messageEn: "Which service?",
        messageAr: "أي خدمة؟",
        slot: "service",
        nextStepName: "account",
        config: { choices: [{ value: "home", en: "Home internet", ar: "الإنترنت المنزلي" }, { value: "mobile", en: "Mobile", ar: "الهاتف" }] },
      }),
      step({
        name: "account",
        type: "Ask",
        messageEn: "Your account number?",
        messageAr: "رقم حسابك؟",
        slot: "account",
        maxAttempts: 3,
        nextStepName: "confirm",
        config: { field: { type: "text", pattern: "^[0-9.]{6,20}$", labelEn: "account", labelAr: "الحساب", example: "1.23456789" } },
      }),
      step({ name: "confirm", type: "Confirm", messageEn: "Pay {{account}} for {{service}}?", nextStepName: "done" }),
      step({ name: "done", type: "End" }),
    ],
  };
}

const at = (storyline: Storyline, state: Conversation, ...turns: Parameters<typeof advance>[2][]) =>
  turns.reduce((current, turn) => advance(storyline, current.state, turn), { state, emissions: [], effects: [] } as ReturnType<typeof advance>);

describe("typed fields (specification 6.3)", () => {
  it("checks each type and stores the value in one form", () => {
    expect(checkField({ type: "phone" }, "050 123 4567")).toEqual({ ok: true, value: "+971501234567" });
    expect(checkField({ type: "phone" }, "+44 20 7946 0958")).toEqual({ ok: true, value: "+442079460958" });
    expect(checkField({ type: "phone" }, "12").ok).toBe(false);
    expect(checkField({ type: "email" }, "name@example.com").ok).toBe(true);
    expect(checkField({ type: "amount", min: 1, max: 500 }, "AED 389")).toEqual({ ok: true, value: "389" });
    expect(checkField({ type: "amount", max: 500 }, "900").ok).toBe(false);
    expect(checkField({ type: "date", min: "2026-01-01" }, "2025-12-31").ok).toBe(false);
    expect(checkField({ type: "date" }, "2026-10-23")).toEqual({ ok: true, value: "2026-10-23" });
    expect(checkField({ type: "consent" }, "I agree")).toEqual({ ok: true, value: "agreed" });
    expect(checkField({ type: "otp" }, "12345").ok).toBe(false);
    expect(checkField({ type: "select" }, "Mobile", [{ value: "mobile", en: "Mobile", ar: "الهاتف" }])).toEqual({ ok: true, value: "mobile" });
    expect(checkField({ type: "multiselect", maxItems: 1 }, "a, b", [{ value: "a", en: "a", ar: "a" }, { value: "b", en: "b", ar: "b" }]).ok).toBe(false);
  });

  it("says what is wrong and gives an example of a valid value (specification 10.2)", () => {
    const refused = checkField({ type: "text", pattern: "^784-?[0-9]{4}-?[0-9]{7}-?[0-9]$", example: "784-1990-1234567-1" }, "12345");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? "" : refused.en).toContain("784-1990-1234567-1");
  });

  it("masks a value it is told to, keeping its last two characters", () => {
    expect(shown({ type: "text", mask: true }, "1.23456789")).toBe("••••••••89");
    expect(shown({ type: "text" }, "visible")).toBe("visible");
  });

  it("finds a later field's value in free text by its pattern", () => {
    expect(extractByPattern("my home internet, account 1.23456789 please", [{ slot: "account", spec: { type: "text", pattern: "^[0-9.]{6,20}$" } }])).toEqual({
      account: "1.23456789",
    });
  });
});

describe("the engine's phases (specification 7 and 10)", () => {
  it("Guided takes several values in one message, echoes them, and asks only for what is missing", () => {
    const storyline = payBills("Guided");
    const result = at(storyline, newConversation(), { kind: "Open" }, { kind: "Reply", text: "home" });
    // The account was not in this message, so it is asked for.
    expect(result.state.stepName).toBe("account");

    const both = at(storyline, newConversation(), { kind: "Open" });
    const service = advance(storyline, both.state, { kind: "Reply", text: "Home internet" });
    expect(service.state.stepName).toBe("account");
    const fresh = at(storyline, newConversation(), { kind: "Open" });
    // A reply to the first step that also carries the account skips the account step.
    const extracted = advance(storyline, fresh.state, { kind: "Reply", text: "Home internet" });
    expect(extracted.state.awaiting).toBe("Reply");
  });

  it("Guided skips a step whose value an earlier reply already gave, after echoing it", () => {
    const storyline: Storyline = {
      ...payBills("Guided"),
      steps: [
        step({ name: "account_first", type: "Ask", messageEn: "Tell me about your bill.", slot: "note", nextStepName: "account" }),
        ...payBills("Guided").steps.slice(1),
      ],
    };
    const opened = at(storyline, newConversation(), { kind: "Open" });
    const replied = advance(storyline, opened.state, { kind: "Reply", text: "home internet, account 1.23456789" });
    expect(replied.emissions[0]).toMatchObject({ kind: "Message", en: "Got it: account 1.23456789." });
    expect(replied.state.slots.account).toBe("1.23456789");
    expect(replied.state.awaiting).toBe("Confirmation");
  });

  it("Strict takes the current value alone and asks every step in order", () => {
    const storyline: Storyline = {
      ...payBills("Strict"),
      steps: [
        step({ name: "account_first", type: "Ask", messageEn: "Tell me about your bill.", slot: "note", nextStepName: "account" }),
        ...payBills("Strict").steps.slice(1),
      ],
    };
    const opened = at(storyline, newConversation(), { kind: "Open" });
    const replied = advance(storyline, opened.state, { kind: "Reply", text: "home internet, account 1.23456789" });
    expect(replied.state.stepName).toBe("account");
    expect(replied.state.slots.account).toBeUndefined();
  });

  it("a typed field refuses a bad value with its reason, and gives up after its attempts", () => {
    const storyline = payBills("Strict");
    const asked = at(storyline, newConversation(), { kind: "Open" }, { kind: "Reply", text: "home" });
    const wrong = advance(storyline, asked.state, { kind: "Reply", text: "abc" });
    expect(wrong.state.stepName).toBe("account");
    expect(wrong.emissions[0]).toMatchObject({ kind: "Message" });
    expect((wrong.emissions[0] as { en: string }).en).toContain("1.23456789");
    const twice = advance(storyline, wrong.state, { kind: "Reply", text: "abc" });
    const thrice = advance(storyline, twice.state, { kind: "Reply", text: "abc" });
    expect(thrice.state.outcome).toBe("HandedOff");
  });

  it("the summary's Edit goes back to the step that collected the value; Cancel ends without submitting", () => {
    const storyline = payBills("Strict");
    const confirming = at(storyline, newConversation(), { kind: "Open" }, { kind: "Reply", text: "home" }, { kind: "Reply", text: "1.23456789" });
    expect(confirming.state.awaiting).toBe("Confirmation");

    const edited = advance(storyline, confirming.state, { kind: "EditField", field: "account" });
    expect(edited.state.stepName).toBe("account");
    expect(edited.state.slots.account).toBeUndefined();

    const cancelled = advance(storyline, confirming.state, { kind: "Cancel" });
    expect(cancelled.state.outcome).toBe("Cancelled");
    expect(cancelled.effects).toEqual([]);
  });

  it("a step's own phase mode overrides the storyline's: Guided has the agent answer side questions", () => {
    const storyline: Storyline = {
      ...payBills("Strict"),
      steps: payBills("Strict").steps.map((one) => (one.name === "service" ? { ...one, config: { ...one.config, mode: "Guided" as const } } : one)),
    };
    const opened = at(storyline, newConversation(), { kind: "Open" });
    const side = advance(storyline, opened.state, { kind: "Reply", text: "what does it cost?" });
    expect(side.effects).toEqual([{ kind: "SideAnswer", step: "service", text: "what does it cost?" }]);
    expect(side.emissions).toEqual([]);
  });
});

describe("the message protocol (specification 6)", () => {
  const storyline = payBills("Strict");
  const base = (over: Partial<ProtocolInput>): ProtocolInput => ({
    lines: [],
    state: newConversation(),
    storyline,
    slots: {},
    quickActions: [],
    page: null,
    lang: "en",
    pending: false,
    handoff: null,
    otpTarget: null,
    ended: false,
    handoffAvailable: true,
    agentPaused: false,
    ...over,
  });

  it("puts the quick actions under the greeting, the page's own first", () => {
    const quickActions = [
      { id: "flights", labelEn: "Flight Arrivals Today", labelAr: "الرحلات القادمة اليوم", storyline: "flights", pages: ["*"] },
      { id: "customs", labelEn: "Sharjah Custom Services", labelAr: "خدمات جمارك الشارقة", storyline: "customs", pages: ["customs"] },
    ];
    expect(quickActionChips(quickActions, "customs", "en").map((chip) => chip.id)).toEqual(["customs", "flights"]);
    expect(quickActionChips(quickActions, null, "en").map((chip) => chip.id)).toEqual(["flights"]);

    const [greeting] = messagesOf(
      base({
        storyline: null,
        quickActions,
        lines: [{ role: "Agent", kind: "Message", textEn: "Hello!", textAr: "مرحباً!", payload: { welcome: true }, seq: 0 }],
        lang: "ar",
      }),
    );
    expect(greeting.blocks[0]).toEqual({ type: "text", text: "مرحباً!" });
    expect(greeting.blocks[1]).toMatchObject({ type: "chips", persist: true, items: [{ label: "الرحلات القادمة اليوم", action: { type: "start_scenario", scenario: "flights" } }] });
  });

  it("tells the composer to show the field's own control, with the step it belongs to", () => {
    const confirming = at(storyline, newConversation(), { kind: "Open" }, { kind: "Reply", text: "home" });
    const messages = messagesOf(
      base({
        state: confirming.state,
        lines: [
          { role: "Agent", kind: "Message", textEn: "Your account number?", textAr: "رقم حسابك؟", payload: {}, seq: 1 },
        ],
      }),
    );
    const last = messages.at(-1)!;
    expect(last.input).toMatchObject({ mode: "field", field: { id: "account", type: "text", pattern: "^[0-9.]{6,20}$", allowFreeText: false } });
    expect(last.flow).toMatchObject({ scenario: "pay_bills", mode: "strict", step: "account", progress: { current: 2, total: 4 } });
    expect(last.blocks.some((block) => block.type === "progress")).toBe(false);
  });

  it("draws a confirmation as a summary of the values, each editable by its step", () => {
    const confirming = at(storyline, newConversation(), { kind: "Open" }, { kind: "Reply", text: "home" }, { kind: "Reply", text: "1.23456789" });
    const [message] = messagesOf(
      base({
        state: confirming.state,
        slots: confirming.state.slots,
        lines: [{ role: "Agent", kind: "Confirm", textEn: "Pay 1.23456789 for home?", textAr: null, payload: {}, seq: 3 }],
      }),
    );
    const summary = message.blocks.find((block) => block.type === "summary");
    expect(summary).toMatchObject({
      rows: [
        { field: "account", label: "account", value: "1.23456789", editable: true },
        { field: "service", label: "service", value: "home", editable: true },
      ],
      actions: [{ action: { type: "confirm", step: "confirm" } }, { action: { type: "cancel" } }],
    });
  });

  it("keeps the one-time code out of the transcript and the read-aloud text", () => {
    const messages = messagesOf(
      base({
        lines: [
          { role: "System", kind: "OtpPrompt", textEn: null, textAr: null, payload: { method: "Otp" }, seq: 1 },
          { role: "Visitor", kind: "Otp", textEn: null, textAr: null, payload: {}, seq: 2 },
        ],
        otpTarget: "••••••42",
      }),
    );
    expect(messages[1]).toMatchObject({ role: "user", blocks: [{ type: "text", text: "••••••" }], speakable: "" });
  });

  it("locks the composer once the conversation has ended, and offers a new one", () => {
    const [ended] = messagesOf(
      base({ ended: true, lines: [{ role: "System", kind: "Ended", textEn: null, textAr: null, payload: { outcome: "Completed" }, seq: 4 }] }),
    );
    expect(ended.input).toMatchObject({ mode: "locked" });
    expect(ended.blocks[0]).toMatchObject({ type: "notice", actions: [{ action: { type: "restart" } }] });
  });

  it("D342 while a person has taken over, the script offers no controls and the composer is free text", () => {
    const lines = [
      { role: "Agent", kind: "Message", textEn: "Your account number?", textAr: null, payload: {}, seq: 1 },
      { role: "HumanAgent", kind: "Message", textEn: "Hello, I am here.", textAr: null, payload: {}, seq: 2 },
    ];
    const state = { ...newConversation(), stepName: "account", awaiting: "Reply" as const, trail: ["service", "account"] };
    const last = messagesOf(base({ storyline: payBills(), lines, state, agentPaused: true })).filter((message) => message.role === "assistant").at(-1)!;
    expect(last.input).toEqual({ mode: "free" });
    expect(last.blocks.some((block) => block.type === "chips")).toBe(false);
    const scripted = messagesOf(base({ storyline: payBills(), lines, state })).find((message) => message.input);
    expect(scripted?.input).toMatchObject({ mode: "field" });
  });

  it("D340 offers a person only when the deployment has a handoff queue", () => {
    const lines = [{ role: "System", kind: "HandoffOffer", textEn: null, textAr: null, payload: {}, seq: 1 }];
    const handoff = (available: boolean) =>
      messagesOf(base({ lines, handoffAvailable: available })).flatMap((message) => message.blocks).filter((block) => block.type === "chips");
    expect(handoff(true)).toEqual([{ type: "chips", items: [{ id: "handoff", label: "Talk to a person", action: { type: "handoff", reason: "off_script", step: null } }] }]);
    expect(handoff(false)).toEqual([]);
  });

  it("D339 offers the step's choices again under the agent's answer, with Back and Main menu", () => {
    const lines = [
      { role: "Agent", kind: "Message", textEn: "Which service?", textAr: null, payload: {}, seq: 1 },
      { role: "Agent", kind: "QuickReplies", textEn: null, textAr: null, payload: { choices: payBills().steps[0].config.choices }, seq: 2 },
      { role: "Visitor", kind: "Message", textEn: "How much is it?", textAr: null, payload: {}, seq: 3 },
      { role: "Agent", kind: "Message", textEn: "It is free.", textAr: null, payload: {}, seq: 4 },
    ];
    const atFirst = messagesOf(base({ storyline: payBills(), lines, state: { ...newConversation(), stepName: "service", awaiting: "Reply", trail: ["service"] } }));
    const chips = atFirst.at(-1)!.blocks.filter((block) => block.type === "chips");
    // The first question has nowhere to go back to.
    expect(chips).toEqual([
      {
        type: "chips",
        items: [
          { id: "home", label: "Home internet", action: { type: "postback", payload: { text: "home" }, step: "service" } },
          { id: "mobile", label: "Mobile", action: { type: "postback", payload: { text: "mobile" }, step: "service" } },
        ],
      },
    ]);

    const later = messagesOf(base({ storyline: payBills(), lines, state: { ...newConversation(), stepName: "account", awaiting: "Reply", trail: ["service", "account"] } }));
    expect(later.at(-1)!.blocks.at(-1)).toEqual({
      type: "chips",
      items: [
        { id: "back", label: "Back", action: { type: "back", step: "account" } },
        { id: "main_menu", label: "Main menu", action: { type: "main_menu", step: "account" } },
      ],
    });
  });

  it("shows a tool's rows as a list whose tap answers with the row's id", () => {
    const [list] = presentResult({ as: "list", rowsAt: "flights", id: "number", title: "number", subtitle: "origin", badge: "status" }, { flights: [{ number: "G9123", origin: "Cairo", status: "Delayed" }] }, "pick");
    expect(list).toEqual({
      type: "list",
      selectable: "single",
      total: 1,
      items: [{ id: "G9123", title: "G9123", subtitle: "Cairo", meta: undefined, badge: "Delayed", action: { type: "postback", payload: { text: "G9123" }, step: "pick" } }],
    });
  });

  it("degrades blocks to numbered text for a surface that draws no controls (specification 13.4)", () => {
    expect(
      degrade(
        [
          { type: "text", text: "Which service?" },
          { type: "chips", items: [{ id: "a", label: "Home internet", action: { type: "postback", payload: { text: "home" } } }, { id: "b", label: "Mobile", action: { type: "postback", payload: { text: "mobile" } } }] },
        ],
        "en",
      ),
    ).toBe("Which service?\n\n1. Home internet\n2. Mobile");
  });
});
