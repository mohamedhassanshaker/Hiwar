import * as agents from "@/features/agents/service";
import { workItemBrief } from "./brief-service";
import { noteTaskDone } from "@/features/comments/service";
import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { assertWritten } from "@/lib/concurrency";
import { notifyDashboard } from "@/lib/live";
import { logger } from "@/lib/logger";
import { NotPermitted, can, requirePermission, requireProjectPermission } from "@/lib/session";
import {
  TERMINAL_WORK_ITEM_STATUSES,
  WORK_ITEM_FIELD_RULES,
  fieldsIn,
  sensitiveFieldsIn,
} from "./privileges";
import * as repository from "./repository";
import { activityActor } from "./actor";
import { canMove } from "./transitions";
import type { ChangeStatusInput, CreateWorkItemInput, UpdateWorkItemInput } from "./schema";
import { WorkItemRejected } from "./errors";

/**
 * `UC-24.3-01` … `-09`: create a work item.
 *
 * The status is decided here rather than taken from the form: work with nobody on it is in
 * the backlog, and work with an assignee is to do. An agent assignee starts its run and the
 * item is in progress, because an agent begins the moment it is given the work.
 */
export async function createWorkItem(input: CreateWorkItemInput): Promise<string> {
  const session = await requirePermission("work_items:write");

  // D312: work raised from a request belongs to the request's project, whatever the form said.
  let projectKey = input.projectKey;
  const request = input.requestKey ? await repository.requestForWork(input.requestKey) : null;
  if (input.requestKey) {
    await requirePermission("requests:read");
    if (!request) throw new WorkItemRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
    projectKey = request.projectKey;
  }
  // `UC-24.3-03`: a sub item belongs to its parent's project, whatever the form said.
  if (input.type === "SubItem") {
    if (!input.parentKey) throw new WorkItemRejected("A sub item needs a parent work item.", "البند الفرعي يحتاج إلى بند عمل أصل.");
    const parentProject = await repository.projectOfWorkItem(input.parentKey);
    if (!parentProject) throw new WorkItemRejected("That parent work item no longer exists.", "لم يعد بند العمل الأصل موجوداً.");
    projectKey = parentProject;
  }

  const project = await repository.readProjectRules(projectKey);
  if (!project) throw new WorkItemRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  await requireProjectPermission("work_items:write", project.id);

  const assignee = input.assignee ? await repository.resolvePrincipal(input.assignee) : null;
  if (input.assignee && !assignee) throw new WorkItemRejected("That assignee no longer exists.", "لم يعد هذا المسند إليه موجوداً.");

  // `UC-24.3-08`: an agent the project does not allow may not be given its work.
  if (assignee?.type === "Agent") {
    const allowed = await repository.agentsAllowedInProject(projectKey);
    if (allowed.length > 0 && !allowed.includes(input.assignee ?? "")) {
      throw new WorkItemRejected("That agent is not allowed in this project.", "هذا الوكيل غير مسموح به في هذا المشروع.");
    }
  }

  // `UC-24.3-07`: a review by the person who did the work is not a review.
  if (
    project.requireReviewerNotAuthor &&
    input.reviewer &&
    assignee?.type === "Person" &&
    input.reviewer === assignee.id
  ) {
    throw new WorkItemRejected("Reviewer must differ from assignee.", "يجب أن يختلف المراجع عن المسند إليه.");
  }

  const key = await repository.createWorkItem({
    projectKey,
    type: input.type,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn ?? null,
    assignee,
    reviewerId: input.reviewer ?? null,
    priority: input.priority,
    dueAt: input.dueAt ? new Date(`${input.dueAt}T12:00:00Z`) : null,
    parentKey: input.parentKey ?? null,
    status: assignee ? "ToDo" : "Backlog",
    attributes: input.attributes ?? {},
    createdBy: session.personId,
    ...(request
      ? {
          requestId: request.id,
          origin: { type: "Request", id: request.id, detailEn: `created this work item for ${request.key}`, detailAr: `أنشأ بند العمل للطلب ${request.key}` },
        }
      : {}),
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:write",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { titleEn: input.titleEn, project: projectKey, status: assignee ? "ToDo" : "Backlog" },
  });
  if (assignee?.type === "Person") await repository.tellAssignee(key, assignee.id, session.personId);

  // `UC-24.3-02`: an agent assignee starts now. The run is what moves the item on, so a
  // failure to start leaves it To do rather than claiming progress that is not happening.
  // The key is in the prompt because every work item tool the agent finishes with names it.
  if (assignee?.type === "Agent" && input.assignee) {
    try {
      await agents.startRun({
        agentCode: input.assignee,
        // D384: the item's brief, so the agent starts from what is recorded on it.
        prompt: agents.withBrief(`Work item ${key} was assigned to you: ${input.titleEn}`, await workItemBrief(key), key),
        surface: "WorkItem",
        contextId: key,
      });
      await repository.changeStatus(key, "InProgress", await versionOf(key), session.personId);
    } catch (problem) {
      logger().warn({ key, agent: input.assignee, problem }, "the agent run did not start");
    }
  }
  await notifyDashboard("work-item");
  return key;
}

