import { CHAT_ROUTE_KINDS } from "@/db/schema/enums";
import { audit } from "@/lib/audit";
import type { PermissionCode } from "@/authz/permissions";
import { requireOrganisationPermission, requireOrgUnitPermission, requirePermission, type Session } from "@/lib/session";
import * as repository from "./repository";
import { AgentRejected } from "./errors";

/**
 * The loosest mode a tool of each tier may be given (`UC-51.2-03`, `UC-51.2-04`).
 *
 * The connector's tier is the ceiling and an agent's mode may only be stricter. T2 and
 * above are the calls that change something outside the platform or cost money, so the
 * most they can be is Approval — "Auto for a T2 tool" is a person deciding that an agent
 * may act irreversibly without anyone seeing it first.
 */
const LOOSEST_MODE: Record<string, "Auto" | "Approval" | "Denied"> = {
  T0: "Auto",
  T1: "Auto",
  T2: "Approval",
  T3: "Approval",
};

/** How strict each mode is, so "looser than" is a comparison and not a list of cases. */
const STRICTNESS: Record<string, number> = { Auto: 0, Approval: 1, Denied: 2 };

/**
 * The route an agent may run on, by alias: a chat route (Standard or Typesafe). An Embedding,
 * Voice or Decision route does not answer chat completions, so every run on it would fail.
 *
 * @throws {AgentRejected} when the route does not exist or is not a chat route.
 */
export async function agentRouteId(alias: string): Promise<string> {
  const route = await repository.routeByAlias(alias);
  if (!route) throw new AgentRejected("That model route no longer exists.", "لم يعد مسار النموذج هذا موجوداً.");
  if (!(CHAT_ROUTE_KINDS as readonly string[]).includes(route.kind)) {
    throw new AgentRejected(
      `${alias} is a ${route.kind} route, which an agent cannot run on. Choose a route whose kind is Standard or Typesafe.`,
      `${alias} مسار من نوع ${route.kind} لا يمكن للوكيل العمل عليه. اختر مساراً من نوع Standard أو Typesafe.`,
    );
  }
  return route.id;
}

/** The draft revision of an agent, created from the active version if there is none. */
async function draftOf(code: string, personId: string): Promise<string> {
  const versionId = await repository.draftVersionId(code, personId);
  if (!versionId) throw new AgentRejected("That agent no longer exists.", "لم يعد هذا الوكيل موجوداً.");
  return versionId;
}

/**
 * The privilege one agent's configuration needs (D100, Q-A settled).
 *
 * `agents:write` is "design agents". Changing the one agent the platform itself depends
 * on is a different authority, so the built-in Assistant also needs `agents:configure`
 * — checked here, at the resource, because a control the UI hides is not a control.
 */
async function requireConfigure(code: string): Promise<Session> {
  const session = await requireAgentPermission("agents:write", code);
  if (await repository.isBuiltinAgent(code)) {
    return requireAgentPermission("agents:configure", code);
  }
  return session;
}

/**
 * `permission` in the agent's own org unit, or organisation-wide for an agent in none
 * (`UC-41.2-03`). An unknown code gets the plain check, so the caller says it does not exist.
 */
export async function requireAgentPermission(permission: PermissionCode, code: string): Promise<Session> {
  const agent = await repository.agentOrgUnit(code);
  if (!agent) return requirePermission(permission);
  return agent.orgUnitId ? requireOrgUnitPermission(permission, agent.orgUnitId) : requireOrganisationPermission(permission);
}

/**
 * `UC-51.1-03`, `UC-51.2-01`: apply the given fields to the agent's draft revision, creating the
 * draft from the active version when there is none. Only fields present in `input` change; a
 * null fallback route clears it. Requires `agents:write`, and `agents:configure` for the built-in
 * Assistant; writes an audit entry naming the changed fields.
 *
 * Saved onto a draft revision, never onto the version that is running: a run in flight is
 * executing the published version, and editing it underneath would change what it is doing
 * halfway through. `UC-51.3-02` is what makes a draft the live one.
 *
 * @throws {AgentRejected} when the agent no longer exists, or a named model route does not exist
 * or is not a chat route.
 */
export async function saveDraft(input: {
  code: string;
  instructions?: string;
  executionProfile?: string;
  primaryRouteAlias?: string;
  fallbackRouteAlias?: string | null;
  memoryEnabled?: boolean;
}): Promise<void> {
  const session = await requireConfigure(input.code);

  const values: Parameters<typeof repository.updateDraftVersion>[1] = {};
  if (input.instructions !== undefined) values.instructions = input.instructions;
  if (input.executionProfile !== undefined) values.executionProfile = input.executionProfile;
  if (input.memoryEnabled !== undefined) values.memoryEnabled = input.memoryEnabled;

  for (const [alias, field] of [
    [input.primaryRouteAlias, "primaryRouteId"],
    [input.fallbackRouteAlias, "fallbackRouteId"],
  ] as const) {
    if (alias === undefined) continue;
    values[field] = alias === null ? null : await agentRouteId(alias);
  }

  // After the routes are checked, so a refused save leaves no draft behind.
  const versionId = await draftOf(input.code, session.personId);
  await repository.updateDraftVersion(versionId, values, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { changed: Object.keys(values) },
  });
}

/**
 * `UC-51.2-03`: how this agent may call one tool. `UC-51.2-04` refuses a mode looser than
 * the connector's tier allows.
 *
 * @throws {AgentRejected} when the mode is looser than the tier permits.
 */
