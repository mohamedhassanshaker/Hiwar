/**
 * The widget's message protocol (widget specification section 6, D231).
 *
 * Every bot turn is a message of ordered blocks, with an instruction for the composer and,
 * while a scenario runs, where it is. The widget renders blocks and never builds business
 * logic from text; everything here is derived from the stored transcript and the
 * conversation's state, so a reload, a second tab and the stream all show the same thing.
 *
 * Pure: the frame imports the types, the server builds the messages.
 */

import type { FieldSpec, FieldType } from "./fields";
import { shown } from "./fields";
import type { Choice, Conversation, FormField, Mode, Presentation, Step, Storyline } from "./storyline-types";

export type Lang = "en" | "ar";

/** What a chip, a row or a button sends (specification 6.4). Each carries the step it belongs to. */
export type Action =
  | { type: "postback"; payload: { text: string }; step?: string | null }
  | { type: "start_scenario"; scenario: string; step?: string | null }
  | { type: "field_submit"; field: string; value: string; step?: string | null }
  | { type: "edit_field"; field: string; step?: string | null }
  | { type: "confirm"; token?: string; step?: string | null }
  | { type: "cancel"; step?: string | null }
  | { type: "handoff"; reason: string; step?: string | null }
  | { type: "open_url"; url: string }
  | { type: "load_more"; list: string; page: number; step?: string | null }
  | { type: "restart" }
  | { type: "back"; step?: string | null }
  | { type: "main_menu"; step?: string | null }
  | { type: "show_example"; field: string; step?: string | null };

export type Chip = { id: string; label: string; action: Action; icon?: string };

export type ListItem = { id: string; title: string; subtitle?: string; meta?: string; badge?: string; action?: Action };

export type Block =
  | { type: "text"; text: string }
  | { type: "chips"; items: Chip[]; persist?: boolean }
  | { type: "list"; items: ListItem[]; selectable: "none" | "single" | "multi"; page?: number; total?: number; filters?: Chip[] }
  | { type: "card"; title: string; subtitle?: string; fields: { label: string; value: string }[]; badge?: string; actions?: Chip[] }
  | { type: "carousel"; cards: Extract<Block, { type: "card" }>[] }
  | {
      type: "summary";
      rows: { field: string; label: string; value: string; editable: boolean }[];
      total?: string;
      actions: Chip[];
    }
  | { type: "receipt"; reference: string; status: string; amount?: string; date: string; fields: { label: string; value: string }[]; actions: Chip[] }
  | { type: "timeline"; events: { label: string; ts: string; state: "done" | "current" | "pending" }[] }
  | { type: "notice"; level: "info" | "warning" | "error"; text: string; actions?: Chip[] }
  | { type: "progress"; current: number; total: number; label: string }
  | { type: "handoff"; state: "queued" | "connected" | "ended"; position?: number; agentName?: string }
  | { type: "link_out"; label: string; url: string; opensIn: "tab" | "overlay"; returnsTo?: string }
  | { type: "attachment"; name: string; size: number; url: string };

/** One control for one field (specification 6.3). `form` holds several fields at once. */
export type FieldPrompt = Omit<FieldSpec, "type"> & {
  id: string;
  type: FieldType | "form";
  required: boolean;
  options?: { value: string; label: string }[];
  fields?: { key: string; label: string; dataType: string; required: boolean; options?: { value: string; label: string }[] }[];
  /** The OTP's destination, masked, and when it may be sent again. */
  maskedTarget?: string;
  resendAfterSeconds?: number;
};

export type Input =
  | { mode: "free" }
  | { mode: "field"; field: FieldPrompt }
  | { mode: "locked"; reason: string };

export type Flow = {
  scenario: string;
  phase: string;
  mode: Lowercase<Mode>;
  step: string | null;
  progress: { current: number; total: number };
};

export type WidgetMessage = {
  id: string;
  role: "assistant" | "user" | "human_agent" | "system";
  ts: string;
  lang: Lang;
  blocks: Block[];
  input?: Input;
  flow?: Flow;
  speakable?: string;
  /** The visitor's thumbs on this message, when they gave one. */
  feedback?: "up" | "down";
};

/** A stored transcript line, as the repository reads it back. */
export type Line = {
  role: string;
  kind: string;
  textEn: string | null;
  textAr: string | null;
  payload: Record<string, unknown>;
  seq?: number;
  at?: string;
};

export type QuickActionChip = { id: string; labelEn: string; labelAr: string; storyline: string; pages: string[] };

