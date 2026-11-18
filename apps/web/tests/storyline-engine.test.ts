import { describe, expect, it } from "vitest";

import { storylineStepInput } from "@/features/engage/schema";
import { advance, newConversation, render } from "@/features/engage/storyline";
import { dependentSteps, publishProblems } from "@/features/engage/storyline-publish";
import { type Conversation, type Step, type Storyline } from "@/features/engage/storyline-types";
import { inputSchemaOf } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

/**
 * S-64 and S-65: what a storyline does next.
 *
 * The widget, the designer's simulation and an inbound channel message all run this engine,
 * so these are the rules of the product rather than of one screen: the mode decides what an
 * off-script visitor gets, max attempts decides when a step gives up, and On error decides
 * where a failure goes.
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

const REASONS = [
  { value: "lost", en: "Lost", ar: "مفقودة" },
  { value: "stolen", en: "Stolen", ar: "مسروقة" },
  { value: "damaged", en: "Damaged", ar: "تالفة" },
];

/** The seeded card-replacement script, which is the one the product ships. */
function cardReplacement(mode: Storyline["mode"] = "Strict"): Storyline {
  return {
    code: "card-replacement",
    versionNumber: 3,
    mode,
    steps: [
      step({ name: "greet", type: "Message", messageEn: "Welcome.", messageAr: "مرحباً.", sendVerbatim: true, nextStepName: "verify_user" }),
      step({ name: "verify_user", type: "Verify", verifyMethod: "Otp", nextStepName: "ask_reason" }),
      step({
        name: "ask_reason",
        type: "Ask",
        messageEn: "Lost, stolen or damaged?",
        messageAr: "مفقودة أم مسروقة أم تالفة؟",
        slot: "reason",
        maxAttempts: 2,
        nextStepName: "route",
        config: { choices: REASONS },
      }),
      step({
        name: "route",
        type: "Decide",
        nextStepName: "ask_address",
        config: { branches: [{ slot: "reason", equals: "stolen", goto: "block_card" }], otherwise: "ask_address" },
      }),
      step({ name: "block_card", type: "Tool", toolRefs: ["cards/block"], agentCode: "sup", nextStepName: "ask_address", onError: "RetryOnce" }),
      step({ name: "ask_address", type: "Ask", messageEn: "Your delivery address?", messageAr: "عنوان التوصيل؟", slot: "delivery_addr", nextStepName: "confirm" }),
      step({
        name: "confirm",
        type: "Confirm",
        messageEn: "Replace card ending {{last4}} ({{reason}}), deliver to {{delivery_addr}}?",
        messageAr: "استبدال البطاقة {{last4}}؟",
        nextStepName: "create",
      }),
      step({ name: "create", type: "CreateWork", nextStepName: "done", config: { requestTypeCode: "CRD" } }),
      step({ name: "done", type: "End" }),
    ],
  };
}

/** Opens the conversation and verifies the visitor, which every later test starts from. */
function verified(storyline: Storyline): Conversation {
  const opened = advance(storyline, newConversation(), { kind: "Open" });
  const checked = advance(storyline, opened.state, { kind: "Otp", code: "123456" });
  return advance(storyline, checked.state, { kind: "Resume", ok: true, slots: { last4: "4821" } }).state;
}