/** The version of a work item this moment, for a change this service makes itself. */
async function versionOf(key: string): Promise<number> {
  const version = await repository.readVersion(key);
  if (version === null) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  return version;
}

/**
 * What one edit changed: the fields it touched, as they were and as they are, and what
 * the change leaves behind.
 *
 * Closing a work item does not close the sub items under it, so the cascade names how
 * many are still open. An approver agreeing to "status: Done" is agreeing to that too.
 */
export type WorkItemDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** What this edit leaves behind: sub items still open when the work is closed. */
  cascade: { openSubItems: number };
  version: number;
};

/**
 * `UC-24.1-07` and `UC-24.3`: edit one work item as a patch — the one write path for one.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply. The transition rule is
 * checked here rather than in the board's drag handler, so a move the platform refuses
 * fails the same way whether it came from a drag, the drawer, an agent or the API.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {WorkItemRejected} when the item is gone or the move is not one the flow allows.
 * @throws {StaleWriteError} when somebody saved it since the caller read it (`COM-10`).
 */
export async function updateWorkItem(input: UpdateWorkItemInput): Promise<WorkItemDiff> {
  const session = await requirePermission("work_items:write");

  // Every privilege the patch needs, before anything is written. This applies to whoever
  // asks: an agent holds exactly the permissions of the person it acts for.
  for (const field of fieldsIn(input)) {
    const needed = WORK_ITEM_FIELD_RULES[field].privilege;
    if (!(await can(needed))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // Before an approval is asked for, so nobody is asked to agree to a write that is refused.
  const current = await repository.readForRules(input.key);
  if (!current) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  // D331: the item's own person assignee may move it along the board from outside its
  // project; any other change needs the permission in the project.
  const ownMove =
    fieldsIn(input).every((field) => field === "status") &&
    current.assigneeType === "Person" &&
    current.assigneeId === session.personId;
  if (!ownMove) await requireProjectPermission("work_items:write", current.projectId);

  // A sensitive field set by an agent waits for a person, unless one has already agreed to
  // exactly these fields — which the MCP boundary establishes by spending a bound approval
  // before the call reaches here (D20, D49). Refused before anything is written, so the
  // call that comes back after an approval is the first one to change anything.
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "work_item_edit",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => WORK_ITEM_FIELD_RULES[field].reason ?? ""),
    });
  }

  if (input.status && !canMove(current.status, input.status)) {
    throw new WorkItemRejected(
      `A work item cannot move from ${current.status} to ${input.status}.`,
      `لا يمكن نقل بند عمل من ${current.status} إلى ${input.status}.`,
    );
  }

  const dueAt = input.dueAt ? new Date(`${input.dueAt}T12:00:00Z`) : input.dueAt === null ? null : undefined;
  const written = await repository.updateWorkItem(
    input.key,
    input.expectedVersion,
    {
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      descriptionEn: input.descriptionEn,
      priority: input.priority,
      dueAt,
      status: input.status,
    },
    session.personId,
    activityActor(session),
  );
  // `COM-10`, in the words the console already answers: somebody saved first, so read it
  // again and retry rather than overwriting what they wrote.
  assertWritten(written ? [input.key] : [], "WorkItem");

  const was: Record<string, unknown> = {
    titleEn: current.titleEn,
    titleAr: current.titleAr,
    descriptionEn: current.descriptionEn,
    priority: current.priority,
    dueAt: current.dueAt?.toISOString().slice(0, 10) ?? null,
    status: current.status,
  };
  const touched = fieldsIn(input);
  const diff: WorkItemDiff = {
    before: Object.fromEntries(touched.map((field) => [field, was[field]])),
    after: Object.fromEntries(touched.map((field) => [field, input[field]])),
    cascade: {
      openSubItems:
        input.status && (TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(input.status)
          ? current.openSubItems
          : 0,
    },
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: input.status ? "work_items:status" : "work_items:write",
    objectType: "WorkItem",
    objectLabel: input.key,
    detail: { before: diff.before, after: diff.after, cascade: diff.cascade },
  });
  // Handoff v2 section 5.2: a task raised from a comment reports back into its thread when
  // it is finished. Posted after the move is recorded, so a refused move never says so.
  if (input.status === "Done") {
    await noteTaskDone(current.id, input.key, current.titleEn, session.personId);
  }
  // `UC-25.2-01`: however it got to In review — the drawer, a drag, an agent's edit — the
  // reviewer is told, because a review nobody knows about is not a review.
  if (input.status === "InReview" && current.reviewerId) {
    await repository.notifyReviewer({ reviewerId: current.reviewerId, workItemId: current.id }, session.personId);
  }
  await notifyDashboard("work-item");
  return diff;
}

