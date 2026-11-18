import { z } from "zod";

import {
  ATTRIBUTE_DATA_TYPES,
  AUDIENCE_ACCESSES,
  DECOMPOSITIONS,
  ENTRY_MODES,
  INTAKE_CHANNELS,
  PRINCIPAL_TYPES,
  REQUEST_ENTRY_MODES,
  REQUEST_STEP_OUTCOMES,
  ROUTING_RULE_KINDS,
  SLA_UNITS,
} from "@/db/schema/enums";

/** Requirement 32: the request action inputs. Dynamic attributes are checked separately. */

export const createRequestInput = z.object({
  projectKey: z.string().min(1),
  requestTypeCode: z.string().min(1),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().max(4000).optional(),
  entryMode: z.enum(REQUEST_ENTRY_MODES),
  /** The dynamic attributes of the pinned version, validated against its schema. */
  attributes: z.record(z.string(), z.string()),
  /** Raises it as a sub request of this one, which the person has to be able to see. */
  parentKey: z.string().trim().min(1).optional(),
  /** The discussion room it is raised from, when it comes out of one of its messages. */
  originRoomKey: z.string().trim().min(1).optional(),
});

export const publishRequestTypeInput = z.object({ code: z.string().min(1) });
/** `withRequests` deletes the type's requests and their history with it; irreversible. */
export const deleteRequestTypeInput = z.object({ code: z.string().trim().min(1), withRequests: z.boolean().default(false) });
export const requestTypeReadInput = z.object({ code: z.string().trim().min(1), version: z.enum(["Draft", "Published"]).default("Published") });

export type CreateRequestInput = z.infer<typeof createRequestInput>;
export type PublishRequestTypeInput = z.infer<typeof publishRequestTypeInput>;

/* ------------------------------------------- S-30: what the request type designer writes */

/** `UC-27.2-02`: a new request type, which opens on its first draft. */
export const createRequestTypeInput = z.object({
  code: z.string().trim().min(2).max(12).regex(/^[A-Z0-9-]+$/, "Use capitals, digits and hyphens."),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  categoryEn: z.string().trim().min(1).max(60),
  decomposition: z.enum(DECOMPOSITIONS),
});

/** `UC-30.1-01` and `-02`: the draft's general settings. */
export const saveDraftInput = z.object({
  code: z.string().trim().min(1),
  /** `UC-30.1-01`: the category the list groups the type under. */
  categoryEn: z.string().trim().min(1).max(80),
  decomposition: z.enum(DECOMPOSITIONS),
  slaValue: z.number().int().positive().nullable(),
  slaUnit: z.enum(SLA_UNITS).nullable(),
  defaultProjectKey: z.string().trim().min(1).nullable(),
  intakeChannels: z.array(z.enum(INTAKE_CHANNELS)).min(1),
  // `UC-30.1-02`: a type nobody can enter a request through cannot be saved.
  entryModes: z.array(z.enum(ENTRY_MODES)).min(1, "Select at least one entry mode"),
});

export const stepInput = z.object({
  code: z.string().trim().min(1),
  nameEn: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(80),
  slaValue: z.number().int().positive().nullable().default(null),
  slaUnit: z.enum(SLA_UNITS).nullable().default(null),
});

export const stepRefInput = z.object({
  code: z.string().trim().min(1),
  stepName: z.string().trim().min(1),
});

/**
 * `UC-30.2`: one step, edited as a patch.
 *
 * Every field is optional and at least one must be present, so an edit says exactly what
 * it changes and nothing else: an omitted field is unchanged, and an explicit `null`
 * clears it. `.strict()` refuses a field nobody declared rather than dropping it quietly,
 * which is what stops a model inventing a column name and believing the write worked.
 *
 * `expectedVersion` is required. Two writers on one step is the ordinary case once an
 * agent is editing alongside a person, and a patch written against what the agent read a
 * minute ago must not overwrite what somebody saved since.
 */