export type ProtocolInput = {
  lines: Line[];
  state: Conversation;
  storyline: Storyline | null;
  slots: Record<string, string>;
  quickActions: QuickActionChip[];
  /** The host page from the embed's `data-context`, which ranks and filters the chips. */
  page: string | null;
  lang: Lang;
  /** The agent is answering: the composer stays open, the widget shows it typing. */
  pending: boolean;
  /** The conversation was handed to a person; `connected` once one has answered. */
  handoff: "queued" | "connected" | null;
  /** The OTP's masked destination, when the step is waiting for one. */
  otpTarget: string | null;
  ended: boolean;
  /** The deployment has a handoff queue, so "Talk to a person" may be offered. */
  handoffAvailable: boolean;
  /** A person has taken the conversation over: the visitor writes to them, not to the script (D342). */
  agentPaused: boolean;
};

const say = (lang: Lang, en: string, ar: string) => (lang === "ar" ? ar : en);

const text = (lang: Lang, line: Line): string => (lang === "ar" ? line.textAr ?? line.textEn : line.textEn ?? line.textAr) ?? "";

/** The chips under the greeting, ordered for the page the widget is on (specification 8). */
export function quickActionChips(actions: QuickActionChip[], page: string | null, lang: Lang): Chip[] {
  const onPage = actions.filter((action) => action.pages.length === 0 || action.pages.includes("*") || (page !== null && action.pages.includes(page)));
  // Page context promotes the chip made for this page to first.
  const ranked = page ? [...onPage.filter((action) => action.pages.includes(page)), ...onPage.filter((action) => !action.pages.includes(page))] : onPage;
  return ranked.map((action) => ({
    id: action.id,
    label: lang === "ar" ? action.labelAr || action.labelEn : action.labelEn,
    action: { type: "start_scenario", scenario: action.storyline },
  }));
}

/** A step's choices as chips in the visitor's language, each posting back the choice's value. */
function choicesAsChips(choices: Choice[], lang: Lang, step: string | null): Chip[] {
  return choices.map((choice) => ({
    id: choice.value,
    label: lang === "ar" ? choice.ar || choice.en : choice.en,
    action: { type: "postback", payload: { text: choice.value }, step },
  }));
}

/** The Ask step that collects a slot, whose field spec labels and masks it. */
function collecting(storyline: Storyline | null, slot: string): Step | null {
  return storyline?.steps.find((step) => step.type === "Ask" && step.slot === slot) ?? null;
}