describe("a visitor running the script", () => {
  it("UC-65.1-01 opening sends the verbatim greeting and stops at the first thing it needs", () => {
    const storyline = cardReplacement();
    const opened = advance(storyline, newConversation(), { kind: "Open" });

    expect(opened.emissions[0]).toEqual({ kind: "Message", en: "Welcome.", ar: "مرحباً.", verbatim: true });
    // The next step asks for the OTP, so the conversation waits rather than running on.
    expect(opened.emissions[1]).toEqual({ kind: "OtpPrompt", method: "Otp" });
    expect(opened.state.awaiting).toBe("Otp");
    expect(opened.state.stepName).toBe("verify_user");
  });

  it("UC-65.1-03 the OTP is checked by the caller, and the verified step is not asked again", () => {
    const storyline = cardReplacement();
    const opened = advance(storyline, newConversation(), { kind: "Open" });

    const checking = advance(storyline, opened.state, { kind: "Otp", code: "123456" });
    expect(checking.effects).toEqual([{ kind: "VerifyOtp", step: "verify_user", method: "Otp", code: "123456" }]);

    const after = advance(storyline, checking.state, { kind: "Resume", ok: true, slots: { last4: "4821" } });
    expect(after.emissions[0]).toEqual({ kind: "Verified", method: "Otp" });
    expect(after.state.verified).toBe(true);
    expect(after.state.awaiting).toBe("Reply");
    expect(after.emissions.at(-1)).toEqual({ kind: "QuickReplies", choices: REASONS });
  });

  it("UC-65.1-02 a quick reply fills the slot and the next step starts", () => {
    const storyline = cardReplacement();
    const after = advance(storyline, verified(storyline), { kind: "Reply", text: "damaged" });

    expect(after.state.slots.reason).toBe("damaged");
    // Damaged is not stolen, so the Decide step takes the other branch straight to the address.
    expect(after.state.stepName).toBe("ask_address");
  });

  it("UC-65.1-06 free text in the other language is understood, and nonsense is re-asked", () => {
    const storyline = cardReplacement();
    const arabic = advance(storyline, verified(storyline), { kind: "Reply", text: "مسروقة" });
    expect(arabic.state.slots.reason).toBe("stolen");
    // Stolen takes the branch that blocks the card first.
    expect(arabic.effects).toEqual([{ kind: "Tool", step: "block_card", refs: ["cards/block"], agentCode: "sup" }]);

    const nonsense = advance(storyline, verified(storyline), { kind: "Reply", text: "purple" });
    expect(nonsense.state.slots.reason).toBeUndefined();
    expect(nonsense.state.attempts.ask_reason).toBe(1);
    expect(nonsense.emissions.some((emission) => emission.kind === "QuickReplies")).toBe(true);
  });

  it("UC-65.1-06 UC-64.1-04 a step that runs out of attempts follows On error", () => {
    const storyline = cardReplacement();
    let state = verified(storyline);
    // Max attempts is two, so the second failure is the one that gives up.
    state = advance(storyline, state, { kind: "Reply", text: "purple" }).state;
    const given = advance(storyline, state, { kind: "Reply", text: "still purple" });

    expect(given.effects).toEqual([{ kind: "Handoff", step: "ask_reason", queue: null }]);
    expect(given.state.outcome).toBe("HandedOff");
  });

  it("UC-65.1-04 a confirmation runs the create-work step and returns its reference", () => {
    const storyline = cardReplacement();
    let state = advance(storyline, verified(storyline), { kind: "Reply", text: "damaged" }).state;
    state = advance(storyline, state, { kind: "Reply", text: "Villa 12, Al Barsha" }).state;

    const confirmation = storyline.steps.find((one) => one.name === "confirm");
    expect(state.stepName).toBe("confirm");
    expect(render(confirmation?.messageEn ?? null, state.slots)).toBe(
      "Replace card ending 4821 (damaged), deliver to Villa 12, Al Barsha?",
    );

    const confirmed = advance(storyline, state, { kind: "Confirm" });
    expect(confirmed.effects).toEqual([
      { kind: "CreateWork", step: "create", requestTypeCode: "CRD", slots: confirmed.state.slots },
    ]);

    const created = advance(storyline, confirmed.state, { kind: "Resume", ok: true, reference: "REQ-9100" });
    expect(created.emissions).toContainEqual({ kind: "Reference", value: "REQ-9100" });
    expect(created.state.outcome).toBe("RequestCreated");
  });

  it("a Form step shows every field at once, retries a missing required one, then raises the request", () => {
    const storyline: Storyline = {
      code: "report-issue",
      versionNumber: 1,
      mode: "Strict",
      steps: [
        step({
          name: "details",
          type: "Form",
          maxAttempts: 2,
          nextStepName: "create",
          config: {
            requestTypeCode: "ISS",
            formFields: [
              { key: "summary", labelEn: "Summary", labelAr: "ملخص", dataType: "Text", required: true },
              { key: "notes", labelEn: "Notes", labelAr: "ملاحظات", dataType: "Text", required: false },
            ],
          },
        }),
        step({ name: "create", type: "CreateWork", nextStepName: "done", config: { requestTypeCode: "ISS" } }),
        step({ name: "done", type: "End" }),
      ],
    };

    const opened = advance(storyline, newConversation(), { kind: "Open" });
    expect(opened.emissions).toContainEqual({
      kind: "FormPrompt",
      fields: storyline.steps[0].config.formFields,
    });
    expect(opened.state.awaiting).toBe("Form");

    // The required field is missing, so the form is shown again rather than let through.
    const missing = advance(storyline, opened.state, { kind: "Form", values: { notes: "no summary given" } });
    expect(missing.emissions).toContainEqual({ kind: "FormPrompt", fields: storyline.steps[0].config.formFields });
    expect(missing.state.awaiting).toBe("Form");

    const filled = advance(storyline, missing.state, { kind: "Form", values: { summary: "Broken gate", notes: "" } });
    expect(filled.effects).toEqual([{ kind: "CreateWork", step: "create", requestTypeCode: "ISS", slots: filled.state.slots }]);
    expect(filled.state.slots.summary).toBe("Broken gate");
  });

  it("UC-65.1-05 Change goes back to the step that collected the value and clears it", () => {
    const storyline = cardReplacement();
    let state = advance(storyline, verified(storyline), { kind: "Reply", text: "damaged" }).state;
    state = advance(storyline, state, { kind: "Reply", text: "Villa 12, Al Barsha" }).state;

    const changed = advance(storyline, state, { kind: "Change" });
    expect(changed.state.stepName).toBe("ask_reason");
    expect(changed.state.slots.reason).toBeUndefined();
    // The address it already has is kept, so the visitor is not asked for everything again.
    expect(changed.state.slots.delivery_addr).toBe("Villa 12, Al Barsha");
  });

  it("UC-65.1-08 Talk to a person ends the conversation in the handoff queue", () => {
    const storyline = cardReplacement();
    const handed = advance(storyline, verified(storyline), { kind: "TalkToPerson" });

    expect(handed.effects[0].kind).toBe("Handoff");
    expect(handed.state.outcome).toBe("HandedOff");
    expect(handed.emissions.at(-1)).toEqual({ kind: "Ended", outcome: "HandedOff" });
  });

  it("UC-65.1-14 an ended conversation stays ended", () => {
    const storyline = cardReplacement();
    const ended = advance(storyline, { ...verified(storyline), outcome: "Completed" }, { kind: "Reply", text: "hello?" });
    expect(ended.emissions).toEqual([{ kind: "Ended", outcome: "Completed" }]);
  });
});

