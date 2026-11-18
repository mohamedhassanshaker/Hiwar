import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import type { ProjectDetail, ProjectMember } from "./types";

/** The only module in `projects` that touches Drizzle. */

const countIn = (table: string, column = "project_id") =>
  sql<number>`(select count(*) from ${sql.raw(table)} x where x.${sql.raw(column)} = ${outer(s.project.id)})::int`;

/**
 * What still points at a project and would block deleting it: everything the project is a
 * container for (`UC-42.1-04`'s shape, one level down from an org unit). Its own policy —
 * the allowed agents and connectors, the approval rules, its membership and its decision log
 * — cascades away with it; `request_type_version.default_project_id` is the one reference
 * nothing protects against here, because a request type naming this project as its default
 * is not something a project's own screen would ever show.
 */
export async function projectDeleteBlockers(projectId: string): Promise<{
  rooms: number;
  workItems: number;
  requests: number;
  artifacts: number;
  files: number;
  schedules: number;
  knowledgeCollections: number;
  defaultForRequestTypes: number;
}> {
  const [row] = await dbRo()
    .select({
      rooms: countIn("work.discussion_room"),
      workItems: countIn("work.work_item"),
      requests: countIn("work.request"),
      artifacts: countIn("work.artifact"),
      files: countIn("work.project_file"),
      schedules: countIn("work.scheduled_work_item"),
      knowledgeCollections: countIn("ai.knowledge_collection"),
      defaultForRequestTypes: countIn("work.request_type_version", "default_project_id"),
    })
    .from(s.project)
    .where(eq(s.project.id, projectId))
    .limit(1);
  return (
    row ?? {
      rooms: 0,
      workItems: 0,
      requests: 0,
      artifacts: 0,
      files: 0,
      schedules: 0,
      knowledgeCollections: 0,
      defaultForRequestTypes: 0,
    }
  );
}

/** Removes a project the caller has already checked is empty. */
export async function deleteProject(projectId: string): Promise<void> {
  await db().delete(s.project).where(eq(s.project.id, projectId));
}

/** The connectors and agents a project policy may name. */
export async function policyCatalogue(): Promise<{
  connectors: { code: string; nameEn: string; nameAr: string }[];
  agents: { code: string; nameEn: string; nameAr: string }[];
}> {
  const [connectors, agents] = await Promise.all([
    dbRo()
      .select({ code: s.connector.code, nameEn: s.connector.nameEn, nameAr: s.connector.nameAr })
      .from(s.connector)
      .where(eq(s.connector.isEnabled, true))
      .orderBy(asc(s.connector.code)),
    dbRo()
      .select({ code: s.agent.code, nameEn: s.agent.nameEn, nameAr: s.agent.nameAr })
      .from(s.agent)
      .where(eq(s.agent.isSystem, false))
      .orderBy(asc(s.agent.code)),
  ]);
  return { connectors, agents };
}

/**
 * Each project's detail keyed by its key: how many rooms, work items, requests, schedules,
 * artifacts and files it holds, its members, approval rules, allowed agents and connectors,
 * and its decisions with the key of the record each came from. Only the projects in
 * `visibleIds`, or every project when it is null.
 */
