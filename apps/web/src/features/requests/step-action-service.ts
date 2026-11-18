import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/session";
import { routeFor } from "./routing";
import * as repository from "./repository";
import type { StepActionInput } from "./schema";
import { attributesProblem } from "./attributes";
import { AttributeError, RequestRejected } from "./errors";
import { boundAgent, mayApproveOwn, stepActors } from "./step-actors-service";
import { triggerAgentAudience } from "./step-agent-service";

/** What a step action did. */
export type StepOutcome = {
  /** The step the request is at afterwards, or null when it reached a terminal one. */
  toStepName: string | null;
  status: string;
  /** `UC-29.2-09`: nothing routed it, so it stayed where it was and said so. */
  noMatchingRoute: boolean;
};

/**
 * A decision's history line with the files that go with it (D218). The files are ones already
 * attached to the request; a name that is not one of them is refused rather than recorded.
 */
async function withAttachments(
  requestId: string,
  detail: { en: string; ar: string },
  names: string[] | undefined,
): Promise<{ en: string; ar: string }> {
  if (!names?.length) return detail;
  const attached = await repository.attachmentNamesOf(requestId);
  const missing = names.filter((name) => !attached.includes(name));
  if (missing.length) {
    throw new RequestRejected(
      `${missing.join(", ")} is not attached to this request.`,
      `${missing.join("، ")} غير مرفق بهذا الطلب.`,
    );
  }
  return { en: `${detail.en} · Attachments: ${names.join(", ")}`, ar: `${detail.ar} · المرفقات: ${names.join("، ")}` };
}

/** An approval of one's own request, which separation of duties keeps from the requester (`UC-29.2-07`). */
const isApproval = (action: string) => /approve/i.test(action);

/**
 * The fields of a step action an agent needs a person's approval for (D58, D141).
 *
 * An agent acting for the requester may not approve the request itself, but the work it
 * was given may be exactly that approval. So the call is escalated rather than refused:
 * a person who holds `approvals:decide` and is not the requester decides it, and the
 * approved retry is the one that moves the request.
 */
export async function stepActionEscalates(input: StepActionInput, personId: string): Promise<string[]> {
  if (!isApproval(input.action)) return [];
  const request = await repository.readForAction(input.key);
  return request && request.requesterId === personId && !mayApproveOwn(request, personId) ? ["action"] : [];
}

/**
 * `UC-29.2-01`, `-04`, `-08` and `-09`: take a step action and route the request.
 *
 * The routing rules of the pinned version decide where it goes; nothing here hard-codes a
 * step name. A request the rules do not route stays where it is and is flagged, because a
 * request sent somewhere nobody chose is worse than one that stops.
 */
export async function takeStepAction(input: StepActionInput): Promise<StepOutcome> {
  const session = await requirePermission("requests:write");

  const request = await repository.readForAction(input.key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");

  // `UC-29.2-07`: the requester is not offered an approval of their own request, and the
  // refusal is here rather than on the screen so no caller can go round it. An agent acting
  // for the requester is the requester here, whatever audience the agent is, so it waits for
  // a bound approval decided by somebody else (D141); the MCP boundary spends it first.
  // A step that names the requester among its audiences lets them approve it (D217).
  const ownApproval =
    request.requesterId === session.personId && isApproval(input.action) && !mayApproveOwn(request, session.personId);
  if (ownApproval && !session.approvedFields.includes("action")) {
    if (!session.actingAgent) {
      throw new RequestRejected("You cannot approve your own request.", "لا يمكنك اعتماد طلبك.");
    }
    throw new ApprovalRequired({
      tool: "request_step_action_create",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: ["action"],
      expectedVersion: null,
      reasons: ["The requester cannot approve their own request; somebody else has to decide it."],
    });
  }
  // Who agreed, on the record the step moves: the requester's agent took the action, and
  // the history has to say it was not the requester's own approval.
  const approvedBy = ownApproval && session.approvalKey ? ` (${session.approvalKey})` : "";

  const agentId = await boundAgent(session, request.id);
  const actors = await stepActors(request, session.personId, agentId);
  if (!actors.mayAct) {
    throw new RequestRejected(
      actors.reason ?? "You cannot act on this step.",
      actors.reasonAr ?? "لا يمكنك التصرف في هذه الخطوة.",
    );
  }

  // D304: the attributes this step asks are answered with the action, checked by the rule the
  // form uses, and the routing reads them with the rest.
  const attributes = input.attributes ? { ...request.attributes, ...input.attributes } : request.attributes;
  // Only what this step asks and what the action gives: a value stored before is not re-judged here.
  const asked = (await repository.attributesOfVersion(request.versionId)).filter(
    (definition) => definition.stepName === request.currentStepName || (input.attributes && definition.key in input.attributes),
  );
  const problem = attributesProblem(asked, attributes, request.currentStepName);
  if (problem) throw new AttributeError(problem.key, problem.en, problem.ar);

  const outcome = routeFor(
    request.rules.map((rule) => ({
      kind: rule.kind as "Condition" | "Action",
      expression: rule.expression,
      actionName: rule.actionName,
      toStepName: rule.toStepName,
    })),
    input.action,
    attributes,
  );

  if (!outcome.matched) {
    await repository.recordEvent({
      requestId: request.id,
      actorId: session.personId,
      agentId,
      eventType: "ActionTaken",
      detailEn: `No matching route for "${input.action}".`,
      detailAr: `لا يوجد مسار مطابق لـ "${input.action}".`,
    });
    logger().warn({ request: request.key, action: input.action }, "a request had no matching route");
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "requests:step",
      objectType: "Request",
      objectLabel: request.key,
      outcome: "Denied",
      detail: { action: input.action, reason: "no matching route" },
    });
    return { toStepName: null, status: request.status, noMatchingRoute: true };
  }

  const target = outcome.toStepName ? await repository.stepByName(request.versionId, outcome.toStepName) : null;
  // `UC-29.2-08`: a rule with no target, or one pointing at a terminal step, finishes the
  // request — as whatever that terminal step is marked, Completed or Rejected. Collapsing
  // both into "Completed" is the earlier defect this closes: a request the designer's own
  // flow rejects read as indistinguishable from one that succeeded, in the list, the filter
  // and the vocabulary that already named "Rejected" with nothing that could ever produce it.
  const status = target === null ? "Completed" : target.isTerminal ? target.terminalOutcome : "InReview";

  const said = `${input.action}${approvedBy}${input.comment ? `: ${input.comment}` : ""}`;
  const detail = await withAttachments(request.id, { en: said, ar: said }, input.attachments);
  await repository.moveToStep({
    requestId: request.id,
    toStepId: target?.id ?? null,
    status,
    actorId: session.personId,
    agentId,
    eventType: "ActionTaken",
    detailEn: detail.en,
    detailAr: detail.ar,
    attributes: input.attributes ? attributes : undefined,
    given: input.attributes,
  });
  if (target && !target.isTerminal) {
    await triggerAgentAudience({ requestId: request.id, requestKey: request.key, stepId: target.id, stepName: outcome.toStepName, actorId: session.personId });
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: input.action, from: request.currentStepName, to: outcome.toStepName, status },
  });
  return { toStepName: outcome.toStepName, status, noMatchingRoute: false };
}