describe("what the mode decides", () => {
  it("UC-64.1-01 UC-65.1-07 strict mode redirects, then offers a person", () => {
    const storyline = cardReplacement("Strict");
    let state = verified(storyline);

    for (let turn = 1; turn <= 2; turn += 1) {
      const aside = advance(storyline, { ...state, awaiting: "Confirmation" }, { kind: "Reply", text: "what are your opening hours?" });
      expect(aside.emissions[0]).toMatchObject({ kind: "Message", en: "Let us finish this step first." });
      expect(aside.effects).toEqual([]);
      state = aside.state;
    }

    const third = advance(storyline, { ...state, awaiting: "Confirmation" }, { kind: "Reply", text: "and your address?" });
    expect(third.emissions).toContainEqual({ kind: "HandoffOffer" });
  });

  it("UC-64.1-02 guided mode has the agent answer the side question and stays on the step", () => {
    const storyline = cardReplacement("Guided");
    const state = { ...verified(storyline), awaiting: "Confirmation" as const, stepName: "ask_reason" };
    const aside = advance(storyline, state, { kind: "Reply", text: "what are your opening hours?" });

    expect(aside.effects).toEqual([{ kind: "SideAnswer", step: "ask_reason", text: "what are your opening hours?" }]);
    // The widget offers the step's choices again under the agent's answer.
    expect(aside.emissions).toEqual([]);
    expect(aside.state).toEqual(state);
  });

  it("D339 D286 in guided mode the end of the script leaves the conversation open for the agent", () => {
    const welcome: Storyline = {
      code: "shj3",
      versionNumber: 4,
      mode: "Guided",
      steps: [
        step({ name: "welcome", type: "Message", messageEn: "Welcome to SHJ3!", messageAr: "مرحباً!", nextStepName: "end" }),
        step({ name: "end", type: "End", messageEn: "Anything else?", messageAr: "شيء آخر؟" }),
      ],
    };
    const opened = advance(welcome, newConversation(), { kind: "Open" });
    expect(opened.emissions).toEqual([
      { kind: "Message", en: "Welcome to SHJ3!", ar: "مرحباً!", verbatim: false },
      { kind: "Message", en: "Anything else?", ar: "شيء آخر؟", verbatim: false },
    ]);
    expect(opened.state.outcome).toBeNull();

    const asked = advance(welcome, opened.state, { kind: "Reply", text: "When does flight G9 101 land?" });
    expect(asked.effects).toEqual([{ kind: "SideAnswer", step: null, text: "When does flight G9 101 land?" }]);
    expect(asked.state.outcome).toBeNull();

    // Strict ends there, as the script says.
    const strict = advance({ ...welcome, mode: "Strict" }, newConversation(), { kind: "Open" });
    expect(strict.state.outcome).toBe("Completed");
    expect(strict.emissions.at(-1)).toEqual({ kind: "Ended", outcome: "Completed" });
  });

  it("D339 in guided mode a reply that is none of the step's choices is a request for the agent", () => {
    const storyline = cardReplacement("Guided");
    const state = { ...verified(storyline), awaiting: "Reply" as const, stepName: "ask_reason" };

    const question = advance(storyline, state, { kind: "Reply", text: "Do you deliver the new card?" });
    expect(question.effects).toEqual([{ kind: "SideAnswer", step: "ask_reason", text: "Do you deliver the new card?" }]);
    expect(question.state.attempts.ask_reason ?? 0).toBe(0);

    // A choice still moves the script on.
    expect(advance(storyline, state, { kind: "Reply", text: "stolen" }).state.stepName).toBe("block_card");
  });
});

