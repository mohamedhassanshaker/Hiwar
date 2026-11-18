import { z } from "zod";

import {
  BUSINESS_HOURS_MODES,
  CHANNEL_BINDING_TYPES,
  CHANNEL_TYPES,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_SURFACES,
  STORYLINE_MODES,
  STORYLINE_ON_ERRORS,
  STORYLINE_STEP_TYPES,
  UNKNOWN_SENDER_POLICIES,
  VISITOR_IDENTITIES,
  VISITOR_JWT_FALLBACKS,
} from "@/db/schema/enums";

import { FIELD_TYPES, type FieldSpec } from "./fields";
import type { Choice, FormField, Presentation, StepConfig, StepType } from "./storyline-types";

/** Requirement 32: the channel, deployment and storyline action inputs. */

export const setChannelEnabledInput = z.object({
  type: z.enum(CHANNEL_TYPES),
  enabled: z.boolean(),
  version: z.number().int().positive(),
});

export const configureChannelInput = z.object({
  type: z.enum(CHANNEL_TYPES),
  rateLimitPerMinute: z.number().int().min(1).max(10_000),
  unknownSenders: z.enum(UNKNOWN_SENDER_POLICIES),
  businessHours: z.enum(BUSINESS_HOURS_MODES),
  bindingType: z.enum(CHANNEL_BINDING_TYPES).nullable(),
  /** Only read when the binding is an embedded deployment. */
  bindingDeploymentCode: z.string().min(1).nullable(),
  offlineMessageEn: z.string().trim().max(400).nullable(),
  offlineMessageAr: z.string().trim().max(400).nullable(),
  endpointUrl: z.union([z.url(), z.literal("")]).nullable(),
  /** Specification section 9: a channel token is write-only and never read back. */
  secret: z.string().min(1).optional(),
  inboundSecret: z.string().min(1).optional(),
});

export const testChannelInput = z.object({
  type: z.enum(CHANNEL_TYPES),
  sendTo: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(400),
});

export type ConfigureChannelInput = z.infer<typeof configureChannelInput>;
export type SetChannelEnabledInput = z.infer<typeof setChannelEnabledInput>;
export type TestChannelInput = z.infer<typeof testChannelInput>;

export const createDeploymentInput = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, digits, hyphens and underscores."),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  defaultAgentCode: z.string().min(1),
  /** `UC-62.1-02`: the channels it is published on, chosen when it is created. */
  surfaces: z.array(z.enum(DEPLOYMENT_SURFACES)).min(1),
});

/** One chip under the widget's greeting, starting one of the deployment's storylines. */
export const quickActionInput = z.object({
  id: z.string().trim().regex(/^[a-z0-9_]{1,48}$/, "An action id is lowercase letters, digits and underscores."),
  labelEn: z.string().trim().min(1).max(60),
  labelAr: z.string().trim().max(60).default(""),
  storyline: z.string().trim().min(1).max(64),
  pages: z.array(z.string().trim().min(1).max(64)).max(20).default(["*"]),
  minIdentity: z.enum(["anonymous", "otp_verified", "logged_in"]).default("anonymous"),
});

export const saveDeploymentInput = z.object({
  code: z.string().min(1),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  defaultAgentCode: z.string().min(1),
  status: z.enum(DEPLOYMENT_STATUSES),
  surfaces: z.array(z.enum(DEPLOYMENT_SURFACES)),
  /**
   * Each an origin, scheme and host with any port and nothing else, because the widget's CORS
   * check compares the browser's `Origin` exactly (D219). `null` is accepted when written on its
   * own (D220): it is what a page opened as a file sends, and also what any sandboxed frame on
   * any site sends, so it is for testing.
   */
  allowedOrigins: z.array(
    z.string().refine(
      (value) => {
        if (value === "null") return true;
        try {
          const url = new URL(value);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.origin === value.replace(/\/$/, "") &&
            /^[a-z0-9.-]+$/i.test(url.hostname)
          );
        } catch {
          return false;
        }
      },
      { message: "An allowed origin is a scheme and a host, with any port: https://example.com or http://localhost:8080, or null." },
    ),
  ),
  visitorIdentity: z.enum(VISITOR_IDENTITIES),
  visitorJwtFallback: z.enum(VISITOR_JWT_FALLBACKS),
  /** Write-only: the stored secret is never read back. */
  visitorJwtSecret: z.string().min(16).optional(),
  handoffQueue: z.string().min(1).nullable(),
  /** The person the agent acts as for a visitor (D221); left out, it stays as it is. */
  runAsPersonId: z.uuid().nullable().optional(),
  rateLimitPerVisitor: z.number().int().min(1).max(1_000),
  widgetTitleEn: z.string().trim().max(60).nullable(),
  widgetTitleAr: z.string().trim().max(60).nullable(),
  accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour."),
  welcomeEn: z.string().trim().max(240).nullable(),
  welcomeAr: z.string().trim().max(240).nullable(),
  /** The widget's own settings (widget specification 3.3, D231); left out, each stays as it is. */
  disclaimerEn: z.string().trim().max(400).nullable().optional(),
  disclaimerAr: z.string().trim().max(400).nullable().optional(),
  disclaimerDismissible: z.boolean().optional(),
  quickActions: z.array(quickActionInput).max(12).optional(),
  voiceInput: z.boolean().optional(),
  readAloud: z.boolean().optional(),
  sessionIdleMinutes: z.number().int().min(1).max(1440).optional(),
  progressRetentionMinutes: z.number().int().min(0).max(43_200).optional(),
  version: z.number().int().positive(),
});

