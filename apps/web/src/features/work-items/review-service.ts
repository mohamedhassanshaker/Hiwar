import * as agents from "@/features/agents/service";
import { workItemBrief } from "./brief-service";
import * as requests from "@/features/requests/service";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { Rejected } from "@/lib/rejection";
import { NotPermitted, requirePermission, requireProjectPermission, runAs } from "@/lib/session";
import * as repository from "./repository";
import { activityActor } from "./actor";
import { WorkItemRejected } from "./errors";
import { SUBMITTABLE_STATUSES } from "./transitions";

/* -------------------------------------------------- what the drawer does to one item (S-25) */

/** Who may approve: anyone but the person who wrote the work or is doing it (`UC-25.2-04`). */
export function mayApprove(
  item: { createdBy: string | null; assigneeType: string; assigneeId: string | null },
  personId: string,
): boolean {
  if (item.createdBy === personId) return false;
  return !(item.assigneeType === "Person" && item.assigneeId === personId);
}

/**
 * `UC-24.3-01`, `UC-25.2-06`: give the item to a person or an agent, by person id or agent code.
 *
 * An agent starts on it at once (`assignToAgent`). A person is told through the activity and
 * the board; work given to somebody is to do, so an item still in the backlog moves to To do.
 */
export async function assign(key: string, assignee: string): Promise<void> {
  const principal = await repository.resolvePrincipal(assignee);
  if (!principal) throw new WorkItemRejected("That assignee no longer exists.", "لم يعد هذا المسند إليه موجوداً.");
  if (principal.type === "Agent") return assignToAgent(key, assignee);

  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  if (item.reviewerId === principal.id) {
    throw new WorkItemRejected("Reviewer must differ from assignee.", "يجب أن يختلف المراجع عن المسند إليه.");
  }
  await repository.assign(key, principal, item.version, session.personId);
  if (item.status === "Backlog") {
    const after = await repository.readForActions(key);
    if (after) await repository.changeStatus(key, "ToDo", after.version, session.personId);
  }
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "Assigned",
    detailEn: "assigned this to a person",
    detailAr: "أسند هذا إلى شخص",
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:write",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { assignee: { type: "Person", id: principal.id } },
  });
}

/** `UC-25.2-01`: hand the work to its reviewer. */
export async function submitForReview(key: string): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  // D331: the item's own person assignee submits it from wherever they sit.
  const assignee = item.assigneeType === "Person" && item.assigneeId === session.personId;
  if (!assignee) await requireProjectPermission("work_items:write", item.projectId);
  if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(item.status)) {
    throw new WorkItemRejected("Only work that is to do or in progress can be submitted.", "لا يُقدَّم إلا العمل في حالة للتنفيذ أو قيد التنفيذ.");
  }

  await repository.changeStatus(key, "InReview", item.version, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "SubmittedForReview",
    detailEn: "submitted this for review",
    detailAr: "أرسل هذا للمراجعة",
  });
  // The reviewer is told, because a review nobody knows about is not a review.
  if (item.reviewerId) {
    await repository.notifyReviewer({ reviewerId: item.reviewerId, workItemId: item.id }, session.personId);
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:review",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { submitted: true },
  });
}

/**
 * D346: an agent's mission on the work item it is assigned succeeded, so the work goes to review,
 * as the person behind the run would send it with Submit for review. Only while the agent is
 * still the assignee and the item is to do or in progress: an item somebody has moved on or given
 * to someone else is left as it is. A refusal is written in the item's history rather than failing
 * the run, which has already done its work.
 */
export async function submitAgentWork(input: { workItemId: string; agentId: string; agentCode: string; runId: string }): Promise<void> {
  const key = await repository.workItemKeyOf(input.workItemId);
  if (!key) return;
  const item = await repository.readForActions(key);
  if (!item || item.assigneeType !== "Agent" || item.assigneeId !== input.agentId) return;
  if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(item.status)) return;
  try {
    // As the person behind the run, through the agent and its run, so the history names the agent.
    const session = await requirePermission("work_items:write");
    await runAs(session.personId, { id: input.agentId, label: input.agentCode, runId: input.runId }, () => submitForReview(key));
  } catch (problem) {
    const refused =
      problem instanceof Rejected
        ? { en: problem.message, ar: problem.messageAr }
        : problem instanceof NotPermitted
          ? { en: "the person it works for may not change work items in this project", ar: "لا يملك الشخص الذي يعمل له صلاحية تعديل بنود العمل في هذا المشروع" }
          : null;
    if (!refused) throw problem;
    logger().warn({ key, problem: refused.en }, "an agent's finished work item could not be submitted for review");
    await repository.recordActivity({
      workItemId: input.workItemId,
      actorType: "Agent",
      actorId: input.agentId,
      eventType: "Commented",
      detailEn: `finished its work but could not submit it for review: ${refused.en}`,
      detailAr: `أنهى عمله لكن تعذّر إرساله للمراجعة: ${refused.ar}`,
    });
  }
}

/**
 * `UC-25.2-02` and `UC-25.2-08`: finish the work.
 *
 * A parent with open sub items is not done, whatever its own column says. Someone who may
 * review may override that, with a reason, because the sub items may have been overtaken —
 * but never silently.
 */
