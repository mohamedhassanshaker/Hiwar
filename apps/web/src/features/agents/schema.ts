import { z } from "zod";

import { AGENT_TOOL_MODES, AGENT_TRUSTS, EXECUTION_PROFILES, MEMORY_ACCESSES, RUN_STATUSES } from "@/db/schema/enums";

/** Requirement 32: the agent action inputs. */

/**
 * `UC-50.2-04`: `System` is the platform's own level and is not offered.
 *
 * Refused at the schema, not hidden in the picker: the trust level decides which tools an
 * agent may call and whether it may assign work, so "not offered" has to mean "not
 * accepted" (`COM-08`).
 */
export const ASSIGNABLE_AGENT_TRUSTS = AGENT_TRUSTS.filter((trust) => trust !== "System");

export const setTrustInput = z.object({
  code: z.string().min(1),
  trust: z.enum(ASSIGNABLE_AGENT_TRUSTS as unknown as [string, ...string[]]),
  version: z.number().int().positive(),
});

export const activateVersionInput = z.object({
  code: z.string().min(1),
  versionNumber: z.number().int().positive(),
});

/**
 * `UC-51.1-05`: the run budget, where the soft limit may not exceed the hard limit.
 *
 * The two mean different things — soft warns, hard stops — so a soft limit above the hard
 * one is not a stricter setting, it is an unreachable one: the run ends before the warning
 * can fire. Refused at the schema so it cannot be saved from anywhere.
 *
 * Either limit may be cleared, which is an agent with no budget of its own.
 */
export const runBudgetInput = z
  .object({
    code: z.string().min(1),
    soft: z.number().nonnegative().nullable(),
    hard: z.number().nonnegative().nullable(),
    version: z.number().int().positive(),
  })
  .refine((input) => input.soft === null || input.hard === null || input.soft <= input.hard, {
    message: "The soft limit cannot be above the hard limit: the run would stop before it warned.",
    path: ["soft"],
  });

export const cancelRunInput = z.object({ key: z.string().min(1) });
/** `run_list`: newest first, optionally one agent's or one status's, at most 200 at a time. */
export const runListInput = z.object({
  agentCode: z.string().trim().min(1).optional(),
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const stopOwnRunInput = z.object({ runId: z.uuid() });

export type SetTrustInput = z.infer<typeof setTrustInput>;
export type RunBudgetInput = z.infer<typeof runBudgetInput>;
export type ActivateVersionInput = z.infer<typeof activateVersionInput>;

/**
 * `UC-50.2-01`: a new agent.
 *
 * `UC-50.2-02`: a name is required and the code has the shape every code on this platform
 * has. `UC-50.2-04`: `System` is absent from the assignable trusts, so a form cannot send
 * it however it was built.
 */
export const createAgentInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, "A code is required.")
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, digits, hyphen or underscore."),
  nameEn: z.string().trim().min(1, "An English name is required.").max(120),
  nameAr: z.string().trim().min(1, "An Arabic name is required.").max(120),
  orgUnitId: z.uuid().nullable().default(null),
  profile: z.enum(EXECUTION_PROFILES as unknown as [string, ...string[]]),
  trust: z.enum(ASSIGNABLE_AGENT_TRUSTS as unknown as [string, ...string[]]),
  routeAlias: z.string().trim().min(1),
});

/** `UC-51.1-03` and `UC-51.2-01`: a change to the agent's draft revision. */
export const saveDraftInput = z.object({
  code: z.string().trim().min(1),
  instructions: z.string().max(20_000).optional(),
  executionProfile: z.enum(EXECUTION_PROFILES as unknown as [string, ...string[]]).optional(),
  primaryRouteAlias: z.string().trim().min(1).optional(),
  fallbackRouteAlias: z.string().trim().min(1).nullable().optional(),
  memoryEnabled: z.boolean().optional(),
});

/** `UC-51.2-03`: how the agent may call one tool. */
export const toolModeInput = z.object({
  code: z.string().trim().min(1),
  connectorToolId: z.uuid(),
  mode: z.enum(AGENT_TOOL_MODES as unknown as [string, ...string[]]),
});

export const revokeToolInput = z.object({ code: z.string().trim().min(1), connectorToolId: z.uuid() });

export const grantConnectorInput = z.object({ code: z.string().trim().min(1), connectorCode: z.string().trim().min(1) });

/** D238: the Connector tools popup's change, as one set of additions and removals. */
export const changeToolGrantInput = z.object({
  code: z.string().trim().min(1),
  grantPlatform: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  revokePlatform: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  grantTools: z.array(z.uuid()).max(1000).default([]),
  revokeTools: z.array(z.uuid()).max(1000).default([]),
});

/** D238: the Skills popup's change. */
export const changeSkillsInput = z.object({
  code: z.string().trim().min(1),
  add: z.array(z.uuid()).max(200).default([]),
  remove: z.array(z.uuid()).max(200).default([]),
});

/** `UC-51.2-02`: a skill on or off. */
export const skillInput = z.object({
  code: z.string().trim().min(1),
  skillVersionId: z.uuid(),
  enabled: z.boolean(),
});

/** A knowledge collection on or off: what `knowledge_search` may read for this agent. */
export const knowledgeAccessInput = z.object({
  code: z.string().trim().min(1),
  collectionId: z.uuid(),
  enabled: z.boolean(),
});

/** A memory scope's access for this agent: Read, ReadWrite, or none (revoked). */
export const memoryAccessInput = z.object({
  code: z.string().trim().min(1),
  memoryScopeId: z.uuid(),
  access: z.enum(MEMORY_ACCESSES).nullable(),
});

/** `UC-51.3-02`: publish the draft. `UC-51.3-03` requires the notes. */
export const publishInput = z.object({
  code: z.string().trim().min(1),
  releaseNotes: z.string().trim().min(1, "Release notes are required.").max(2_000),
});

export const deleteAgentInput = z.object({
  code: z.string().trim().min(1),
});

/** `UC-51.3-01`: the sample input a playground test runs on. */
export const testAgentInput = z.object({
  code: z.string().trim().min(1),
  prompt: z.string().trim().min(1, "Enter a sample input.").max(4_000),
});

/** `UC-52.1-06`: which run to replay, and from where. */
export const replayInput = z.object({
  key: z.string().trim().min(1),
  fromStep: z.number().int().min(0).nullable().default(null),
  reason: z.string().trim().max(500).optional(),
});