/** The shj3-new menu: a service, then an account operation, then a form; `act` adds a Tool step. */
function balanceMenu(act = false): Storyline {
  return {
    code: "shj3-new",
    versionNumber: 3,
    mode: "Guided",
    steps: [
      step({
        name: "ask_service",
        type: "Ask",
        messageEn: "Pick a service.",
        slot: "service",
        nextStepName: "ask_ops",
        config: { choices: [{ value: "account_ops", en: "Account operations", ar: "العمليات على الحساب" }, { value: "other", en: "Other", ar: "أخرى" }] },
      }),
      step({ name: "ask_ops", type: "Ask", messageEn: "Pick an operation.", slot: "op", nextStepName: "check_balance", config: { choices: [{ value: "check_balance", en: "Check balance", ar: "الرصيد" }] } }),
      step({
        name: "check_balance",
        type: "Form",
        messageEn: "Your account?",
        nextStepName: act ? "lookup" : "end",
        config: {
          formFields: [
            { key: "account_type", labelEn: "Account type", labelAr: "نوع الحساب", dataType: "Text", required: true, choices: [{ value: "eid", en: "Emirates ID", ar: "الهوية" }] },
            { key: "account_number", labelEn: "Account number", labelAr: "رقم الحساب", dataType: "Text", required: true },
          ],
        },
      }),
      ...(act ? [step({ name: "lookup", type: "Tool", toolRefs: ["accounts/balance"], nextStepName: "end" })] : []),
      step({ name: "end", type: "End", messageEn: "Thank you!" }),
    ],
  };
}

