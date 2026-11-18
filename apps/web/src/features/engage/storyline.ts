/**
 * The storyline engine (S-64, S-65).
 *
 * One pure function decides what a storyline does next, so the visitor widget, the
 * designer's simulation and an inbound channel message all run the same script. Anything
 * with a side effect (a tool call, a request, a handoff, an OTP check) comes back as an
 * effect for the caller to perform and feed back with a `Resume` turn.
 */

import { checkField, extractByPattern, shown } from "./fields";
import {
  type Step,
  type Storyline,
  type Conversation,
  type VisitorTurn,
  type Emission,
  type Effect,
  type Advance,
  type Mode,
} from "./storyline-types";

/**
 * How many off-script turns a Strict storyline tolerates before it offers a person
 * (`UC-65.1-07`). Strict mode exists to keep the visitor on the script, so this is a rule of
 * the mode rather than a per-deployment setting.
 */
export const OFF_SCRIPT_LIMIT = 2;

/** What an Ask step allows when the step does not say (`UC-65.1-06`). */
export const DEFAULT_MAX_ATTEMPTS = 3;

const REDIRECT: [string, string] = [
  "Let us finish this step first.",
  "لنكمل هذه الخطوة أولاً.",
];

const RETRY: [string, string] = [
  "Sorry, I did not catch that.",
  "عذراً، لم أفهم ذلك.",
];

const HANDING_OVER: [string, string] = [
  "I am passing you to a person who can help.",
  "سأحوّلك إلى موظف يمكنه المساعدة.",
];

const CANCELLED: [string, string] = ["Cancelled. Nothing was submitted.", "أُلغي. لم يُرسل شيء."];

/** The mode a step's turn runs in: its own phase mode, or the storyline's. */
export function modeAt(storyline: Storyline, step: Step | null): Mode {
  return step?.config.mode ?? storyline.mode;
}

/** A conversation that has not started: no step, no slots, unverified, awaiting nothing. */
export function newConversation(): Conversation {
  return { stepName: null, slots: {}, attempts: {}, offScriptTurns: 0, verified: false, awaiting: null, outcome: null };
}