export async function setToolMode(input: {
  code: string;
  connectorToolId: string;
  mode: string;
}): Promise<void> {
  const session = await requireConfigure(input.code);

  const tier = await repository.connectorToolTier(input.connectorToolId);
  if (!tier) throw new AgentRejected("That tool no longer exists.", "لم تعد هذه الأداة موجودة.");

  const loosest = LOOSEST_MODE[tier] ?? "Approval";
  if (STRICTNESS[input.mode] < STRICTNESS[loosest]) {
    throw new AgentRejected(
      `A ${tier} tool cannot be looser than ${loosest}.`,
      `لا يمكن أن تكون أداة ${tier} أوسع من ${loosest}.`,
    );
  }

  const versionId = await draftOf(input.code, session.personId);
  await repository.setToolMode(versionId, input.connectorToolId, input.mode, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { tool: input.connectorToolId, mode: input.mode, tier },
  });
}

/** Take one connector tool off the draft's grant (`UC-51.2-03`). */
export async function revokeTool(input: { code: string; connectorToolId: string }): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  await repository.revokeTool(versionId, input.connectorToolId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { tool: input.connectorToolId, revoked: true },
  });
}

/**
 * Grant the draft every available tool of one connector it does not hold yet, a read at
 * Auto and anything else at Approval (`UC-51.2-03`, D264). A tool already granted keeps its mode.
 */
export async function grantConnector(input: { code: string; connectorCode: string }): Promise<number> {
  const session = await requireConfigure(input.code);
  const toolIds = await repository.availableToolIdsOf(input.connectorCode);
  if (!toolIds.length) {
    throw new AgentRejected("That connector has no tools to grant.", "لا توجد أدوات لهذا التكامل لمنحها.");
  }
  const versionId = await draftOf(input.code, session.personId);
  const added = await repository.grantTools(versionId, toolIds, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { connector: input.connectorCode, toolsAdded: added },
  });
  return added;
}

/**
 * Grant or remove one platform tool on the agent's draft revision, with an audit entry.
 * Requires `agents:write`, and `agents:configure` for the built-in Assistant.
 *
 * @throws {AgentRejected} when the agent no longer exists.
 */
export async function setPlatformTool(input: {
  code: string;
  tool: string;
  enabled: boolean;
}): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  await repository.setPlatformTool(versionId, input.tool, input.enabled, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { platformTool: input.tool, enabled: input.enabled },
  });
}

/**
 * `UC-51.2-03`: tools granted and taken away together, from the Connector tools popup (D238).
 * A connector tool is granted at Auto when it reads and at Approval otherwise (D264), and one
 * already granted keeps its mode. One draft revision and one audit entry for the whole change.
 */
export async function changeToolGrant(input: {
  code: string;
  grantPlatform: string[];
  revokePlatform: string[];
  grantTools: string[];
  revokeTools: string[];
}): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  for (const tool of input.grantPlatform) await repository.setPlatformTool(versionId, tool, true, session.personId);
  for (const tool of input.revokePlatform) await repository.setPlatformTool(versionId, tool, false, session.personId);
  await repository.grantTools(versionId, input.grantTools, session.personId);
  for (const tool of input.revokeTools) await repository.revokeTool(versionId, tool);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: {
      platformAdded: input.grantPlatform,
      platformRemoved: input.revokePlatform,
      toolsAdded: input.grantTools,
      toolsRemoved: input.revokeTools,
    },
  });
}

/** `UC-51.2-02`: skills added to the draft and taken away together, from the Skills popup (D238). */
export async function changeSkills(input: { code: string; add: string[]; remove: string[] }): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  for (const skill of input.add) await repository.setSkill(versionId, skill, true);
  for (const skill of input.remove) await repository.setSkill(versionId, skill, false);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { skillsAdded: input.add, skillsRemoved: input.remove },
  });
}

/** `UC-51.2-02`: add a skill to the draft, or take it away. */
export async function setSkill(input: {
  code: string;
  skillVersionId: string;
  enabled: boolean;
}): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  await repository.setSkill(versionId, input.skillVersionId, input.enabled);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { skill: input.skillVersionId, enabled: input.enabled },
  });
}

/**
 * Grants the draft a knowledge collection to read with `knowledge_search`, or revokes it.
 *
 * Without a grant the harness tells the agent no collection at all, so this is what makes
 * "answer from platform knowledge" possible rather than merely configured-looking.
 */
export async function setKnowledgeAccess(input: {
  code: string;
  collectionId: string;
  enabled: boolean;
}): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  await repository.setKnowledgeAccess(versionId, input.collectionId, input.enabled);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { knowledgeCollection: input.collectionId, enabled: input.enabled },
  });
}

/**
 * `UC-55.1`, specification §7.4.6: grants the draft a memory scope to read or write, or
 * revokes it. Without a grant the harness is told no scope at all, which is what makes
 * "agents use memory only within the scopes their configuration allows" real.
 */
export async function setMemoryAccess(input: {
  code: string;
  memoryScopeId: string;
  access: "Read" | "ReadWrite" | null;
}): Promise<void> {
  const session = await requireConfigure(input.code);
  const versionId = await draftOf(input.code, session.personId);
  await repository.setMemoryAccess(versionId, input.memoryScopeId, input.access);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "AgentVersion",
    objectLabel: input.code,
    detail: { memoryScope: input.memoryScopeId, access: input.access },
  });
}