export type CreateDeploymentInput = z.infer<typeof createDeploymentInput>;
export type SaveDeploymentInput = z.infer<typeof saveDeploymentInput>;

/** Refuses a key the object does not take, naming it and the keys it does take. */
function onlyKeys(where: string, takes: string, hint = "") {
  return {
    error: (issue: z.core.$ZodRawIssue) =>
      issue.code === "unrecognized_keys"
        ? `${where} does not take ${issue.keys.map((key) => `\`${key}\``).join(", ")}; it takes ${takes}.${hint}`
        : undefined,
  };
}

const choiceShape = { value: z.string(), en: z.string(), ar: z.string() } satisfies Record<keyof Choice, z.ZodType>;

const fieldShape = {
  type: z.enum(FIELD_TYPES),
  labelEn: z.string().optional(),
  labelAr: z.string().optional(),
  placeholder: z.string().optional(),
  pattern: z.string().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),
  step: z.number().optional(),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().min(0).optional(),
  accept: z.array(z.string()).optional(),
  maxSizeMb: z.number().positive().optional(),
  maxFiles: z.number().int().min(1).optional(),
  help: z.string().optional(),
  mask: z.boolean().optional(),
  allowFreeText: z.boolean().optional(),
  example: z.string().optional(),
} satisfies Record<keyof FieldSpec, z.ZodType>;

const presentShape = {
  as: z.enum(["list", "card", "timeline"]),
  rowsAt: z.string().optional(),
  id: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  badge: z.string().optional(),
  label: z.string().optional(),
  ts: z.string().optional(),
  state: z.string().optional(),
} satisfies Record<keyof Presentation, z.ZodType>;

const formFieldShape = {
  key: z.string().min(1),
  labelEn: z.string(),
  labelAr: z.string(),
  dataType: z.string().min(1),
  required: z.boolean(),
  choices: z.array(z.strictObject(choiceShape, onlyKeys("A choice", Object.keys(choiceShape).join(", ")))).optional(),
} satisfies Record<keyof FormField, z.ZodType>;

const branchShape = { slot: z.string().min(1), equals: z.string(), goto: z.string().min(1) };

/** The `config` keys each step type reads; any step also takes `mode`, `onErrorStepName` and `branch`. */
const CONFIG_KEYS: Partial<Record<StepType, (keyof StepConfig)[]>> = {
  Ask: ["choices", "field"],
  Classify: ["choices"],
  Decide: ["branches", "otherwise"],
  Tool: ["present"],
  Form: ["requestTypeCode", "formFields"],
  CreateWork: ["requestTypeCode"],
  Wait: ["waitSeconds"],
  Subflow: ["subflowCode"],
  GoTo: ["gotoStepName"],
};

const MENU =
  " A menu the visitor sees is an Ask step's `choices`; a Decide step shows nothing and routes on a slot with `branches`.";

const stepConfigShape = {
  choices: z
    .array(z.strictObject(choiceShape, onlyKeys("A choice", Object.keys(choiceShape).join(", "))))
    .optional()
    .describe("Ask and Classify: the quick replies the visitor sees as buttons. A reply stores the choice's `value` in the step's slot."),
  mode: z.enum(STORYLINE_MODES).optional().describe("This step's own phase mode, when it differs from the storyline's."),
  field: z
    .strictObject(fieldShape, onlyKeys("`config.field`", Object.keys(fieldShape).join(", "), " A select's options are the step's `config.choices`."))
    .optional()
    .describe("Ask: the typed control the widget shows and the rules the value must meet."),
  present: z.strictObject(presentShape, onlyKeys("`config.present`", Object.keys(presentShape).join(", "))).optional().describe("Tool: how the widget shows the result."),
  branches: z
    .array(z.strictObject(branchShape, onlyKeys("A branch", Object.keys(branchShape).join(", "))))
    .optional()
    .describe("Decide: the first branch whose `slot` holds `equals` (a choice's value) goes to step `goto`."),
  otherwise: z.string().min(1).optional().describe("Decide: the step to go to when no branch matches."),
  gotoStepName: z.string().min(1).optional().describe("GoTo: the step to go to."),
  onErrorStepName: z.string().min(1).optional().describe("The step to go to when this one fails and On error is GoToStep."),
  requestTypeCode: z.string().min(1).optional().describe("Form and CreateWork: the request type raised."),
  formFields: z.array(z.strictObject(formFieldShape, onlyKeys("A form field", Object.keys(formFieldShape).join(", ")))).optional(),
  waitSeconds: z.number().int().min(0).optional(),
  subflowCode: z.string().min(1).optional(),
  branch: z.boolean().optional().describe("Drawn indented in the editor, as a branch target."),
} satisfies Record<keyof StepConfig, z.ZodType>;

/** A step's own settings: a key no step reads is refused rather than stored and ignored. */
export const stepConfigInput = z.strictObject(
  stepConfigShape,
  onlyKeys(
    "A step's `config`",
    [...Object.entries(CONFIG_KEYS).map(([type, keys]) => `${type}: ${keys.join(", ")}`), "any step: mode, onErrorStepName, branch"].join("; "),
    MENU,
  ),
) satisfies z.ZodType<StepConfig>;

export const storylineStepInput = z.object({
  code: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  type: z.enum(STORYLINE_STEP_TYPES),
  messageEn: z.string().trim().max(1_000).nullable(),
  messageAr: z.string().trim().max(1_000).nullable(),
  sendVerbatim: z.boolean(),
  slot: z.string().trim().max(60).nullable(),
  maxAttempts: z.number().int().min(1).max(10).nullable(),
  verifyMethod: z.string().trim().max(40).nullable(),
  handoffQueue: z.string().trim().max(60).nullable(),
  toolRefs: z.array(z.string().min(1)),
  skillRefs: z.array(z.string().min(1)),
  agentCode: z.string().min(1).nullable(),
  nextStepName: z.string().min(1).nullable(),
  onError: z.enum(STORYLINE_ON_ERRORS),
  config: stepConfigInput,
});

export const addStepInput = z.object({
  code: z.string().min(1),
  name: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores."),
  afterName: z.string().min(1).nullable(),
});

export const deleteStepInput = z.object({ code: z.string().min(1), name: z.string().min(1) });
export const deploymentCodeInput = z.object({ code: z.string().min(1) });

/** A further storyline of a deployment, a scenario its quick actions start (D231). */
export const createStorylineInput = z.object({
  code: z.string().min(1),
  storyline: z
    .object({
      code: z.string().trim().regex(/^[a-z0-9_]{2,48}$/, "A storyline code is lowercase letters, digits and underscores."),
      nameEn: z.string().trim().min(1).max(120),
      nameAr: z.string().trim().max(120).default(""),
    })
    .optional(),
});
/** The Conversations screen's takeover actions (D342). */
export const conversationActionInput = z.object({ id: z.uuid() });
export const sendToVisitorInput = z.object({ id: z.uuid(), text: z.string().trim().min(1).max(4000) });
export type ConversationActionInput = z.infer<typeof conversationActionInput>;
export type SendToVisitorInput = z.infer<typeof sendToVisitorInput>;

export const setModeInput = z.object({ code: z.string().min(1), mode: z.enum(STORYLINE_MODES) });
export const simulateInput = z.object({
  code: z.string().min(1),
  variables: z.record(z.string(), z.string()),
  turns: z.array(z.string()).max(20),
});

export type AddStepInput = z.infer<typeof addStepInput>;
export type DeleteStepInput = z.infer<typeof deleteStepInput>;
export type SetModeInput = z.infer<typeof setModeInput>;
export type SimulateInput = z.infer<typeof simulateInput>;
export type StorylineStepInput = z.infer<typeof storylineStepInput>;

export const mirrorRoomInput = z.object({
  roomKey: z.string().min(1),
  type: z.enum(CHANNEL_TYPES),
  /** The provider's identifier for the conversation this room mirrors. */
  externalRef: z.string().trim().min(1).max(200),
});

export type MirrorRoomInput = { roomKey: string; channelType: string; externalRef: string };
