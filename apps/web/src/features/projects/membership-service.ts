import { audit } from "@/lib/audit";
import { requirePermission, requireProjectPermission } from "@/lib/session";
import * as repository from "./repository";
import type { ProjectMemberInput, RemoveProjectMemberInput } from "./schema";
import { ProjectRejected } from "./errors";

/** `UC-21.3-01` and `-02`: a person or an agent joins the project. */
export async function addMember(input: ProjectMemberInput): Promise<void> {
  await requirePermission("projects:write");

  const project = await repository.readProjectForPolicy(input.key);
  if (!project) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  const session = await requireProjectPermission("projects:write", project.id);

  const principalId = await repository.resolveMember(input.principal, input.isAgent);
  if (!principalId) throw new ProjectRejected("No such person or agent.", "لا يوجد شخص أو وكيل بهذا المعرّف.");

  // `UC-21.3-03`: an agent the allowed-agents policy leaves out cannot be added by going
  // round the policy. An empty policy allows every agent the trust level allows.
  if (input.isAgent) {
    const allowed = await repository.allowedAgentIds(project.id);
    if (allowed.length > 0 && !allowed.includes(principalId)) {
      throw new ProjectRejected(
        `${input.principal} is not in this project's allowed agents. Change the policy first.`,
        `${input.principal} ليس ضمن وكلاء هذا المشروع المسموح بهم. غيّر السياسة أولاً.`,
      );
    }
  }

  await repository.addMember({
    projectId: project.id,
    principalId,
    principalType: input.isAgent ? "Agent" : "Person",
    projectRole: input.isAgent ? "Member" : input.projectRole,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "projects:write",
    objectType: "Project",
    objectId: project.id,
    objectLabel: input.key,
    detail: { added: input.principal, isAgent: input.isAgent, role: input.projectRole },
  });
}

/** What removing a member would leave behind, or what it did. */
export type RemovalOutcome = { removed: boolean; openWorkItems: string[] };

/**
 * `UC-21.3-04` and `-05`: a member leaves the project.
 *
 * The last owner may not leave, because a project with nobody answerable for it is a
 * project nobody can change. Open work the member still holds is reported first and stays
 * assigned to them afterwards: unassigning it silently would lose who was doing it.
 */
export async function removeMember(input: RemoveProjectMemberInput): Promise<RemovalOutcome> {
  await requirePermission("projects:write");

  const project = await repository.readProjectForPolicy(input.key);
  if (!project) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  const session = await requireProjectPermission("projects:write", project.id);

  const principalId = await repository.resolveMember(input.principal, input.isAgent);
  if (!principalId) throw new ProjectRejected("No such person or agent.", "لا يوجد شخص أو وكيل بهذا المعرّف.");

  const members = await repository.readMembers(project.id);
  const leaving = members.find((member) => member.principalId === principalId);
  if (!leaving) throw new ProjectRejected("That member is not in this project.", "هذا العضو ليس في هذا المشروع.");

  if (leaving.projectRole === "Owner" && members.filter((member) => member.projectRole === "Owner").length === 1) {
    throw new ProjectRejected("A project must have an owner.", "لا بد للمشروع من مالك.");
  }

  const openWorkItems = await repository.openWorkOf(project.id, principalId);
  if (openWorkItems.length > 0 && !input.confirmed) return { removed: false, openWorkItems };

  await repository.removeMember(project.id, principalId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "projects:write",
    objectType: "Project",
    objectId: project.id,
    objectLabel: input.key,
    detail: { removed: input.principal, isAgent: input.isAgent, openWorkItems },
  });
  return { removed: true, openWorkItems };
}