/** A summary's rows: every value the confirmation names, with its label, editable by its step. */
function summaryRows(storyline: Storyline | null, confirmStep: Step | null, slots: Record<string, string>, lang: Lang) {
  const named = [...(confirmStep?.messageEn ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
  const fields = named.length ? [...new Set(named)] : Object.keys(slots);
  return fields
    .filter((field) => slots[field] !== undefined)
    .map((field) => {
      const step = collecting(storyline, field);
      const spec = step?.config.field;
      const label = lang === "ar" ? spec?.labelAr ?? spec?.labelEn ?? field : spec?.labelEn ?? field;
      return { field, label, value: shown(spec, slots[field]), editable: step !== null };
    });
}

const effective = (storyline: Storyline, step: Step | null): Mode => step?.config.mode ?? storyline.mode;

/** What the composer does now: free text, one field's control, or nothing. */
export function inputFor(input: ProtocolInput, step: Step | null): Input {
  const { state, lang } = input;
  if (input.ended) return { mode: "locked", reason: say(lang, "This conversation has ended.", "انتهت هذه المحادثة.") };
  if (input.agentPaused) return { mode: "free" };
  if (state.awaiting === "Otp") {
    return {
      mode: "field",
      field: {
        id: "otp",
        type: "otp",
        required: true,
        maskedTarget: input.otpTarget ?? undefined,
        resendAfterSeconds: 60,
      },
    };
  }
  if (state.awaiting === "Form" && step) {
    return {
      mode: "field",
      field: {
        id: step.name,
        type: "form",
        required: true,
        fields: (step.config.formFields ?? []).map((field: FormField) => ({
          key: field.key,
          label: lang === "ar" ? field.labelAr || field.labelEn : field.labelEn,
          dataType: field.dataType,
          required: field.required,
          ...(field.choices?.length ? { options: field.choices.map((choice) => ({ value: choice.value, label: lang === "ar" ? choice.ar || choice.en : choice.en })) } : {}),
        })),
      },
    };
  }
  if (state.awaiting === "Reply" && step?.config.field && step.slot) {
    const spec = step.config.field;
    const strict = input.storyline ? effective(input.storyline, step) === "Strict" : false;
    return {
      mode: "field",
      field: {
        ...spec,
        id: step.slot,
        required: true,
        // Strict steps take only the control's value; a typed question is still answered.
        allowFreeText: spec.allowFreeText ?? !strict,
        options: (step.config.choices ?? []).map((choice) => ({ value: choice.value, label: lang === "ar" ? choice.ar || choice.en : choice.en })),
      },
    };
  }
  return { mode: "free" };
}

/**
 * Where a running scenario is: its code, the step's effective mode as the phase, and progress as
 * the step's place among the steps, or all of them when the step is not found.
 */
function flowFor(storyline: Storyline, step: Step | null, state: Conversation): Flow {
  const index = step ? storyline.steps.findIndex((one) => one.name === step.name) : -1;
  const mode = effective(storyline, step);
  return {
    scenario: storyline.code,
    phase: mode.toLowerCase(),
    mode: mode.toLowerCase() as Lowercase<Mode>,
    step: state.stepName,
    progress: { current: index >= 0 ? index + 1 : storyline.steps.length, total: storyline.steps.length },
  };
}

/** One line's blocks, in the visitor's language. */
function blocksOf(line: Line, input: ProtocolInput, step: Step | null): Block[] {
  const { lang } = input;
  const stepName = input.state.stepName;
  switch (line.kind) {
    case "QuickReplies":
      return [{ type: "chips", items: choicesAsChips((line.payload.choices ?? []) as Choice[], lang, stepName) }];
    case "FormPrompt":
      return [];
    case "OtpPrompt":
      return [
        {
          type: "text",
          text: input.otpTarget
            ? say(lang, `To continue, I need to verify you. We sent a 6-digit code to ${input.otpTarget}.`, `للمتابعة، أحتاج إلى التحقق منك. أرسلنا رمزاً من 6 أرقام إلى ${input.otpTarget}.`)
            : say(lang, "To continue, I need to verify you. Enter the 6-digit code you received.", "للمتابعة، أحتاج إلى التحقق منك. أدخل الرمز المكوّن من 6 أرقام الذي وصلك."),
        },
      ];
    case "Verified":
      return [{ type: "notice", level: "info", text: say(lang, "Identity verified.", "تم التحقق من الهوية.") }];
    case "HandoffOffer":
      if (!input.handoffAvailable) return [];
      return [
        {
          type: "chips",
          items: [{ id: "handoff", label: say(lang, "Talk to a person", "التحدث مع موظف"), action: { type: "handoff", reason: "off_script", step: stepName } }],
        },
      ];
    case "Confirm": {
      const confirmStep = input.storyline?.steps.find((one) => one.type === "Confirm" && one.name === stepName) ?? step;
      return [
        ...(text(lang, line) ? [{ type: "text" as const, text: text(lang, line) }] : []),
        {
          type: "summary",
          rows: summaryRows(input.storyline, confirmStep, input.slots, lang),
          actions: [
            { id: "confirm", label: say(lang, "Confirm", "تأكيد"), action: { type: "confirm", step: stepName } },
            { id: "cancel", label: say(lang, "Cancel", "إلغاء"), action: { type: "cancel", step: stepName } },
          ],
        },
      ];
    }
    case "Reference":
      return [
        {
          type: "receipt",
          reference: line.textEn ?? "",
          status: say(lang, "Submitted", "تم الإرسال"),
          date: line.at ?? new Date().toISOString(),
          fields: [],
          actions: [],
        },
      ];
    case "Ended": {
      const outcome = String(line.payload.outcome ?? "Completed");
      const words: Record<string, [string, string]> = {
        Completed: ["This conversation is complete.", "اكتملت هذه المحادثة."],
        HandedOff: ["A person will continue this conversation.", "سيتابع موظف هذه المحادثة."],
        Abandoned: ["Conversation ended.", "انتهت المحادثة."],
        Cancelled: ["Conversation ended.", "انتهت المحادثة."],
        RequestCreated: ["Your request was submitted.", "تم إرسال طلبك."],
      };
      const [en, ar] = words[outcome] ?? words.Abandoned;
      return [
        {
          type: "notice",
          level: "info",
          text: say(lang, en, ar),
          actions: outcome === "HandedOff" ? [] : [{ id: "restart", label: say(lang, "Start a new conversation", "بدء محادثة جديدة"), action: { type: "restart" } }],
        },
      ];
    }
    case "Blocks":
      return (line.payload.blocks ?? []) as Block[];
    case "Otp":
      return [{ type: "text", text: "••••••" }];
    case "Form": {
      const values = (line.payload.values ?? {}) as Record<string, string>;
      return [{ type: "text", text: Object.values(values).filter(Boolean).join(" · ") || say(lang, "Form sent", "أُرسل النموذج") }];
    }
    default: {
      const body = text(lang, line);
      if (!body) return [];
      if (line.role === "System" && line.payload.level) {
        return [{ type: "notice", level: line.payload.level as "info" | "warning" | "error", text: body }];
      }
      return [{ type: "text", text: line.payload.masked ? "••••" : body }];
    }
  }
}

/**
 * The current step's controls under the latest assistant message: its choices again when an
 * agent's answer has pushed them out of the latest message, then Back and Main menu while the
 * script has somewhere to go back to.
 */
function stepChips(input: ProtocolInput, step: Step | null, last: WidgetMessage): Block[] {
  const { state, lang } = input;
  const blocks: Block[] = [];
  const choices = step?.config.choices ?? [];
  const offered = last.blocks.some((block) => block.type === "chips" && !block.persist);
  if (state.awaiting === "Reply" && choices.length && !step?.config.field && !offered) {
    blocks.push({ type: "chips", items: choicesAsChips(choices, lang, state.stepName) });
  }
  const trail = state.trail ?? [];
  const nav: Chip[] = [];
  if (state.awaiting !== null && trail.length >= 2) {
    nav.push({ id: "back", label: say(lang, "Back", "رجوع"), action: { type: "back", step: state.stepName } });
  }
  // Main menu is offered once the visitor has left it, and after the script has run out.
  if (trail.length >= 2 || (state.awaiting === null && trail.length >= 1)) {
    nav.push({ id: "main_menu", label: say(lang, "Main menu", "القائمة الرئيسية"), action: { type: "main_menu", step: state.stepName } });
  }
  if (nav.length) blocks.push({ type: "chips", items: nav });
  return blocks;
}

const roleOf = (role: string): WidgetMessage["role"] =>
  role === "Visitor" ? "user" : role === "HumanAgent" ? "human_agent" : role === "System" ? "system" : "assistant";

/**
 * The whole conversation as widget messages.
 *
 * Consecutive lines from the same side are one message, as one bot turn is. The last
 * assistant message carries the composer instruction and the flow; earlier ones carry
 * neither, which is what makes their chips inactive (specification 6.4).
 */
export function messagesOf(input: ProtocolInput): WidgetMessage[] {
  const step = input.storyline?.steps.find((one) => one.name === input.state.stepName) ?? null;
  const messages: WidgetMessage[] = [];
  for (const line of input.lines) {
    const role = roleOf(line.role);
    // The system's lines speak in the assistant's bubble, as notices.
    const side = role === "system" ? "assistant" : role;
    const blocks = blocksOf(line, input, step);
    if (line.payload.welcome) {
      const chips = quickActionChips(input.quickActions, input.page, input.lang);
      if (chips.length) blocks.push({ type: "chips", items: chips, persist: true });
    }
    if (blocks.length === 0) continue;
    const last = messages.at(-1);
    if (last && last.role === side && side !== "user" && !line.payload.welcome) {
      last.blocks.push(...blocks);
      continue;
    }
    messages.push({
      id: `msg_${line.seq ?? messages.length}`,
      role: side,
      ts: line.at ?? new Date(0).toISOString(),
      lang: input.lang,
      blocks,
      ...(line.payload.feedback ? { feedback: line.payload.feedback as "up" | "down" } : {}),
    });
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (lastAssistant) {
    lastAssistant.input = inputFor(input, step);
    if (input.storyline && !input.ended && !input.agentPaused) lastAssistant.blocks.push(...stepChips(input, step, lastAssistant));
    // The flow carries the progress; no "Step x of y" block is drawn (D341).
    if (input.storyline && !input.ended && input.state.stepName) lastAssistant.flow = flowFor(input.storyline, step, input.state);
    if (input.handoff) lastAssistant.blocks.push({ type: "handoff", state: input.handoff });
  }
  for (const message of messages) {
    message.speakable = message.blocks
      .map((block) => (block.type === "text" || block.type === "notice" ? block.text : ""))
      .filter((part) => part && !part.includes("•"))
      .join(" ");
  }
  return messages;
}

const str = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/**
 * What a Tool step shows of its result (specification 6.2): rows as a selectable list whose
 * tap sends the row's id as the reply, one record as a card, or events as a timeline.
 */
export function presentResult(presentation: Presentation, data: unknown, step: string | null): Block[] {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const rows = (
    Array.isArray(data)
      ? data
      : record
        ? ((presentation.rowsAt ? record[presentation.rowsAt] : Object.values(record).find(Array.isArray)) ?? [])
        : []
  ) as Record<string, unknown>[];
  const pick = (row: Record<string, unknown>, field: string | undefined, fallback: string) => str(row[field ?? fallback]);

  if (presentation.as === "card") {
    const one = record && !Array.isArray(data) && !presentation.rowsAt ? record : rows[0];
    if (!one) return [{ type: "notice", level: "warning", text: "Nothing was found." }];
    const named = new Set([presentation.title, presentation.subtitle, presentation.badge].filter(Boolean));
    return [
      {
        type: "card",
        title: pick(one, presentation.title, "title") || pick(one, undefined, "name"),
        subtitle: presentation.subtitle ? pick(one, presentation.subtitle, "") : undefined,
        badge: presentation.badge ? pick(one, presentation.badge, "") : undefined,
        fields: Object.entries(one)
          .filter(([key, value]) => !named.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
          .map(([key, value]) => ({ label: key, value: str(value) })),
      },
    ];
  }
  if (presentation.as === "timeline") {
    return [
      {
        type: "timeline",
        events: rows.map((row) => {
          const state = pick(row, presentation.state, "state");
          return {
            label: pick(row, presentation.label, "label"),
            ts: pick(row, presentation.ts, "ts"),
            state: state === "done" || state === "current" ? state : "pending",
          };
        }),
      },
    ];
  }
  return [
    {
      type: "list",
      selectable: "single",
      total: rows.length,
      items: rows.map((row, index) => {
        const id = pick(row, presentation.id, "id") || String(index + 1);
        return {
          id,
          title: pick(row, presentation.title, "title") || pick(row, undefined, "name") || id,
          subtitle: presentation.subtitle ? pick(row, presentation.subtitle, "") : undefined,
          meta: presentation.meta ? pick(row, presentation.meta, "") : undefined,
          badge: presentation.badge ? pick(row, presentation.badge, "") : undefined,
          action: { type: "postback", payload: { text: id }, step },
        };
      }),
    },
  ];
}

/** The error codes the widget acts on (specification 14). */
export const WIDGET_ERRORS = [
  "ORIGIN_NOT_ALLOWED",
  "DEPLOYMENT_DISABLED",
  "RATE_LIMITED",
  "IDENTITY_REQUIRED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "VALIDATION_FAILED",
  "STALE_ACTION",
  "TOKEN_EXPIRED",
  "TOOL_UNAVAILABLE",
  "SESSION_EXPIRED",
  "NOT_FOUND",
  "BAD_REQUEST",
] as const;

export type WidgetErrorCode = (typeof WIDGET_ERRORS)[number];

export type WidgetError = { error: { code: WidgetErrorCode; message: string; messageAr: string; retryAfter: number | null } };

/**
 * The same blocks as plain text, for a surface that draws none of them: WhatsApp and Teams
 * receive this where the widget would draw a control (specification 13.4).
 */
export function degrade(blocks: Block[], lang: Lang): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "notice":
        lines.push(block.text);
        break;
      case "chips":
        lines.push(block.items.map((chip, index) => `${index + 1}. ${chip.label}`).join("\n"));
        break;
      case "list":
        lines.push(block.items.map((item, index) => `${index + 1}. ${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`).join("\n"));
        break;
      case "card":
        lines.push([block.title, ...block.fields.map((field) => `${field.label}: ${field.value}`)].join("\n"));
        break;
      case "summary":
        lines.push(block.rows.map((row) => `${row.label}: ${row.value}`).join("\n"));
        break;
      case "receipt":
        lines.push(`${say(lang, "Reference", "المرجع")}: ${block.reference}`);
        break;
      case "timeline":
        lines.push(block.events.map((event) => `${event.state === "done" ? "✓" : event.state === "current" ? "•" : "○"} ${event.label}`).join("\n"));
        break;
      case "link_out":
        lines.push(`${block.label}: ${block.url}`);
        break;
      default:
        break;
    }
  }
  return lines.filter(Boolean).join("\n\n");
}
