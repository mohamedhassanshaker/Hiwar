import { orgUnitChoices } from "@/features/organisation/service";
import { audit } from "@/lib/audit";
import { requireOrganisationPermission, requireOrgUnitPermission, requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { AgentRejected } from "./errors";
import { agentRouteId, requireAgentPermission } from "./version-service";

/** Initials from a name, as the avatar shows them when no photo exists. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

/**
 * `UC-50.2-01`: create an agent. Its detail opens on Instructions, which is what a new
 * agent has nothing of yet.
 *
 * `UC-50.2-02` refuses a missing name or a code already taken. The code is unique by index,
 * so the database is what enforces it; the check here turns that into a message a person
 * can act on rather than a constraint violation.
 *
 * `UC-50.2-04`: `System` is not an assignable trust. The schema refuses it before this is
 * reached.
 *
 * @throws {AgentRejected} when the code is taken, the org unit or route does not exist, or the
 * route is not a chat route.
 */
export async function createAgent(input: {
  code: string;
  nameEn: string;
  nameAr: string;
  orgUnitId: string | null;
  profile: string;
  trust: string;
  routeAlias: string;
  /** Attached to the agent's own first version — live from the moment it is created. */
  skillVersionIds?: string[];
}): Promise<string> {
  // In the org unit it is created in, or organisation-wide for none (`UC-41.2-03`).
  const session = input.orgUnitId
    ? await requireOrgUnitPermission("agents:write", input.orgUnitId)
    : await requireOrganisationPermission("agents:write");

  const taken = await repository.existingAgentCodes();
  if (taken.has(input.code.toLowerCase())) {
    throw new AgentRejected("That code is already in use.", "هذا الرمز مستخدم بالفعل.");
  }

  const primaryRouteId = await agentRouteId(input.routeAlias);

  await repository.insertAgent({
    code: input.code,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    initials: initialsOf(input.nameEn),
    orgUnitId: input.orgUnitId,
    profile: input.profile,
    trust: input.trust,
    primaryRouteId,
    skillVersionIds: input.skillVersionIds,
    createdBy: session.personId,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "Agent",
    objectLabel: input.code,
    detail: { created: true, profile: input.profile, trust: input.trust },
  });
  return input.code;
}

/** What the New Agent form offers: the org units and the chat routes an agent may run on. */
export async function loadAgentChoices() {
  await requirePermission("agents:read");
  const [units, routes] = await Promise.all([orgUnitChoices(), repository.routeAliases()]);
  return { units, routes };
}

/**
 * Deletes an agent that has never been used. Its own configuration — versions, skills, tool
 * modes, budget, client exposure and connector access — is removed with it; anything that
 * represents a real use (a run, an embedded deployment's default, a memory review it
 * proposed, a memory scope of its own, a storyline step overriding to it, or someone
 * reporting to it) refuses the delete, with what is in the way, the same as `UC-42.1-04`
 * refuses an org unit still in use.
 *
 * @throws {AgentRejected} when the agent no longer exists or is in use.
 */
export async function deleteAgent(code: string): Promise<void> {
  const session = await requireAgentPermission("agents:publish", code);

  const agent = await repository.readRunnableAgent(code);
  if (!agent) throw new AgentRejected("That agent no longer exists.", "لم يعد هذا الوكيل موجوداً.");

  // D65: the built-in agent cannot be deleted. The AI Assistant panel always runs it, so
  // deleting it would take a product surface with it. Refused here rather than only
  // hidden in the UI, because a hidden button is not a control.
  if (await repository.isBuiltinAgent(code)) {
    throw new AgentRejected(
      `${agent.code} is the platform's built-in assistant and cannot be deleted. Its skills, tools, knowledge, memory, model and budgets can all be changed instead.`,
      `${agent.code} هو مساعد المنصة المدمج ولا يمكن حذفه. يمكن تغيير مهاراته وأدواته ومعرفته وذاكرته ونموذجه وميزانياته بدلاً من ذلك.`,
    );
  }

  const blockers = await repository.agentDeleteBlockers(agent.id);
  // The runs by key, so the person or the agent asking can delete them (`run_delete`).
  const more = blockers.runs - blockers.runKeys.length;
  const runKeys = blockers.runKeys.join(", ");
  const inUse = [
    blockers.runs && `${blockers.runs} runs (${runKeys}${more > 0 ? ` and ${more} more` : ""})`,
    blockers.reports && `${blockers.reports} reporting to it`,
    blockers.embeddedDeployments && `${blockers.embeddedDeployments} embedded deployments`,
    blockers.memoryReviews && `${blockers.memoryReviews} memory reviews`,
    blockers.memoryScopes && `${blockers.memoryScopes} memory scopes`,
    blockers.storylineSteps && `${blockers.storylineSteps} storyline steps`,
  ].filter(Boolean);
  const inUseAr = [
    blockers.runs && `${blockers.runs} عملية (${runKeys}${more > 0 ? ` و${more} أخرى` : ""})`,
    blockers.reports && `${blockers.reports} تابعين له`,
    blockers.embeddedDeployments && `${blockers.embeddedDeployments} عمليات نشر مضمّنة`,
    blockers.memoryReviews && `${blockers.memoryReviews} مراجعات ذاكرة`,
    blockers.memoryScopes && `${blockers.memoryScopes} نطاقات ذاكرة`,
    blockers.storylineSteps && `${blockers.storylineSteps} خطوات سيناريو`,
  ].filter(Boolean);

  if (inUse.length) {
    throw new AgentRejected(
      `This agent cannot be deleted: it still has ${inUse.join(", ")}.`,
      `لا يمكن حذف هذا الوكيل: لا يزال لديه ${inUseAr.join("، ")}.`,
    );
  }

  await repository.deleteAgent(agent.id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:delete",
    objectType: "Agent",
    objectLabel: code,
  });
}
