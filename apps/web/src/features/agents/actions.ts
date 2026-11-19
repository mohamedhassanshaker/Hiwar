"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  activateVersionInput,
  cancelRunInput,
  stopOwnRunInput,
  createAgentInput,
  deleteAgentInput,
  knowledgeAccessInput,
  memoryAccessInput,
  publishInput,
  replayInput,
  saveDraftInput,
  runBudgetInput,
  setTrustInput,
  skillInput,
  toolModeInput,
  revokeToolInput,
  grantConnectorInput,
  changeToolGrantInput,
  changeSkillsInput,
} from "./schema";
import * as service from "./service";

/** S-50 to S-52 mutations. */

/** `UC-51.1-05`: the agent's own run budget, soft and hard. */
export async function setRunBudget(input: unknown): Promise<Outcome<number>> {
  const outcome = await attempt(() => service.setRunBudget(runBudgetInput.parse(input)));
  revalidatePath("/agents");
  return outcome;
}

/**
 * `UC-51.1-04`: change an agent's trust through `service.setTrust`. Returns the outcome with the
 * active version's new lock, or the refusal, and refreshes `/agents`.
 */
export async function setTrust(input: unknown): Promise<Outcome<number>> {
  const outcome = await attempt(() => service.setTrust(setTrustInput.parse(input)));
  revalidatePath("/agents");
  return outcome;
}

/** `UC-51.4-04`: roll back to an older version, or say why it was refused. */
export async function activateVersion(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.activateVersion(activateVersionInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentNotEditable || error instanceof service.AgentRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr };
    }
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** `UC-52.1-05`: stop a run after its current step. */
export async function cancelRun(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  await service.cancelRun(cancelRunInput.parse(input).key);
  revalidatePath("/agents/runs");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** D300: delete a finished run. */
export async function deleteRun(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.deleteRun(cancelRunInput.parse(input).key);
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents/runs");
  revalidatePath("/agents");
  return { ok: true };
}

/** D67: the assistant panel's Stop, for the run its own person started. */
export async function stopOwnRun(input: unknown): Promise<void> {
  await service.stopOwnRun(stopOwnRunInput.parse(input).runId);
}

/** What the typed fields are called, for a refusal that names the field instead of a thrown 500 (`COM-12`). */
const FIELDS: FieldNames = {
  code: ["The code", "الرمز"],
  nameEn: ["The English name", "الاسم بالإنجليزية"],
  nameAr: ["The Arabic name", "الاسم بالعربية"],
  instructions: ["The instructions", "التعليمات"],
  releaseNotes: ["The release notes", "ملاحظات الإصدار"],
};

/** `UC-50.2-01` and `UC-50.2-02`: create an agent, or say why not. */
export async function createAgent(
  input: unknown,
): Promise<{ ok: true; code: string } | { ok: false; message: string; messageAr: string }> {
  const parsed = createAgentInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  let code: string;
  try {
    code = await service.createAgent(parsed.data);
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true, code };
}

/** `UC-51.1-03`, `UC-51.2-01`: save a change to the agent's draft revision. */
export async function saveDraft(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = saveDraftInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.saveDraft(parsed.data);
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** `UC-51.2-03`, `UC-51.2-04`: set a tool's mode, within what its tier allows. */
export async function setToolMode(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.setToolMode(toolModeInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** Take one connector tool off the draft's grant. */
export async function revokeTool(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.revokeTool(revokeToolInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** Grant the draft every tool of one connector, a read at Auto and anything else at Approval (D264). */
export async function grantConnector(
  input: unknown,
): Promise<{ ok: true; added: number } | { ok: false; message: string; messageAr: string }> {
  let added: number;
  try {
    added = await service.grantConnector(grantConnectorInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true, added };
}

/** D238: several tools granted and taken away at once. */
export async function changeToolGrant(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.changeToolGrant(changeToolGrantInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** D238: several skills added and taken away at once. */
export async function changeSkills(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.changeSkills(changeSkillsInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** `UC-51.2-02`: add a skill to the draft, or take it away. */
export async function setSkill(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.setSkill(skillInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** Grant the draft a knowledge collection to read, or take it away. */
export async function setKnowledgeAccess(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.setKnowledgeAccess(knowledgeAccessInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** Grant the draft a memory scope to read or write, or take it away. */
export async function setMemoryAccess(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.setMemoryAccess(memoryAccessInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

/** `UC-51.3-02` … `-04`: publish the draft, or say why it cannot be published. */
export async function publishVersion(
  input: unknown,
): Promise<{ ok: true; version: number } | { ok: false; message: string; messageAr: string }> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  let version: number;
  try {
    version = await service.publishVersion(parsed.data);
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true, version };
}

/** Deletes an agent that has never been used, or says what is still using it. */
export async function deleteAgent(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteAgent(deleteAgentInput.parse(input).code));
  revalidatePath("/agents");
  return outcome;
}

/** `UC-52.1-06`: replay a run, returning the key of the new one. */
export async function replayRun(
  input: unknown,
): Promise<{ ok: true; key: string } | { ok: false; message: string; messageAr: string }> {
  const values = replayInput.parse(input);
  try {
    return { ok: true, key: await service.replayRun(values) };
  } catch (error) {
    if (error instanceof service.AgentRejected || error instanceof service.RunNotStarted) {
      return { ok: false, message: error.message, messageAr: error.messageAr };
    }
    throw error;
  }
}

export type { ToolConfiguration } from "./tool-configuration-service";

const platformToolInput = z.object({
  code: z.string().trim().min(1),
  tool: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
});

/** D38, D80: grant the draft one platform or harness tool, or take it away. */
export async function setPlatformTool(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.setPlatformTool(platformToolInput.parse(input));
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}

const resetBuiltinInput = z.object({ code: z.string().trim().min(1) });

/**
 * D65: put the built-in Assistant's draft back to the configuration it shipped with.
 *
 * Needs `agents:configure`, which the service checks: this is the one agent the platform
 * itself depends on, so changing it is a different right from designing an agent.
 */
export async function resetBuiltinToDefaults(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  try {
    await service.resetBuiltinToDefaults(resetBuiltinInput.parse(input).code);
  } catch (error) {
    if (error instanceof service.AgentRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath("/agents");
  return { ok: true };
}
