import { audit } from "@/lib/audit";
import {
  can,
  requireOrganisationPermission,
  requireOrgUnitPermission,
  requirePermission,
  requireProjectPermission,
  visibleProjectIds,
} from "@/lib/session";
import * as repository from "./repository";
import type { ProjectsScreen } from "./types";
import type { CreateProjectInput } from "./schema";
import { ProjectRejected } from "./errors";

export { ProjectRejected } from "./errors";
export { type ProjectDiff, updateProject, updatePolicy, renameProject } from "./update-service";
export { addMember, type RemovalOutcome, removeMember } from "./membership-service";

/** S-20 the project list, S-21 the project detail. */

export async function loadProjects(): Promise<ProjectsScreen> {
  await requirePermission("projects:read");
  const [details, catalogue, mayWrite] = await Promise.all([
    repository.readDetails(await visibleProjectIds("projects:read")),
    repository.policyCatalogue(),
    can("projects:write"),
  ]);
  return { details, connectors: catalogue.connectors, agents: catalogue.agents, mayWrite };
}

/**
 * `UC-20.2-01`: creates a project, with its owner as an Owner member, and audits it. Requires
 * `projects:write` in that org unit, or organisation-wide for a project in none (`UC-41.2-03`).
 * The org unit is matched by English name; none matching leaves it unset.
 */
export async function createProject(input: CreateProjectInput): Promise<void> {
  const orgUnitId = await repository.orgUnitIdByName(input.orgUnit);
  const session = orgUnitId
    ? await requireOrgUnitPermission("projects:write", orgUnitId)
    : await requireOrganisationPermission("projects:write");
  await repository.createProject({ ...input, orgUnitId, createdBy: session.personId });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "projects:write",
    objectType: "Project",
    objectLabel: input.key,
    detail: { nameEn: input.nameEn, sensitivity: input.sensitivity },
  });
}

/**
 * Deletes a project. Its own policy — the allowed agents and connectors, the approval
 * rules, its membership and its decision log — is removed with it; anything built under
 * it (a room, a work item, a request, an artifact, a file, a schedule, a knowledge
 * collection, or a request type naming it as a default) refuses the delete and names what
 * is still there, the same shape `UC-42.1-04` already refuses an org unit still in use.
 *
 * @throws {ProjectRejected} when the project no longer exists or still holds something.
 */
export async function deleteProject(key: string): Promise<void> {
  await requirePermission("projects:write");

  const id = await repository.projectIdByKey(key);
  if (!id) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  const session = await requireProjectPermission("projects:write", id);

  const blockers = await repository.projectDeleteBlockers(id);
  const inUse = [
    blockers.rooms && `${blockers.rooms} discussion rooms`,
    blockers.workItems && `${blockers.workItems} work items`,
    blockers.requests && `${blockers.requests} requests`,
    blockers.artifacts && `${blockers.artifacts} artifacts`,
    blockers.files && `${blockers.files} files`,
    blockers.schedules && `${blockers.schedules} scheduled work items`,
    blockers.knowledgeCollections && `${blockers.knowledgeCollections} knowledge collections`,
    blockers.defaultForRequestTypes && `${blockers.defaultForRequestTypes} request types naming it as a default`,
  ].filter(Boolean);
  const inUseAr = [
    blockers.rooms && `${blockers.rooms} غرف نقاش`,
    blockers.workItems && `${blockers.workItems} بنود عمل`,
    blockers.requests && `${blockers.requests} طلبات`,
    blockers.artifacts && `${blockers.artifacts} منتجات`,
    blockers.files && `${blockers.files} ملفات`,
    blockers.schedules && `${blockers.schedules} بنود مجدولة`,
    blockers.knowledgeCollections && `${blockers.knowledgeCollections} مجموعات معرفة`,
    blockers.defaultForRequestTypes && `${blockers.defaultForRequestTypes} أنواع طلبات تسميه افتراضياً`,
  ].filter(Boolean);
  if (inUse.length) {
    throw new ProjectRejected(
      `This project cannot be deleted: it still has ${inUse.join(", ")}.`,
      `لا يمكن حذف هذا المشروع: لا يزال لديه ${inUseAr.join("، ")}.`,
    );
  }

  await repository.deleteProject(id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "projects:delete",
    objectType: "Project",
    objectLabel: key,
  });
}
