import { STORYLINE_STEP_TYPES } from "@/db/schema/enums";
import type { FieldSpec } from "./fields";

export type StepType = (typeof STORYLINE_STEP_TYPES)[number];

/** A quick reply, as the step offers it and as the engine matches it. */
export type Choice = { value: string; en: string; ar: string };

/** One field of a `Form` step, authored from a request type's own attributes. `choices`, when
 * given, are the only values the field takes. */
export type FormField = { key: string; labelEn: string; labelAr: string; dataType: string; required: boolean; choices?: Choice[] };

/**
 * How a step's turn is run: the storyline's own mode unless the step names a phase mode.
 * Guided offers the script and answers anything else with the agent; Strict takes only the script.
 */
export type Mode = "Guided" | "Strict";

/** How a Tool step shows what it returned (widget specification 6.2, D231). */
export type Presentation = {
  as: "list" | "card" | "timeline";
  /** The field of the result that holds the rows, when the result is an object. */
  rowsAt?: string;
  /** Which field of a row is its id, title, subtitle, meta and badge. */
  id?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  /** A timeline row's label, time and state. */
  label?: string;
  ts?: string;
  state?: string;
};

export type StepConfig = {
  choices?: Choice[];
  /** This step's phase mode, when it differs from the storyline's (specification 7). */
  mode?: Mode;
  /** `ask`: the typed control the widget shows, and the rules the value must meet. */
  field?: FieldSpec;
  /** `tool`: what the widget shows of the result. */
  present?: Presentation;
  /** `decide`: the first branch whose slot equals its value wins. */
  branches?: { slot: string; equals: string; goto: string }[];
  otherwise?: string;
  /** `goto` and `OnError = GoToStep`. */
  gotoStepName?: string;
  onErrorStepName?: string;
  /** `create_work` and `form`: the request type the step raises. */
  requestTypeCode?: string;
  /** `form`: the fields shown at once, copied from the request type at authoring time —
   * the same way `Ask`'s `slot` is set once rather than read live off the type. */
  formFields?: FormField[];
  /** `wait`. */
  waitSeconds?: number;
  /** `subflow`. */
  subflowCode?: string;
  /** Drawn indented in the editor, which is how a branch target reads. */
  branch?: boolean;
};

export type Step = {
  name: string;
  type: StepType;
  messageEn: string | null;
  messageAr: string | null;
  sendVerbatim: boolean;
  slot: string | null;
  maxAttempts: number | null;
  verifyMethod: string | null;
  handoffQueue: string | null;
  toolRefs: string[];
  skillRefs: string[];
  agentCode: string | null;
  nextStepName: string | null;
  onError: "RetryOnce" | "GoToStep" | "Handoff";
  config: StepConfig;
};

export type Storyline = {
  code: string;
  versionNumber: number;
  mode: Mode;
  steps: Step[];
};

/** Everything the engine needs to know about a conversation between two turns. */
export type Conversation = {
  stepName: string | null;
  slots: Record<string, string>;
  /** Failed attempts, per step. */
  attempts: Record<string, number>;
  offScriptTurns: number;
  verified: boolean;
  /** What the visitor is expected to send next, if anything. */
  awaiting: "Reply" | "Confirmation" | "Otp" | "Form" | null;
  outcome: Outcome | null;
  /** Slots filled ahead of their own step, by a prefill or a value found in an earlier reply. */
  prefilled?: string[];
  /** The steps that asked the visitor, in order: where Back and Main menu go. */
  trail?: string[];
  /** A Tool or Create work step has acted on what the visitor gave. */
  acted?: boolean;
};

export type Outcome = "Completed" | "HandedOff" | "Abandoned" | "Cancelled" | "RequestCreated";

export type VisitorTurn =
  | { kind: "Open" }
  | { kind: "Reply"; text: string }
  | { kind: "Confirm" }
  | { kind: "Change" }
  | { kind: "Otp"; code: string }
  | { kind: "TalkToPerson" }
  | { kind: "Abandon" }
  /** The visitor stopped the scenario. */
  | { kind: "Cancel" }
  /** The summary's Edit on one value: back to the step that collected it. */
  | { kind: "EditField"; field: string }
  /** Back to the step that asked before this one. */
  | { kind: "Back" }
  /** Back to the first step that asked. */
  | { kind: "MainMenu" }
  /** All of a `Form` step's fields, submitted at once rather than one `Reply` per field. */
  | { kind: "Form"; values: Record<string, string> }
  /** The caller performed the pending effect: `ok` false follows the step's On error. */
  | { kind: "Resume"; ok: boolean; slots?: Record<string, string>; reference?: string };

export type Emission =
  | { kind: "Message"; en: string; ar: string; verbatim: boolean }
  | { kind: "QuickReplies"; choices: Choice[] }
  | { kind: "FormPrompt"; fields: FormField[] }
  | { kind: "Confirm"; en: string; ar: string }
  | { kind: "OtpPrompt"; method: string }
  | { kind: "Verified"; method: string }
  | { kind: "HandoffOffer" }
  | { kind: "Reference"; value: string }
  | { kind: "Ended"; outcome: Outcome };

export type Effect =
  | { kind: "Tool"; step: string; refs: string[]; agentCode: string | null }
  | { kind: "Skill"; step: string; refs: string[]; agentCode: string | null }
  | { kind: "Classify"; step: string; slot: string | null; choices: Choice[] }
  | { kind: "VerifyOtp"; step: string; method: string; code: string }
  | { kind: "CreateWork"; step: string; requestTypeCode: string | null; slots: Record<string, string> }
  | { kind: "Handoff"; step: string | null; queue: string | null }
  | { kind: "Wait"; step: string; seconds: number }
  | { kind: "Subflow"; step: string; code: string | null }
  /** Guided mode: the agent answers something the script did not ask for, or does what the
   * visitor asked for when the script ends without doing it. */
  | { kind: "SideAnswer"; step: string | null; text: string };

export type Advance = { state: Conversation; emissions: Emission[]; effects: Effect[] };