describe("D339 a guided storyline", () => {
  const atForm = (storyline: Storyline) => {
    let state = advance(storyline, newConversation(), { kind: "Open" }).state;
    state = advance(storyline, state, { kind: "Reply", text: "account_ops" }).state;
    return advance(storyline, state, { kind: "Reply", text: "check_balance" }).state;
  };

  it("hands details the script never acted on to the agent instead of thanking the visitor", () => {
    const storyline = balanceMenu();
    const sent = advance(storyline, atForm(storyline), { kind: "Form", values: { account_type: "eid", account_number: "784-1" } });

    expect(sent.effects).toEqual([
      {
        kind: "SideAnswer",
        step: "end",
        text: "I chose Account operations › Check balance. My details:\n- Account type: Emirates ID\n- Account number: 784-1",
      },
    ]);
    // The closing message would claim the work was done; the agent's answer replaces it.
    expect(sent.emissions).toEqual([]);
    expect(sent.state.outcome).toBeNull();
  });

  it("closes with its own message once a Tool step has acted on the details", () => {
    const acting = balanceMenu(true);
    const looked = advance(acting, atForm(acting), { kind: "Form", values: { account_type: "eid", account_number: "784-1" } });
    expect(looked.effects[0].kind).toBe("Tool");
    const done = advance(acting, looked.state, { kind: "Resume", ok: true });
    expect(done.effects).toEqual([]);
    expect(done.emissions).toContainEqual({ kind: "Message", en: "Thank you!", ar: "Thank you!", verbatim: false });
  });

  it("takes only the form's own fields, and only a listed choice", () => {
    const storyline = balanceMenu();
    const at = atForm(storyline);
    const wrong = advance(storyline, at, { kind: "Form", values: { account_type: "passport", account_number: "1" } });
    expect(wrong.state.awaiting).toBe("Form");
    expect(wrong.state.attempts.check_balance).toBe(1);

    const extra = advance(storyline, at, { kind: "Form", values: { account_type: "eid", account_number: "1", service: "other" } });
    expect(extra.state.slots).toEqual({ service: "account_ops", op: "check_balance", account_type: "eid", account_number: "1" });
  });

  it("Back returns to the previous question and Main menu to the first, clearing what was answered there", () => {
    const storyline = balanceMenu();
    const at = atForm(storyline);
    expect(at.trail).toEqual(["ask_service", "ask_ops", "check_balance"]);

    const back = advance(storyline, at, { kind: "Back" });
    expect(back.state.stepName).toBe("ask_ops");
    expect(back.state.slots).toEqual({ service: "account_ops" });
    expect(back.emissions[0]).toEqual({ kind: "Message", en: "Pick an operation.", ar: "Pick an operation.", verbatim: false });

    const menu = advance(storyline, at, { kind: "MainMenu" });
    expect(menu.state.stepName).toBe("ask_service");
    expect(menu.state.slots).toEqual({});
    expect(menu.state.trail).toEqual(["ask_service"]);

    // At the first question there is nowhere further back.
    expect(advance(storyline, menu.state, { kind: "Back" }).state).toEqual(menu.state);
  });

  it("Main menu starts the menu again after the script has run out", () => {
    const storyline = balanceMenu();
    const ended = advance(storyline, atForm(storyline), { kind: "Form", values: { account_type: "eid", account_number: "1" } }).state;
    expect(ended.stepName).toBeNull();
    const again = advance(storyline, ended, { kind: "MainMenu" });
    expect(again.state.stepName).toBe("ask_service");
    expect(again.state.awaiting).toBe("Reply");
  });
});