export async function readDetails(visibleIds: string[] | null): Promise<Record<string, ProjectDetail>> {
  if (visibleIds?.length === 0) return {};
  const rows = await dbRo()
    .select({
      id: s.project.id,
      key: s.project.key,
      sensitivity: s.project.sensitivity,
      status: s.project.status,
      requireReviewerNotAuthor: s.project.requireReviewerNotAuthor,
      version: s.project.version,
      rooms: countIn("work.discussion_room"),
      workItems: countIn("work.work_item"),
      requests: countIn("work.request"),
      schedules: countIn("work.scheduled_work_item"),
      artifacts: countIn("work.artifact"),
      files: countIn("work.project_file"),
    })
    .from(s.project)
    .where(visibleIds === null ? undefined : inArray(s.project.id, visibleIds))
    .orderBy(asc(s.project.key));

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return {};

  const members = await dbRo()
    .select({
      projectId: s.projectMember.projectId,
      role: s.projectMember.projectRole,
      principalType: s.projectMember.principalType,
      personId: s.person.id,
      agentCode: s.agent.code,
    })
    .from(s.projectMember)
    .leftJoin(s.person, eq(s.person.id, s.projectMember.principalId))
    .leftJoin(s.agent, eq(s.agent.id, s.projectMember.principalId))
    .where(inArray(s.projectMember.projectId, ids));

  const rules = await dbRo()
    .select({
      projectId: s.projectApprovalRule.projectId,
      ref: s.projectApprovalRule.actionOrToolRef,
      minimumTier: s.projectApprovalRule.minimumTier,
    })
    .from(s.projectApprovalRule)
    .where(inArray(s.projectApprovalRule.projectId, ids));

  const allowedAgents = await dbRo()
    .select({ projectId: s.projectAllowedAgent.projectId, code: s.agent.code })
    .from(s.projectAllowedAgent)
    .innerJoin(s.agent, eq(s.agent.id, s.projectAllowedAgent.agentId))
    .where(inArray(s.projectAllowedAgent.projectId, ids));

  const allowedConnectors = await dbRo()
    .select({ projectId: s.projectAllowedConnector.projectId, code: s.connector.code })
    .from(s.projectAllowedConnector)
    .innerJoin(s.connector, eq(s.connector.id, s.projectAllowedConnector.connectorId))
    .where(inArray(s.projectAllowedConnector.projectId, ids));

  const decisions = await dbRo()
    .select({
      projectId: s.decision.projectId,
      titleEn: s.decision.titleEn,
      titleAr: s.decision.titleAr,
      decidedBy: s.decision.decidedBy,
      decidedAt: s.decision.decidedAt,
      sourceType: s.decision.sourceType,
      // `UC-21.1-03`: the key of whichever source the decision came from, so the screen can
      // open it without a second round trip for each row.
      sourceKey: sql<string | null>`case ${s.decision.sourceType}
        when 'Approval' then (select a.key from ai.approval a where a.id = ${outer(s.decision.sourceId)})
        when 'Room' then (select dr.key from work.discussion_room dr where dr.id = ${outer(s.decision.sourceId)})
        end`,
    })
    .from(s.decision)
    .where(inArray(s.decision.projectId, ids))
    .orderBy(asc(s.decision.decidedAt));

  const result: Record<string, ProjectDetail> = {};
  for (const row of rows) {
    result[row.key] = {
      key: row.key,
      sensitivity: row.sensitivity,
      status: row.status,
      version: row.version,
      contents: {
        rooms: row.rooms,
        workItems: row.workItems,
        requests: row.requests,
        schedules: row.schedules,
        artifacts: row.artifacts,
        files: row.files,
      },
      members: members
        .filter((member) => member.projectId === row.id)
        .map<ProjectMember>((member) => ({
          id: (member.principalType === "Agent" ? member.agentCode : member.personId) ?? "",
          role: member.role,
          isAgent: member.principalType === "Agent",
        })),
      requireReviewerNotAuthor: row.requireReviewerNotAuthor,
      approvalRules: rules
        .filter((rule) => rule.projectId === row.id)
        .map((rule) => ({ ref: rule.ref, minimumTier: rule.minimumTier })),
      // An empty allow-list means "every agent the trust level allows" (data model section 4).
      allowedAgents: allowedAgents.filter((agent) => agent.projectId === row.id).map((agent) => agent.code),
      allowedConnectors: allowedConnectors.filter((connector) => connector.projectId === row.id).map((connector) => connector.code),
      decisions: decisions
        .filter((decision) => decision.projectId === row.id)
        .map((decision) => ({
          titleEn: decision.titleEn,
          titleAr: decision.titleAr,
          decidedBy: decision.decidedBy ?? "",
          decidedAt: decision.decidedAt.toISOString(),
          sourceType: decision.sourceType,
          sourceKey: decision.sourceKey,
        })),
    };
  }
  return result;
}

/** A project's id from its key, or null when no project has it. */
export async function projectIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, key)).limit(1);
  return row?.id ?? null;
}

export type NewProject = {
  key: string;
  nameEn: string;
  nameAr: string;
  orgUnitId: string | null;
  ownerPersonId: string;
  sensitivity: string;
  status: string;
  requireReviewerNotAuthor: boolean;
  descriptionEn?: string;
  descriptionAr?: string;
  createdBy: string;
};

/** The org unit with this English name, or null. */
export async function orgUnitIdByName(nameEn: string): Promise<string | null> {
  const [unit] = await dbRo().select({ id: s.orgUnit.id }).from(s.orgUnit).where(eq(s.orgUnit.nameEn, nameEn)).limit(1);
  return unit?.id ?? null;
}

/** Creates a project and makes its owner the first member. */
export async function createProject(input: NewProject): Promise<void> {
  await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(s.project)
      .values({
        key: input.key,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        ownerPersonId: input.ownerPersonId,
        orgUnitId: input.orgUnitId,
        sensitivity: input.sensitivity,
        status: input.status,
        requireReviewerNotAuthor: input.requireReviewerNotAuthor,
        descriptionEn: input.descriptionEn || null,
        descriptionAr: input.descriptionAr || null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      })
      .returning({ id: s.project.id });
    await tx.insert(s.projectMember).values({
      projectId: created.id,
      principalType: "Person",
      principalId: input.ownerPersonId,
      projectRole: "Owner",
    });
  });
}