/**
 * `UC-29.2-02`: send a request back to the step its requester is at, with a comment.
 *
 * The first step is where a request starts, so that is where the requester is asked to
 * change it. The comment is the point of the act, so it is required.
 */
export async function requestChanges(
  key: string,
  comment: string,
  attachments?: string[],
): Promise<{ toStepName: string | null }> {
  const session = await requirePermission("requests:write");
  if (comment.trim() === "") throw new RequestRejected("Say what needs changing.", "اذكر ما الذي يحتاج إلى تغيير.");

  const request = await repository.readForAction(key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const agentId = await boundAgent(session, request.id);
  const actors = await stepActors(request, session.personId, agentId);
  if (!actors.mayAct) {
    throw new RequestRejected(
      actors.reason ?? "You cannot act on this step.",
      actors.reasonAr ?? "لا يمكنك التصرف في هذه الخطوة.",
    );
  }

  const first = await repository.firstStepOf(request.versionId);
  const detail = await withAttachments(
    request.id,
    { en: `Returned: ${comment}`, ar: `أُعيد: ${comment}` },
    attachments,
  );
  await repository.moveToStep({
    requestId: request.id,
    toStepId: first?.id ?? null,
    status: "Submitted",
    actorId: session.personId,
    agentId,
    eventType: "Returned",
    detailEn: detail.en,
    detailAr: detail.ar,
  });
  if (first) {
    await triggerAgentAudience({ requestId: request.id, requestKey: request.key, stepId: first.id, stepName: first.nameEn, actorId: session.personId });
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: "Request changes", to: first?.nameEn ?? null },
  });
  return { toStepName: first?.nameEn ?? null };
}

/**
 * Reject a request from the step it is at (D218): every step offers it, as it offers Return,
 * so a duplicate or wrong request can be ended where the designer drew no rejecting route. The
 * request ends Rejected, and why is required.
 */
export async function rejectRequest(key: string, comment: string, attachments?: string[]): Promise<void> {
  const session = await requirePermission("requests:write");
  if (comment.trim() === "") throw new RequestRejected("Say why it is rejected.", "اذكر سبب الرفض.");

  const request = await repository.readForAction(key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const agentId = await boundAgent(session, request.id);
  const actors = await stepActors(request, session.personId, agentId);
  if (!actors.mayAct) {
    throw new RequestRejected(
      actors.reason ?? "You cannot act on this step.",
      actors.reasonAr ?? "لا يمكنك التصرف في هذه الخطوة.",
    );
  }

  const detail = await withAttachments(request.id, { en: `Rejected: ${comment}`, ar: `رُفض: ${comment}` }, attachments);
  await repository.moveToStep({
    requestId: request.id,
    toStepId: null,
    status: "Rejected",
    actorId: session.personId,
    agentId,
    eventType: "ActionTaken",
    detailEn: detail.en,
    detailAr: detail.ar,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: "Reject", from: request.currentStepName, status: "Rejected" },
  });
}