describe("a step that fails", () => {
  it("UC-64.1-13 Retry once runs the step again, and gives up the second time", () => {
    const storyline = cardReplacement();
    let state = advance(storyline, verified(storyline), { kind: "Reply", text: "stolen" }).state;
    expect(state.stepName).toBe("block_card");

    const retried = advance(storyline, state, { kind: "Resume", ok: false });
    expect(retried.effects).toEqual([{ kind: "Tool", step: "block_card", refs: ["cards/block"], agentCode: "sup" }]);

    state = retried.state;
    const given = advance(storyline, state, { kind: "Resume", ok: false });
    expect(given.effects).toEqual([{ kind: "Handoff", step: "block_card", queue: null }]);
  });

  it("UC-64.1-04 On error may name a step to go to instead", () => {
    const storyline = cardReplacement();
    const rescue = storyline.steps.map((one) =>
      one.name === "block_card" ? { ...one, onError: "GoToStep" as const, config: { ...one.config, onErrorStepName: "ask_address" } } : one,
    );
    const withRescue = { ...storyline, steps: rescue };

    const state = advance(withRescue, verified(withRescue), { kind: "Reply", text: "stolen" }).state;
    const failed = advance(withRescue, state, { kind: "Resume", ok: false });
    expect(failed.state.stepName).toBe("ask_address");
    expect(failed.state.awaiting).toBe("Reply");
  });
});

describe("publishing a version", () => {
  const allowed = () => ["cards/block"];

  it("UC-64.1-10 a configured, reachable script with an end publishes", () => {
    expect(publishProblems(cardReplacement(), { arabicEnabled: true, allowedTools: allowed })).toEqual([]);
  });

  it("UC-64.1-10 an unconfigured step, a dead end and an unreachable step all block it", () => {
    const storyline = cardReplacement();
    const broken: Storyline = {
      ...storyline,
      steps: [
        ...storyline.steps.map((one) => (one.name === "ask_address" ? { ...one, messageEn: "", messageAr: "" } : one)),
        step({ name: "orphan", type: "Message", messageEn: "Nobody gets here.", messageAr: "لا أحد يصل." }),
      ],
    };

    const problems = publishProblems(broken, { arabicEnabled: true, allowedTools: allowed });
    expect(problems).toContainEqual({ step: "ask_address", reason: "NotConfigured" });
    expect(problems).toContainEqual({ step: "orphan", reason: "NoNextStep" });
    expect(problems).toContainEqual({ step: "orphan", reason: "Unreachable" });
  });

  it("D279 a version with no steps cannot be published, since every conversation would end as it opens", () => {
    expect(publishProblems({ ...cardReplacement(), steps: [] }, { arabicEnabled: true, allowedTools: allowed })).toEqual([
      { step: "", reason: "NoSteps" },
    ]);
  });

  it("UC-64.1-11 a missing Arabic message blocks publishing while Arabic is on", () => {
    const storyline = cardReplacement();
    const missing: Storyline = {
      ...storyline,
      steps: storyline.steps.map((one) => (one.name === "greet" ? { ...one, messageAr: "" } : one)),
    };

    expect(publishProblems(missing, { arabicEnabled: true, allowedTools: allowed })).toContainEqual({
      step: "greet",
      reason: "MissingArabic",
    });
    expect(publishProblems(missing, { arabicEnabled: false, allowedTools: allowed })).toEqual([]);
  });

  it("UC-64.1-12 a Tool step is flagged when its agent may not call the tool", () => {
    expect(publishProblems(cardReplacement(), { arabicEnabled: true, allowedTools: () => ["cards/replace"] })).toContainEqual({
      step: "block_card",
      reason: "ToolNotAllowed",
      detail: "cards/block",
    });
  });

  it("UC-64.1-07 deleting a step names the steps that pointed at it", () => {
    const storyline = cardReplacement();
    expect(dependentSteps(storyline.steps, "block_card")).toEqual(["route"]);
    expect(dependentSteps(storyline.steps, "ask_address")).toEqual(["route", "block_card"]);
  });
});