export async function approve(key: string, override?: string): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  // D331: the item's reviewer decides it from wherever they sit.
  if (item.reviewerId !== session.personId) await requireProjectPermission("work_items:write", item.projectId);
  if (!mayApprove(item, session.personId)) {
    throw new WorkItemRejected("You cannot approve your own work item.", "لا يمكنك اعتماد بند عملك.");
  }
  if (item.openSubItems > 0 && !override?.trim()) {
    throw new WorkItemRejected("Close or cancel sub items first.", "أغلق البنود الفرعية أو ألغِها أولاً.");
  }

  await repository.changeStatus(key, "Done", item.version, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "Approved",
    detailEn: override ? `approved this, overriding open sub items: ${override}` : "approved this",
    detailAr: override ? `اعتمد هذا متجاوزاً البنود الفرعية المفتوحة: ${override}` : "اعتمد هذا",
  });
  // `UC-25.2-02`: the request this work belongs to is told, because a request whose work
  // is finished and which still says In progress is a question nobody is answering.
  const request = await repository.requestOfWorkItem(key);
  if (request && (await repository.requestWorkIsDone(request.id))) {
    await requests.workFinished(request.key);
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:review",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { approved: true, overrode: !!override },
  });
}

/**
 * `UC-25.2-03`: send the work back with what to change.
 *
 * An agent assignee is started again with the comment, because the comment is the whole
 * instruction and nobody else is going to act on it.
 */
export async function requestChanges(key: string, comment: string): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  // D331: the item's reviewer sends it back from wherever they sit.
  if (item.reviewerId !== session.personId) await requireProjectPermission("work_items:write", item.projectId);
  if (item.status !== "InReview") throw new WorkItemRejected("Only work in review can be sent back.", "لا يُعاد إلا العمل قيد المراجعة.");
  if (!comment.trim()) throw new WorkItemRejected("Say what needs to change.", "اذكر ما الذي يجب تغييره.");

  await repository.changeStatus(key, "InProgress", item.version, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "ChangesRequested",
    detailEn: `asked for changes: ${comment}`,
    detailAr: `طلب تعديلات: ${comment}`,
  });

  if (item.assigneeAgent) {
    try {
      await agents.startRun({
        agentCode: item.assigneeAgent,
        // D384: what was asked for, with the item's brief, so the agent knows what it is changing.
        prompt: agents.withBrief(`Changes were requested on ${key}: ${comment}`, await workItemBrief(key), key),
        surface: "WorkItem",
        contextId: key,
      });
    } catch (problem) {
      logger().warn({ key, problem }, "the agent was not re-triggered after changes were requested");
    }
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:review",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { changesRequested: true },
  });
}

/** `UC-25.2-05`: take the block off, and put the item back where it was. */
export async function unblock(key: string): Promise<string> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  if (item.status !== "Blocked") throw new WorkItemRejected("That work item is not blocked.", "بند العمل هذا غير معطّل.");

  const previous = await repository.statusBeforeBlocked(key);
  await repository.unblock(key, previous, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "Unblocked",
    detailEn: `unblocked this, back to ${previous}`,
    detailAr: `أزال التعطيل، والعودة إلى ${previous}`,
  });
  return previous;
}

/** `UC-25.2-07`: finished work that turned out not to be. */
export async function reopen(key: string, reason: string): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  if (item.status !== "Done") throw new WorkItemRejected("Only finished work can be reopened.", "لا يُعاد فتح إلا العمل المنتهي.");
  // The reason is what makes a reopen countable: without it nobody can tell why quality
  // moved, which is the only reason to count them.
  if (!reason.trim()) throw new WorkItemRejected("Say why this is being reopened.", "اذكر سبب إعادة الفتح.");

  await repository.changeStatus(key, "ToDo", item.version, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "Reopened",
    detailEn: `reopened this: ${reason}`,
    detailAr: `أعاد فتح هذا: ${reason}`,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:reopen",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { reason },
  });
}

/** `UC-25.2-06` and `UC-25.2-09`: give the work to an agent, which starts it. */
export async function assignToAgent(key: string, agentCode: string): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);

  const allowed = await repository.agentsAllowedInProject(item.projectKey);
  if (allowed.length > 0 && !allowed.includes(agentCode)) {
    throw new WorkItemRejected("That agent is not allowed in this project.", "هذا الوكيل غير مسموح به في هذا المشروع.");
  }

  const assignee = await repository.resolvePrincipal(agentCode);
  if (!assignee) throw new WorkItemRejected("That agent no longer exists.", "لم يعد هذا الوكيل موجوداً.");
  await repository.assign(key, assignee, item.version, session.personId);

  // The run is what moves it on: an item left In progress with nothing running would be a
  // lie about work that is not happening. One that cannot start leaves the item To do with
  // the agent on it, and says why, so somebody can retry or give it to someone else
  // (`UC-25.2-09`).
  try {
    await agents.startRun({
      agentCode,
      prompt: agents.withBrief(`Work item ${key} was assigned to you.`, await workItemBrief(key), key),
      surface: "WorkItem",
      contextId: key,
    });
  } catch (problem) {
    if (!(problem instanceof Rejected)) throw problem;
    const waiting = await repository.readForActions(key);
    if (waiting?.status === "Backlog") await repository.changeStatus(key, "ToDo", waiting.version, session.personId);
    throw new WorkItemRejected(`${agentCode} could not start: ${problem.message}`, `تعذّر تشغيل ${agentCode}: ${problem.messageAr}`);
  }
  const after = await repository.readForActions(key);
  if (after) await repository.changeStatus(key, "InProgress", after.version, session.personId);
}