/** `{{slot}}` is replaced with what the conversation has collected, or left visible when empty. */
export function render(text: string | null, slots: Record<string, string>): string {
  return (text ?? "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) => slots[name] ?? whole);
}

/** The slots a message interpolates, in the order they appear. */
export function slotsInMessage(text: string | null): string[] {
  return [...(text ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
}

function stepAt(storyline: Storyline, name: string | null): Step | null {
  return storyline.steps.find((step) => step.name === name) ?? null;
}

/** A step's message with the slots filled in; the Arabic falls back to the English text. */
function message(step: Step, slots: Record<string, string>): Emission {
  return {
    kind: "Message",
    en: render(step.messageEn, slots),
    ar: render(step.messageAr ?? step.messageEn, slots),
    verbatim: step.sendVerbatim,
  };
}

function plain([en, ar]: [string, string]): Emission {
  return { kind: "Message", en, ar, verbatim: false };
}

function maxAttempts(step: Step): number {
  return step.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
}

/** The Ask step that collects a slot, which is where Change goes back to (`UC-65.1-05`). */
export function stepCollecting(storyline: Storyline, slot: string): Step | null {
  return storyline.steps.find((step) => step.type === "Ask" && step.slot === slot) ?? null;
}

/** The slots a step fills from the visitor: an Ask step's slot, or a Form step's fields. */
function slotsOf(step: Step): string[] {
  if (step.type === "Form") return (step.config.formFields ?? []).map((field) => field.key);
  return step.type === "Ask" && step.slot ? [step.slot] : [];
}

/** The trail with `name` as its newest step: a step already on it cuts the trail back to it. */
function onTrail(trail: string[] | undefined, name: string): string[] {
  const steps = trail ?? [];
  const at = steps.indexOf(name);
  return at >= 0 ? steps.slice(0, at + 1) : [...steps, name];
}

/**
 * What the visitor asked for, as the agent's prompt, when the script ends without a Tool or
 * Create work step acting on it: the menu choices taken and the details typed. `null` when the
 * visitor typed nothing (only picked from menus), which an informational path ends with.
 */
function unactedRequest(storyline: Storyline, state: Conversation): string | null {
  const picked: string[] = [];
  const details: string[] = [];
  for (const step of storyline.steps) {
    if (step.type === "Ask" && step.slot && state.slots[step.slot] !== undefined) {
      const value = state.slots[step.slot];
      const choice = step.config.choices?.find((one) => one.value === value);
      if (choice) picked.push(choice.en);
      else details.push(`${step.config.field?.labelEn ?? step.slot}: ${shown(step.config.field, value)}`);
    }
    if (step.type === "Form") {
      for (const field of step.config.formFields ?? []) {
        const value = state.slots[field.key];
        if (value === undefined || value === "") continue;
        details.push(`${field.labelEn || field.key}: ${field.choices?.find((one) => one.value === value)?.en ?? value}`);
      }
    }
  }
  if (details.length === 0) return null;
  return `${picked.length ? `I chose ${picked.join(" › ")}. ` : ""}My details:\n${details.map((line) => `- ${line}`).join("\n")}`;
}

/**
 * Runs the script forward from `state.stepName` until it needs the visitor, raises an effect,
 * or ends. Called by `advance` after every turn, and never on its own.
 */
function run(storyline: Storyline, state: Conversation): Advance {
  const emissions: Emission[] = [];
  const effects: Effect[] = [];
  let current = { ...state };

  // Each iteration either leaves the loop or moves to another step, so a storyline that
  // loops back on itself cannot spin here: the step budget is the length of the script.
  for (let guard = 0; guard <= storyline.steps.length; guard += 1) {
    const step = stepAt(storyline, current.stepName);
    if (!step) {
      if (current.outcome === null) current.outcome = "Completed";
      emissions.push({ kind: "Ended", outcome: current.outcome });
      return { state: current, emissions, effects };
    }

    switch (step.type) {
      case "Message": {
        emissions.push(message(step, current.slots));
        current = { ...current, stepName: step.nextStepName };
        break;
      }
      case "Ask": {
        // A value given ahead of its step, by a prefill or an earlier reply, is not asked for
        // again outside Strict, where every step is asked in order (specification 10.1).
        const prefilled = current.prefilled ?? [];
        if (step.slot && prefilled.includes(step.slot) && current.slots[step.slot] !== undefined && modeAt(storyline, step) !== "Strict") {
          current = { ...current, prefilled: prefilled.filter((slot) => slot !== step.slot), stepName: step.nextStepName };
          break;
        }
        emissions.push(message(step, current.slots));
        if (step.config.choices?.length) emissions.push({ kind: "QuickReplies", choices: step.config.choices });
        return { state: { ...current, awaiting: "Reply", trail: onTrail(current.trail, step.name) }, emissions, effects };
      }
      case "Form": {
        if (step.messageEn) emissions.push(message(step, current.slots));
        emissions.push({ kind: "FormPrompt", fields: step.config.formFields ?? [] });
        return { state: { ...current, awaiting: "Form", trail: onTrail(current.trail, step.name) }, emissions, effects };
      }
      case "Confirm": {
        emissions.push({ kind: "Confirm", en: render(step.messageEn, current.slots), ar: render(step.messageAr ?? step.messageEn, current.slots) });
        return { state: { ...current, awaiting: "Confirmation", trail: onTrail(current.trail, step.name) }, emissions, effects };
      }
      case "Decide": {
        const taken = (step.config.branches ?? []).find((branch) => current.slots[branch.slot] === branch.equals);
        current = { ...current, stepName: taken?.goto ?? step.config.otherwise ?? step.nextStepName };
        break;
      }
      case "Classify": {
        effects.push({ kind: "Classify", step: step.name, slot: step.slot, choices: step.config.choices ?? [] });
        return { state: current, emissions, effects };
      }
      case "Tool": {
        effects.push({ kind: "Tool", step: step.name, refs: step.toolRefs, agentCode: step.agentCode });
        return { state: current, emissions, effects };
      }
      case "Skill": {
        effects.push({ kind: "Skill", step: step.name, refs: step.skillRefs, agentCode: step.agentCode });
        return { state: current, emissions, effects };
      }
      case "Verify": {
        if (current.verified) {
          current = { ...current, stepName: step.nextStepName };
          break;
        }
        emissions.push({ kind: "OtpPrompt", method: step.verifyMethod ?? "Otp" });
        return { state: { ...current, awaiting: "Otp" }, emissions, effects };
      }
      case "CreateWork": {
        effects.push({ kind: "CreateWork", step: step.name, requestTypeCode: step.config.requestTypeCode ?? null, slots: current.slots });
        return { state: current, emissions, effects };
      }
      case "Handoff": {
        effects.push({ kind: "Handoff", step: step.name, queue: step.handoffQueue });
        emissions.push(plain(HANDING_OVER));
        emissions.push({ kind: "Ended", outcome: "HandedOff" });
        return { state: { ...current, awaiting: null, outcome: "HandedOff", stepName: step.name }, emissions, effects };
      }
      case "Wait": {
        effects.push({ kind: "Wait", step: step.name, seconds: step.config.waitSeconds ?? 0 });
        return { state: current, emissions, effects };
      }
      case "Subflow": {
        effects.push({ kind: "Subflow", step: step.name, code: step.config.subflowCode ?? null });
        return { state: current, emissions, effects };
      }
      case "GoTo": {
        current = { ...current, stepName: step.config.gotoStepName ?? step.nextStepName };
        break;
      }
      case "End": {
        // In Guided mode the script running out leaves the composer open and the agent answers
        // what the visitor writes next (D286). A script that collected details and never acted on
        // them hands them to the agent, which does what it can or says it cannot; its answer
        // stands in for the closing message, which would otherwise claim the work was done.
        if (modeAt(storyline, step) === "Guided" && current.outcome === null) {
          const request = current.acted ? null : unactedRequest(storyline, current);
          const open = { ...current, awaiting: null, stepName: null };
          if (request) return { state: open, emissions, effects: [{ kind: "SideAnswer", step: step.name, text: request }] };
          if (step.messageEn) emissions.push(message(step, current.slots));
          return { state: open, emissions, effects };
        }
        if (step.messageEn) emissions.push(message(step, current.slots));
        const outcome = current.outcome ?? "Completed";
        emissions.push({ kind: "Ended", outcome });
        return { state: { ...current, awaiting: null, outcome, stepName: null }, emissions, effects };
      }
    }
  }

  // A chain longer than the script means the steps point in a circle; stopping is the only
  // honest answer, and the designer sees it as an unreachable end in the simulation.
  return { state: { ...current, awaiting: null, outcome: "Abandoned" }, emissions: [...emissions, { kind: "Ended", outcome: "Abandoned" }], effects };
}

/** Where a failed step goes (`UC-64.1-04` On error, `UC-64.1-13`). */
function afterFailure(storyline: Storyline, state: Conversation, step: Step, emissions: Emission[], effects: Effect[]): Advance {
  if (step.onError === "RetryOnce" && (state.attempts[step.name] ?? 0) <= 1) {
    return run(storyline, { ...state, awaiting: null });
  }
  if (step.onError === "GoToStep" && step.config.onErrorStepName) {
    return run(storyline, { ...state, stepName: step.config.onErrorStepName, awaiting: null });
  }
  effects.push({ kind: "Handoff", step: step.name, queue: step.handoffQueue });
  emissions.push(plain(HANDING_OVER));
  emissions.push({ kind: "Ended", outcome: "HandedOff" });
  return { state: { ...state, awaiting: null, outcome: "HandedOff" }, emissions, effects };
}

/** Matches free text against the step's quick replies, in either language (`UC-65.1-06`). */
function matchChoice(step: Step, text: string): string | null {
  const typed = text.trim().toLowerCase();
  if (typed === "") return null;
  const choices = step.config.choices ?? [];
  if (choices.length === 0) return text.trim();
  const hit = choices.find((choice) => [choice.value, choice.en, choice.ar].some((label) => label.toLowerCase() === typed));
  return hit?.value ?? null;
}

/** An off-script turn, handled by the mode (`UC-64.1-01` … `-03`, `UC-65.1-07`). */
function offScript(storyline: Storyline, state: Conversation, step: Step | null, text: string): Advance {
  // Guided answers it with the agent and stays on the step; the widget offers the step's
  // choices again under the answer.
  if (modeAt(storyline, step) === "Guided") {
    return { state, emissions: [], effects: [{ kind: "SideAnswer", step: step?.name ?? null, text }] };
  }

  const turns = state.offScriptTurns + 1;
  const emissions: Emission[] = [plain(REDIRECT)];
  if (step && (step.type === "Ask" || step.type === "Confirm")) emissions.push(message(step, state.slots));
  if (turns > OFF_SCRIPT_LIMIT) emissions.push({ kind: "HandoffOffer" });
  return { state: { ...state, offScriptTurns: turns }, emissions, effects: [] };
}

/**
 * One visitor turn.
 *
 * @param storyline the published version the conversation started on, which it keeps.
 * @param state what the conversation knew before this turn.
 * @param turn what the visitor (or the caller, for `Resume`) did.
 * @returns the new state, what to show, and what the caller must perform.
 */
export function advance(storyline: Storyline, state: Conversation, turn: VisitorTurn): Advance {
  if (state.outcome !== null && turn.kind !== "Open") {
    return { state, emissions: [{ kind: "Ended", outcome: state.outcome }], effects: [] };
  }

  const step = stepAt(storyline, state.stepName);

  switch (turn.kind) {
    case "Open":
      return run(storyline, { ...newConversation(), slots: state.slots, prefilled: state.prefilled, stepName: storyline.steps[0]?.name ?? null });

    case "Abandon":
      return { state: { ...state, awaiting: null, outcome: "Abandoned" }, emissions: [{ kind: "Ended", outcome: "Abandoned" }], effects: [] };

    case "Cancel":
      return {
        state: { ...state, awaiting: null, outcome: "Cancelled" },
        emissions: [plain(CANCELLED), { kind: "Ended", outcome: "Cancelled" }],
        effects: [],
      };

    case "EditField": {
      // Strict allows a change only from the summary's Edit (specification 10.1).
      const target = stepCollecting(storyline, turn.field);
      if (!step || state.awaiting !== "Confirmation" || !target) return offScript(storyline, state, step, `edit ${turn.field}`);
      const slots = { ...state.slots };
      delete slots[turn.field];
      return run(storyline, { ...state, slots, awaiting: null, stepName: target.name });
    }

    case "TalkToPerson": {
      const queue = step?.handoffQueue ?? null;
      return {
        state: { ...state, awaiting: null, outcome: "HandedOff" },
        emissions: [plain(HANDING_OVER), { kind: "Ended", outcome: "HandedOff" }],
        effects: [{ kind: "Handoff", step: step?.name ?? null, queue }],
      };
    }

    case "Confirm": {
      if (!step || state.awaiting !== "Confirmation") return offScript(storyline, state, step, "confirm");
      return run(storyline, { ...state, awaiting: null, stepName: step.nextStepName });
    }

    case "Change": {
      if (!step || state.awaiting !== "Confirmation") return offScript(storyline, state, step, "change");
      // Back to the step that collected the first value the confirmation names, with that
      // value cleared so the visitor is asked for it again.
      const named = slotsInMessage(step.messageEn).find((slot) => stepCollecting(storyline, slot));
      const target = named ? stepCollecting(storyline, named) : null;
      if (!target || !named) return run(storyline, { ...state, awaiting: null });
      const slots = { ...state.slots };
      delete slots[named];
      return run(storyline, { ...state, slots, awaiting: null, stepName: target.name });
    }

    case "Otp": {
      if (!step || state.awaiting !== "Otp") return offScript(storyline, state, step, turn.code);
      return {
        state,
        emissions: [],
        effects: [{ kind: "VerifyOtp", step: step.name, method: step.verifyMethod ?? "Otp", code: turn.code }],
      };
    }

    case "Reply": {
      if (!step || state.awaiting !== "Reply") return offScript(storyline, state, step, turn.text);
      const field = step.config.field;
      // A typed field is checked by its own rules; the server's check is the one that decides.
      const checked = field ? checkField(field, turn.text, step.config.choices ?? []) : null;
      const value = checked ? (checked.ok ? checked.value : null) : matchChoice(step, turn.text);
      const mode = modeAt(storyline, step);
      // In Guided mode a step's choices are suggestions: a reply that is none of them is the
      // visitor's own request, which the agent answers, not a wrong answer. A typed field's
      // value still has to pass its check.
      if (value === null && mode === "Guided" && step.config.choices?.length) return offScript(storyline, state, step, turn.text);
      if (value === null) {
        const attempts = { ...state.attempts, [step.name]: (state.attempts[step.name] ?? 0) + 1 };
        const tried = attempts[step.name];
        if (tried >= maxAttempts(step)) {
          return afterFailure(storyline, { ...state, attempts }, step, [], []);
        }
        const reason: Emission = checked && !checked.ok ? plain([checked.en, checked.ar]) : plain(RETRY);
        return {
          state: { ...state, attempts },
          emissions: [reason, message(step, state.slots), ...(step.config.choices?.length ? [{ kind: "QuickReplies" as const, choices: step.config.choices }] : [])],
          effects: [],
        };
      }
      let slots = step.slot ? { ...state.slots, [step.slot]: value } : state.slots;
      let prefilled = state.prefilled ?? [];
      const understood: Emission[] = [];
      // Guided takes several values in one message: later fields recognise theirs by pattern,
      // each is checked, the widget echoes what it understood, and only what is missing is
      // asked for (specification 7.1, 10.3). Strict takes the current value alone.
      if (mode === "Guided") {
        const later = storyline.steps.filter(
          (other) => other.type === "Ask" && other.slot && other.slot !== step.slot && other.config.field?.pattern && slots[other.slot] === undefined,
        );
        const found = extractByPattern(
          turn.text,
          later.map((other) => ({ slot: other.slot as string, spec: other.config.field! })),
        );
        const names = Object.keys(found);
        if (names.length) {
          slots = { ...slots, ...found };
          prefilled = [...prefilled, ...names];
          const echoes = names.map((slot) => {
            const spec = later.find((other) => other.slot === slot)?.config.field;
            return { en: `${spec?.labelEn ?? slot} ${shown(spec, found[slot])}`, ar: `${spec?.labelAr ?? spec?.labelEn ?? slot} ${shown(spec, found[slot])}` };
          });
          understood.push(plain([`Got it: ${echoes.map((one) => one.en).join(", ")}.`, `فهمت: ${echoes.map((one) => one.ar).join("، ")}.`]));
        }
      }
      const next = run(storyline, { ...state, slots, prefilled, awaiting: null, stepName: step.nextStepName });
      return { ...next, emissions: [...understood, ...next.emissions] };
    }

    case "Form": {
      if (!step || state.awaiting !== "Form") return offScript(storyline, state, step, "form");
      const fields = step.config.formFields ?? [];
      // Only the form's own fields are taken, and a field with choices only one of its values.
      const values: Record<string, string> = {};
      for (const field of fields) {
        const given = turn.values[field.key]?.trim() ?? "";
        if (given !== "" && (!field.choices?.length || field.choices.some((choice) => choice.value === given))) values[field.key] = given;
      }
      // Refused: a required field left empty, or a value given that is none of its choices.
      const missing = fields.filter((field) => values[field.key] === undefined && (field.required || (turn.values[field.key]?.trim() ?? "") !== ""));
      if (missing.length > 0) {
        const attempts = { ...state.attempts, [step.name]: (state.attempts[step.name] ?? 0) + 1 };
        const tried = attempts[step.name];
        if (tried >= maxAttempts(step)) {
          return afterFailure(storyline, { ...state, attempts }, step, [], []);
        }
        return {
          state: { ...state, attempts },
          emissions: [plain(RETRY), { kind: "FormPrompt", fields: step.config.formFields ?? [] }],
          effects: [],
        };
      }
      const slots = { ...state.slots, ...values };
      return run(storyline, { ...state, slots, awaiting: null, stepName: step.nextStepName });
    }

    case "Back":
    case "MainMenu": {
      // Back goes to the step that asked before this one, Main menu to the first that asked;
      // the values collected from there on are cleared, so the visitor answers them again.
      const trail = state.trail ?? [];
      const at = turn.kind === "Back" ? (state.awaiting !== null ? trail.length - 2 : -1) : 0;
      const target = at >= 0 ? stepAt(storyline, trail[at]) : null;
      if (!target || (turn.kind === "MainMenu" && state.awaiting !== null && trail.length < 2)) return { state, emissions: [], effects: [] };
      const slots = { ...state.slots };
      for (const name of trail.slice(at)) {
        const visited = stepAt(storyline, name);
        for (const slot of visited ? slotsOf(visited) : []) delete slots[slot];
      }
      return run(storyline, { ...state, slots, prefilled: [], trail: trail.slice(0, at), acted: false, awaiting: null, stepName: target.name });
    }

    case "Resume": {
      if (!step) return run(storyline, state);
      if (!turn.ok) {
        const attempts = { ...state.attempts, [step.name]: (state.attempts[step.name] ?? 0) + 1 };
        return afterFailure(storyline, { ...state, attempts }, step, [], []);
      }
      const slots = { ...state.slots, ...(turn.slots ?? {}) };
      const emissions: Emission[] = [];
      let outcome = state.outcome;
      if (step.type === "Verify") emissions.push({ kind: "Verified", method: step.verifyMethod ?? "Otp" });
      if (step.type === "CreateWork" && turn.reference) {
        emissions.push({ kind: "Reference", value: turn.reference });
        outcome = "RequestCreated";
      }
      const next = run(storyline, {
        ...state,
        slots,
        outcome,
        verified: step.type === "Verify" ? true : state.verified,
        acted: state.acted || step.type === "Tool" || step.type === "CreateWork",
        awaiting: null,
        stepName: step.nextStepName,
      });
      return { ...next, emissions: [...emissions, ...next.emissions] };
    }
  }
}