/**
 * `UC-24.1-07`: the board's move, which is one patch over the one write path.
 *
 * The screen names the version it read as `version`; the patch calls the same thing
 * `expectedVersion`, because that is what it is everywhere else in the catalogue.
 */
export async function changeStatus(input: ChangeStatusInput): Promise<void> {
  await updateWorkItem({ key: input.key, expectedVersion: input.version, status: input.status });
}

/**
 * Deletes a work item. Its own comment and status-change log goes with it; an approval
 * decided on it, a schedule firing that created it, or a sub-item still under it refuses the
 * delete, naming what is in the way.
 *
 * @throws {WorkItemRejected} when the item no longer exists or is in use.
 */
export async function deleteWorkItem(key: string): Promise<void> {
  const session = await requirePermission("work_items:write");

  const current = await repository.readForActions(key);
  if (!current) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", current.projectId);

  const blockers = await repository.workItemDeleteBlockers(current.id);
  const inUse = [
    blockers.approvals && `${blockers.approvals} approvals`,
    blockers.scheduleRuns && `${blockers.scheduleRuns} schedule firings`,
    blockers.subItems && `${blockers.subItems} sub items`,
  ].filter(Boolean);
  const inUseAr = [
    blockers.approvals && `${blockers.approvals} اعتمادات`,
    blockers.scheduleRuns && `${blockers.scheduleRuns} عمليات تفعيل جدول`,
    blockers.subItems && `${blockers.subItems} بنود فرعية`,
  ].filter(Boolean);
  if (inUse.length) {
    throw new WorkItemRejected(
      `This work item cannot be deleted: it still has ${inUse.join(", ")}.`,
      `لا يمكن حذف بند العمل هذا: لا يزال لديه ${inUseAr.join("، ")}.`,
    );
  }

  await repository.deleteWorkItem(current.id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:delete",
    objectType: "WorkItem",
    objectLabel: key,
  });
  await notifyDashboard("work-item");
}