export const updateStepInput = stepRefInput
  .extend({
    expectedVersion: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(80).optional(),
    nameAr: z.string().trim().min(1).max(80).optional(),
    slaValue: z.number().int().positive().max(10_000).nullable().optional(),
    slaUnit: z.enum(SLA_UNITS).nullable().optional(),
    /** Sensitive: a terminal step loses its audiences and its outgoing rules. */
    isTerminal: z.boolean().optional(),
    terminalOutcome: z.enum(REQUEST_STEP_OUTCOMES).optional(),
    /** Where the step sits, from 1. The first step is where a new request starts. */
    position: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      ["nameEn", "nameAr", "slaValue", "slaUnit", "isTerminal", "terminalOutcome", "position"].some(
        (field) => field in patch,
      ),
    { message: "An edit has to change something: name one field." },
  );

/** `UC-30.1-01`: a step's own clock, a count and the interval it counts. */
export const setStepSlaInput = stepRefInput.extend({
  slaValue: z.number().int().positive().max(10_000).nullable(),
  slaUnit: z.enum(SLA_UNITS).nullable(),
});

export const setStepTerminalInput = stepRefInput.extend({
  terminal: z.boolean(),
  /** What a request is left as when it ends here. Only meaningful when `terminal` is true. */
  outcome: z.enum(REQUEST_STEP_OUTCOMES).default("Completed"),
});

/** `UC-30.2-01`: move a step up or down the draft's ordered list. */
export const moveStepInput = stepRefInput.extend({
  position: z.number().int().positive().max(200),
});

export const deleteStepInput = stepRefInput.extend({
  /** `UC-30.2-09`: sent once the rules that point at the step have been shown. */
  confirmed: z.boolean().default(false),
});

export const audienceInput = stepRefInput.extend({
  principalType: z.enum([...PRINCIPAL_TYPES, "Requester"]),
  /** A person (id or email), agent (id or code), group or role (id, code or name); absent for `Requester`. */
  principalId: z.string().trim().min(1).nullable().default(null),
  access: z.enum(AUDIENCE_ACCESSES),
  /** `UC-29.2-05`: the order a sequential audience acts in. */
  sequence: z.number().int().positive().nullable().default(null),
});

export const ruleInput = stepRefInput.extend({
  kind: z.enum(ROUTING_RULE_KINDS),
  expression: z.string().trim().max(200).nullable().default(null),
  actionName: z.string().trim().max(60).nullable().default(null),
  toStepName: z.string().trim().min(1).nullable().default(null),
});

/** An audience or a routing rule of a draft step, by its 1-based position in the step's list. */
export const stepEntryInput = stepRefInput.extend({ position: z.number().int().positive() });

/** D309: a routing rule of a draft step, by its 1-based position. Name only the fields to change. */
export const updateRuleInput = stepEntryInput
  .extend({
    kind: z.enum(ROUTING_RULE_KINDS).optional(),
    expression: z.string().trim().max(200).nullable().optional(),
    actionName: z.string().trim().max(60).nullable().optional(),
    toStepName: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((patch) => ["kind", "expression", "actionName", "toStepName"].some((field) => field in patch), {
    message: "An edit has to change something: name one field.",
  });

/** One choice of a list attribute: the value stored on a request, and its label in each language. */
export const attributeOptionInput = z.object({
  value: z.string().trim().min(1).max(120),
  labelEn: z.string().trim().min(1).max(120),
  labelAr: z.string().trim().min(1).max(120),
});

export const attributeInput = z
  .object({
    code: z.string().trim().min(1),
    key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "Use lower case, digits and underscores."),
    labelEn: z.string().trim().min(1).max(120),
    labelAr: z.string().trim().min(1).max(120),
    dataType: z.enum(ATTRIBUTE_DATA_TYPES),
    required: z.boolean().default(false),
    /** `Enum`'s choices, required for it and ignored for every other data type. */
    enumValues: z.array(attributeOptionInput).max(100).nullable().optional(),
    /** The step the attribute is asked at; null is the request form. */
    stepName: z.string().trim().min(1).nullable().default(null),
  })
  .refine((input) => input.dataType !== "Enum" || (input.enumValues?.length ?? 0) > 0, {
    message: "A list needs at least one choice.",
    path: ["enumValues"],
  })
  .refine((input) => new Set((input.enumValues ?? []).map((option) => option.value)).size === (input.enumValues ?? []).length, {
    message: "Each choice needs its own value.",
    path: ["enumValues"],
  });

/**
 * D304: one attribute of the draft, edited as a patch. The key is how requests store the value,
 * so it is not changed; a field left out is unchanged and `stepName: null` moves it to the form.
 * `position` (from 1) is its place in the order the form and the steps ask attributes in.
 */
export const updateAttributeInput = z
  .object({
    code: z.string().trim().min(1),
    key: z.string().trim().min(1),
    labelEn: z.string().trim().min(1).max(120).optional(),
    labelAr: z.string().trim().min(1).max(120).optional(),
    dataType: z.enum(ATTRIBUTE_DATA_TYPES).optional(),
    required: z.boolean().optional(),
    enumValues: z.array(attributeOptionInput).max(100).nullable().optional(),
    stepName: z.string().trim().min(1).nullable().optional(),
    position: z.number().int().positive().max(500).optional(),
  })
  .strict()
  .refine(
    (patch) => ["labelEn", "labelAr", "dataType", "required", "enumValues", "stepName", "position"].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  )
  .refine((input) => new Set((input.enumValues ?? []).map((option) => option.value)).size === (input.enumValues ?? []).length, {
    message: "Each choice needs its own value.",
    path: ["enumValues"],
  });

export const removeAttributeInput = z.object({
  code: z.string().trim().min(1),
  key: z.string().trim().min(1),
});

/* ------------------------------------------ S-29: what a person does to a request's step */

/** `UC-29.2-01` … `-03`: the act somebody takes on the step a request is at. */
export const stepActionInput = z.object({
  key: z.string().trim().min(1),
  /** The action named by a routing rule out of the current step, e.g. `Approve`. */
  action: z.string().trim().min(1).max(60),
  comment: z.string().trim().max(2000).optional(),
  /** Names of files already attached to the request that go with this decision (D218). */
  attachments: z.array(z.string().trim().min(1)).max(10).optional(),
  /** Values for the attributes the current step asks, checked against their definitions (D304). */
  attributes: z.record(z.string(), z.string()).optional(),
});

/** A decision every step offers, Return or Reject: why is required, files may go with it. */
export const decisionInput = z.object({
  key: z.string().trim().min(1),
  comment: z.string().trim().min(1).max(2000),
  attachments: z.array(z.string().trim().min(1)).max(10).optional(),
});

export const assignRequestToAgentInput = z.object({
  key: z.string().trim().min(1),
  agentCode: z.string().trim().min(1),
});

export const requestKeyInput = z.object({ key: z.string().trim().min(1) });

export type CreateRequestTypeInput = z.infer<typeof createRequestTypeInput>;
export type SaveDraftInput = z.infer<typeof saveDraftInput>;
export type StepInput = z.infer<typeof stepInput>;
export type UpdateStepInput = z.infer<typeof updateStepInput>;
export type SetStepSlaInput = z.infer<typeof setStepSlaInput>;
export type SetStepTerminalInput = z.infer<typeof setStepTerminalInput>;
export type DeleteStepInput = z.infer<typeof deleteStepInput>;
export type MoveStepInput = z.infer<typeof moveStepInput>;
export type AudienceInput = z.infer<typeof audienceInput>;
export type RuleInput = z.infer<typeof ruleInput>;
export type StepEntryInput = z.infer<typeof stepEntryInput>;
export type UpdateRuleInput = z.infer<typeof updateRuleInput>;
export type AttributeInput = z.infer<typeof attributeInput>;
export type UpdateAttributeInput = z.infer<typeof updateAttributeInput>;
export type RemoveAttributeInput = z.infer<typeof removeAttributeInput>;
export type StepActionInput = z.infer<typeof stepActionInput>;
export type AssignRequestToAgentInput = z.infer<typeof assignRequestToAgentInput>;