describe("a step's configuration, as the editor and storyline_step_edit send it", () => {
  /** A step as `storylineStepInput` takes it: the console's save and the agent tool share it. */
  const sent = (over: Record<string, unknown>) => ({
    code: "menu-test",
    name: "menu",
    type: "Decide",
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
  const refusal = (over: Record<string, unknown>) => {
    const parsed = storylineStepInput.safeParse(sent(over));
    expect(parsed.success).toBe(false);
    return (parsed.error?.issues ?? []).map((issue) => issue.message).join(" ");
  };

  it("a key no step reads is refused, naming it and the keys a Decide step takes", () => {
    // The two shapes an agent invented for a menu on the cluster, which nothing read.
    for (const options of [
      [{ label: "Payments", targetStep: "payments_menu" }],
      [{ step: "list_entities", label: "List entities", value: "list_entities" }],
    ]) {
      const message = refusal({ config: { options } });
      expect(message).toContain("`options`");
      expect(message).toContain("Decide: branches, otherwise");
    }
    // Inside a typed field too, where the widget would otherwise pass it on as it is.
    expect(refusal({ type: "Ask", slot: "topic", config: { field: { type: "select", options: ["a"] } } })).toContain("`options`");
    expect(refusal({ config: { branches: [{ slot: "topic", value: "payments", goto: "payments" }] } })).toContain("`value`");
  });

  it("a model is told which config keys exist and that no other is taken", () => {
    const schema = inputSchemaOf({ input: storylineStepInput } as unknown as PlatformTool) as {
      properties: { config: { additionalProperties: unknown; properties: Record<string, unknown> } };
    };
    expect(schema.properties.config.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.config.properties)).toEqual(expect.arrayContaining(["choices", "branches", "otherwise", "field", "mode"]));
  });

  it("a menu is an Ask step whose choices the visitor sees, then a Decide step that routes on its slot", () => {
    const TOPICS = [
      { value: "payments", en: "Payments", ar: "المدفوعات" },
      { value: "entities", en: "List entities", ar: "قائمة الجهات" },
      { value: "other", en: "Something else", ar: "شيء آخر" },
    ];
    const steps = [
      sent({ name: "menu", type: "Ask", messageEn: "What do you need?", messageAr: "ماذا تحتاج؟", slot: "topic", nextStepName: "route", config: { choices: TOPICS } }),
      sent({
        name: "route",
        type: "Decide",
        config: {
          branches: [
            { slot: "topic", equals: "payments", goto: "payments" },
            { slot: "topic", equals: "entities", goto: "entities" },
          ],
          otherwise: "help",
        },
      }),
      sent({ name: "payments", type: "Message", messageEn: "Payments.", messageAr: "المدفوعات.", nextStepName: "done", config: { branch: true } }),
      sent({ name: "entities", type: "Message", messageEn: "Entities.", messageAr: "الجهات.", nextStepName: "done", config: { branch: true } }),
      sent({ name: "help", type: "Message", messageEn: "A person can help.", messageAr: "يمكن لموظف المساعدة.", nextStepName: "done", config: { branch: true } }),
      sent({ name: "done", type: "End" }),
    ].map((one): Step => storylineStepInput.parse(one));
    const menu: Storyline = { code: "menu-test", versionNumber: 1, mode: "Guided", steps };

    expect(publishProblems(menu, { arabicEnabled: true, allowedTools: () => [] })).toEqual([]);

    const opened = advance(menu, newConversation(), { kind: "Open" });
    expect(opened.emissions).toEqual([
      { kind: "Message", en: "What do you need?", ar: "ماذا تحتاج؟", verbatim: false },
      { kind: "QuickReplies", choices: TOPICS },
    ]);
    expect(opened.state.awaiting).toBe("Reply");

    const said = (text: string) =>
      advance(menu, opened.state, { kind: "Reply", text }).emissions.flatMap((emission) => (emission.kind === "Message" ? [emission.en] : []));
    // A chip posts the choice's value; typing its label in either language does the same.
    expect(said("payments")).toEqual(["Payments."]);
    expect(said("قائمة الجهات")).toEqual(["Entities."]);
    expect(said("other")).toEqual(["A person can help."]);
  });
});