/** The project row the policy screen edits, and what the rules need to decide. */
export async function readProjectForPolicy(key: string): Promise<{
  id: string;
  nameEn: string;
  nameAr: string;
  sensitivity: string;
  status: string;
  requireReviewerNotAuthor: boolean;
  ownerPersonId: string | null;
  version: number;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.project.id,
      nameEn: s.project.nameEn,
      nameAr: s.project.nameAr,
      sensitivity: s.project.sensitivity,
      status: s.project.status,
      requireReviewerNotAuthor: s.project.requireReviewerNotAuthor,
      ownerPersonId: s.project.ownerPersonId,
      version: s.project.version,
    })
    .from(s.project)
    .where(eq(s.project.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * The tier each named tool or action carries where it is declared.
 *
 * `UC-21.2-04`: a project policy may raise a tool's tier and never lower it, so the rule
 * needs the floor the connector set. A reference nothing declares has no floor and is an
 * action of the platform's own, which a project may require approval for at any tier.
 */
export async function declaredTiers(refs: string[]): Promise<Record<string, string>> {
  if (refs.length === 0) return {};
  const rows = await dbRo()
    .select({ ref: sql<string>`${s.connector.code} || '.' || ${s.connectorTool.name}`, tier: s.connectorTool.tier })
    .from(s.connectorTool)
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId));
  return Object.fromEntries(rows.filter((row) => refs.includes(row.ref)).map((row) => [row.ref, row.tier]));
}

/** The connector and agent ids behind the codes a policy names, and which codes are unknown. */
export async function resolvePolicyCodes(input: { connectors: string[]; agents: string[] }): Promise<{
  connectors: { code: string; id: string }[];
  agents: { code: string; id: string }[];
  unknown: string[];
}> {
  const connectors = input.connectors.length
    ? await dbRo().select({ code: s.connector.code, id: s.connector.id }).from(s.connector).where(inArray(s.connector.code, input.connectors))
    : [];
  const agents = input.agents.length
    ? await dbRo().select({ code: s.agent.code, id: s.agent.id }).from(s.agent).where(inArray(s.agent.code, input.agents))
    : [];
  const found = new Set([...connectors.map((row) => row.code), ...agents.map((row) => row.code)]);
  return {
    connectors,
    agents,
    unknown: [...input.connectors, ...input.agents].filter((code) => !found.has(code)),
  };
}

/** The policy a project holds now, by the codes the screens and the tools name it with. */
export async function readPolicy(projectId: string): Promise<{
  connectors: string[];
  agents: string[];
  approvalRules: { ref: string; minimumTier: string }[];
}> {
  const [connectors, agents, approvalRules] = await Promise.all([
    dbRo()
      .select({ code: s.connector.code })
      .from(s.projectAllowedConnector)
      .innerJoin(s.connector, eq(s.connector.id, s.projectAllowedConnector.connectorId))
      .where(eq(s.projectAllowedConnector.projectId, projectId))
      .orderBy(asc(s.connector.code)),
    dbRo()
      .select({ code: s.agent.code })
      .from(s.projectAllowedAgent)
      .innerJoin(s.agent, eq(s.agent.id, s.projectAllowedAgent.agentId))
      .where(eq(s.projectAllowedAgent.projectId, projectId))
      .orderBy(asc(s.agent.code)),
    dbRo()
      .select({ ref: s.projectApprovalRule.actionOrToolRef, minimumTier: s.projectApprovalRule.minimumTier })
      .from(s.projectApprovalRule)
      .where(eq(s.projectApprovalRule.projectId, projectId))
      .orderBy(asc(s.projectApprovalRule.actionOrToolRef)),
  ]);
  return { connectors: connectors.map((row) => row.code), agents: agents.map((row) => row.code), approvalRules };
}

/**
 * Applies one patch to a project, all of it or none.
 *
 * `COM-10`: the version the caller read is in the `WHERE`, so two people editing the same
 * project do not silently lose one of the edits; `awp_version_bump` moves the version on.
 * A list that is named is replaced whole, because a policy is a set and a row left behind
 * by a previous edit is a row nobody chose; a list that is not named is left alone.
 *
 * @returns false when no row matched the version, which the caller reports as a stale read.
 */
export async function updateProject(
  projectId: string,
  expectedVersion: number,
  patch: {
    nameEn?: string;
    nameAr?: string;
    sensitivity?: string;
    status?: string;
    requireReviewerNotAuthor?: boolean;
    connectorIds?: string[];
    agentIds?: string[];
    approvalRules?: { ref: string; minimumTier: string }[];
  },
  personId: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.project)
      .set({
        ...(patch.nameEn === undefined ? {} : { nameEn: patch.nameEn }),
        ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
        ...(patch.sensitivity === undefined ? {} : { sensitivity: patch.sensitivity }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.requireReviewerNotAuthor === undefined
          ? {}
          : { requireReviewerNotAuthor: patch.requireReviewerNotAuthor }),
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.project.id, projectId), eq(s.project.version, expectedVersion)))
      .returning({ id: s.project.id });
    if (rows.length === 0) return false;

    if (patch.connectorIds) {
      await tx.delete(s.projectAllowedConnector).where(eq(s.projectAllowedConnector.projectId, projectId));
      if (patch.connectorIds.length > 0) {
        await tx
          .insert(s.projectAllowedConnector)
          .values(patch.connectorIds.map((connectorId) => ({ projectId, connectorId })));
      }
    }

    if (patch.agentIds) {
      await tx.delete(s.projectAllowedAgent).where(eq(s.projectAllowedAgent.projectId, projectId));
      if (patch.agentIds.length > 0) {
        await tx.insert(s.projectAllowedAgent).values(patch.agentIds.map((agentId) => ({ projectId, agentId })));
      }
    }

    if (patch.approvalRules) {
      await tx.delete(s.projectApprovalRule).where(eq(s.projectApprovalRule.projectId, projectId));
      if (patch.approvalRules.length > 0) {
        await tx.insert(s.projectApprovalRule).values(
          patch.approvalRules.map((rule) => ({
            projectId,
            actionOrToolRef: rule.ref,
            approverType: "Person" as const,
            approverId: null,
            minimumTier: rule.minimumTier,
            createdBy: personId,
            updatedBy: personId,
          })),
        );
      }
    }
    return true;
  });
}

/** The members of one project, with the principal each one is. */
export async function readMembers(projectId: string): Promise<
  { principalId: string; principalType: string; projectRole: string; code: string | null }[]
> {
  return dbRo()
    .select({
      principalId: s.projectMember.principalId,
      principalType: s.projectMember.principalType,
      projectRole: s.projectMember.projectRole,
      code: s.agent.code,
    })
    .from(s.projectMember)
    .leftJoin(s.agent, eq(s.agent.id, s.projectMember.principalId))
    .where(eq(s.projectMember.projectId, projectId));
}

/** The id behind a member's identifier: a person's own id, or an agent's code. */
export async function resolveMember(principal: string, isAgent: boolean): Promise<string | null> {
  if (isAgent) {
    const [agent] = await dbRo().select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, principal)).limit(1);
    return agent?.id ?? null;
  }
  const [person] = await dbRo().select({ id: s.person.id }).from(s.person).where(eq(s.person.id, principal)).limit(1);
  return person?.id ?? null;
}

/** The agent ids this project's allowed-agents policy names. Empty means the policy is open. */
export async function allowedAgentIds(projectId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ agentId: s.projectAllowedAgent.agentId })
    .from(s.projectAllowedAgent)
    .where(eq(s.projectAllowedAgent.projectId, projectId));
  return rows.map((row) => row.agentId);
}

/** The open work items one member still holds in a project (`UC-21.3-05`). */
export async function openWorkOf(projectId: string, principalId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ key: s.workItem.key })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.projectId, projectId),
        eq(s.workItem.assigneeId, principalId),
        notInArray(s.workItem.status, ["Done", "Cancelled"]),
      ),
    )
    .orderBy(asc(s.workItem.key));
  return rows.map((row) => row.key);
}

/** Adds a person or an agent to a project, or changes its project role when already a member. */
export async function addMember(input: {
  projectId: string;
  principalId: string;
  principalType: string;
  projectRole: string;
}): Promise<void> {
  await db()
    .insert(s.projectMember)
    .values({
      projectId: input.projectId,
      principalType: input.principalType,
      principalId: input.principalId,
      projectRole: input.projectRole,
    })
    .onConflictDoUpdate({
      target: [s.projectMember.projectId, s.projectMember.principalType, s.projectMember.principalId],
      set: { projectRole: input.projectRole },
    });
}

/** Removes a principal from a project's members. Its open work items are left as they are. */
export async function removeMember(projectId: string, principalId: string): Promise<void> {
  await db()
    .delete(s.projectMember)
    .where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.principalId, principalId)));
}
