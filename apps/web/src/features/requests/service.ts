import * as agents from "@/features/agents/service";
import { requestBrief } from "./brief-service";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { can, requirePermission, requireProjectPermission, requireSession, visibleProjectIds } from "@/lib/session";
import { attributesProblem } from "./attributes";
import * as repository from "./repository";
import type { CreateRequestInput } from "./schema";
import type { RequestFilters } from "./types";
import { AttributeError, RequestRejected } from "./errors";
import { startFirstStep } from "./step-agent-service";

export { AttributeError, FlowNotPublishable, RequestTypeRejected, RequestRejected } from "./errors";
export { stepActors, actionsFor, takeStep, releaseStep, type OfferedActions, type StepClaim } from "./step-actors-service";
export { assignToAgent, noteAgentStopped } from "./step-agent-service";
export { inquireRequests, loadRequestReport, requestReportChoices, type RequestReport } from "./report-service";
export { applyAgentDecision } from "./step-decision-service";
export { type StepOutcome, takeStepAction, requestChanges, rejectRequest, stepActionEscalates } from "./step-action-service";
export {
  publishRequestType,
  createRequestType,
  deleteRequestType,
  saveDraft,
  addAttribute,
  updateAttribute,
  removeAttribute,
} from "./request-type-service";
export {
  addStep,
  type StepDiff,
  updateStep,
  setStepSla,
  setStepTerminal,
  moveStep,
  type StepRemoval,
  deleteStep,
  addAudience,
  addRule,
  updateRule,
  removeAudience,
  removeRule,
} from "./step-design-service";
export {
  createFromSchedule,
  createFromConversation,
  type IntakeProfile,
  intakeProfile,
  createFromIntakeWidget,
} from "./intake-service";

/** S-27 the list, S-28 the request detail, S-29 and S-30 the request type designer. */

/**
 * One page of the requests the signed-in person may see, newest first, with how many match
 * the filters, and the request types to filter by (D349). Requires `requests:read`.
 */
export async function loadRequests(filters: RequestFilters = {}, page = { limit: SERVER_PAGE_SIZE, offset: 0 }) {
  const session = await requirePermission("requests:read");
  const [listed, types] = await Promise.all([
    // `UC-27.1-05`: a request outside this person's projects and not their own is not listed.
    repository.listRequestPage(await visibleProjectIds("requests:read"), session.personId, filters, page),
    repository.listRequestTypes(),
  ]);
  return { requests: listed.rows, total: listed.total, types };
}

/** The request types, whether the signed-in person may change them, and the platform origin. Requires `requests:read`. */
export async function loadRequestTypes() {
  await requirePermission("requests:read");
  const [types, mayWriteTypes] = await Promise.all([
    repository.listRequestTypes(),
    // `UC-27.2-05`: the Request types screen is read-only for somebody who may not change one.
    can("request_types:write"),
  ]);
  // `UC-30.1-04`: the designer builds the embed snippet from this, so the origin it names
  // is the platform's own rather than whichever host the console happens to be open on.
  return { types, mayWriteTypes, appUrl: env().APP_URL.replace(/\/$/, "") };
}

/**
 * One request as its list row and its detail, by key, whether or not it is on the list's
 * current page; `null` when there is none or the signed-in person may not see it.
 */
export async function loadRequest(key: string) {
  const session = await requirePermission("requests:read");
  const listed = await repository.listRequestPage(await visibleProjectIds("requests:read"), session.personId, { key }, { limit: 1, offset: 0 });
  const request = listed.rows[0];
  if (!request) return null;
  const detail = await repository.readRequestDetail(key);
  return detail ? { request, detail } : null;
}

/**
 * Whether the signed-in person may read a request, by the rule of their request list
 * (`UC-27.1-05`): the request's project, or a request that is theirs. Needs `requests:read`.
 */
async function mayReadRequest(key: string): Promise<boolean> {
  const session = await requirePermission("requests:read");
  return repository.requestVisibleTo(key, await visibleProjectIds("requests:read"), session.personId);
}

/** One request's detail by key, for a holder of `requests:read`; `null` when there is none or they may not see it. */
export async function loadRequestDetail(key: string) {
  if (!(await mayReadRequest(key))) return null;
  return repository.readRequestDetail(key);
}

/** What a request looks like when it is converted into a discussion room; `null` as `loadRequestDetail`. */
export async function loadRequestForRoom(key: string) {
  if (!(await mayReadRequest(key))) return null;
  return repository.requestRoomSummary(key);
}

/**
 * One request type by code: its newest version with the preferred status, or its newest version
 * when it has none; `null` for an unknown code. Needs `requests:read`.
 */
export async function loadRequestTypeDetail(code: string, prefer: "published" | "draft" = "published") {
  await requirePermission("requests:read");
  return repository.readRequestTypeDetail(code, prefer);
}

/**
 * Raises a request for the caller, who needs `requests:write` in its project. The form's
 * attributes are checked first, and a parent key must name a request the caller may see.
 * Audited as `requests:write`; then the request is handed to the decomposition agent when its
 * type asks for one, and the first step's agent audience is started. Returns the new key.
 */
export async function createRequest(input: CreateRequestInput): Promise<string> {
  await requirePermission("requests:write");
  const projectId = await repository.projectIdByKey(input.projectKey);
  if (!projectId) throw new RequestRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  // `UC-41.2-03`: a role assigned in one unit raises requests in that unit's projects only.
  const session = await requireProjectPermission("requests:write", projectId);
  // The form's attributes are required here; a step's are asked at that step (D304).
  const problem = attributesProblem(await repository.attributeDefinitionsOf(input.requestTypeCode), input.attributes, null);
  if (problem) throw new AttributeError(problem.key, problem.en, problem.ar);
  // A sub request hangs off a request the person may see, by the same rule as their list.
  const parent = input.parentKey
    ? (await repository.listRequestPage(await visibleProjectIds("requests:read"), session.personId, { key: input.parentKey }, { limit: 1, offset: 0 })).rows[0]
    : undefined;
  if (input.parentKey && !parent) {
    throw new RequestRejected(`There is no request ${input.parentKey} you may see.`, `لا يوجد طلب ${input.parentKey} يمكنك رؤيته.`);
  }
  // A request raised from a room message names the room, which the person has to be able to read.
  let originRoomId: string | null = null;
  if (input.originRoomKey) {
    await requirePermission("rooms:read");
    originRoomId = await repository.roomIdByKey(input.originRoomKey);
    if (!originRoomId) throw new RequestRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");
  }
  const key = await repository.createRequest({
    originRoomId,
    parentRequestId: parent ? await repository.requestIdByKey(parent.k) : null,
    projectKey: input.projectKey,
    requestTypeCode: input.requestTypeCode,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn ?? null,
    entryMode: input.entryMode,
    attributes: input.attributes,
    requesterId: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:write",
    objectType: "Request",
    objectLabel: key,
    detail: { type: input.requestTypeCode, project: input.projectKey },
  });
  await decompose(key, session.personId, session.nameEn);
  await startFirstStep(key, session.personId);
  return key;
}

/**
 * `UC-29.2-10`: a type whose decomposition is Agent or Hybrid has an agent break the request
 * down into sub requests and work items.
 *
 * The run is started under the person who raised the request, so what it may read is what
 * they may read, and it writes through the platform MCP tools like any other run. A run
 * that will not start leaves the request as it is rather than failing the submission: the
 * request was raised, and that is what the person asked for.
 */
async function decompose(key: string, personId: string, personName: string): Promise<void> {
  const target = await repository.decompositionOf(key);
  if (!target || (target.decomposition !== "Agent" && target.decomposition !== "Hybrid")) return;

  const planner = await repository.decompositionAgent();
  if (!planner) {
    logger().warn({ request: key }, "a request needs decomposition and no planner agent is published");
    return;
  }
  try {
    await agents.startRun({
      agentCode: planner,
      prompt: agents.withBrief(
        `Break request ${key} down into the sub requests and work items it needs. ` +
          "Create each work item with the platform tools and leave them linked to this request.",
        await requestBrief(key),
        key,
      ),
      surface: "Request",
      contextId: key,
    });
    await repository.recordEvent({
      requestId: target.requestId,
      actorId: personId,
      eventType: "Assigned",
      detailEn: `${planner} is breaking this down.`,
      detailAr: `${planner} يقوم بتجزئة هذا الطلب.`,
    });
  } catch (problem) {
    logger().warn({ request: key, problem: String(problem) }, "the decomposition run did not start");
    await repository.recordEvent({
      requestId: target.requestId,
      actorId: personId,
      eventType: "Comment",
      detailEn: `Could not start ${planner} to break this down.`,
      detailAr: `تعذّر تشغيل ${planner} لتجزئة هذا الطلب.`,
    });
  }
  void personName;
}

/**
 * `UC-25.2-02`: the work a request asked for is finished.
 *
 * Called when the last work item of a request is approved. A request whose work is done
 * and which still says In review is a question nobody is answering, so it moves itself on
 * and says in its own history why.
 */
export async function workFinished(key: string): Promise<void> {
  const session = await requireSession();
  // D312: only a request its type breaks down into work items is finished by that work; the
  // steps decide any other, so work added to it does not skip them.
  const target = await repository.decompositionOf(key);
  if (!target || target.decomposition === "None") return;
  await repository.completeRequest(key, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:complete",
    objectType: "Request",
    objectLabel: key,
    detail: { reason: "every work item is finished" },
  });
}

/**
 * Removes a request, with the decision log that is its own history. Needs `requests:write` in
 * the request's project.
 *
 * Refused while anything else still points at it: an approval or deployment conversation
 * raised from it, a child request it is the parent of, a schedule run that created it, or a
 * work item raised from it. A channel message naming it is not a blocker — that reference
 * clears to null on its own.
 */
export async function deleteRequest(key: string): Promise<void> {
  await requirePermission("requests:write");

  const request = await repository.requestScopeByKey(key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const session = await requireProjectPermission("requests:write", request.projectId);

  const blockers = await repository.requestDeleteBlockers(request.id);
  const inUse = [
    blockers.approvals && `${blockers.approvals} approvals`,
    blockers.deploymentConversations && `${blockers.deploymentConversations} deployment conversations`,
    blockers.childRequests && `${blockers.childRequests} requests raised from it`,
    blockers.scheduleRuns && `${blockers.scheduleRuns} schedule runs`,
    blockers.workItems && `${blockers.workItems} work items`,
  ].filter(Boolean);
  const inUseAr = [
    blockers.approvals && `${blockers.approvals} موافقات`,
    blockers.deploymentConversations && `${blockers.deploymentConversations} محادثات نشر`,
    blockers.childRequests && `${blockers.childRequests} طلبات منشأة منه`,
    blockers.scheduleRuns && `${blockers.scheduleRuns} تشغيلات جدولة`,
    blockers.workItems && `${blockers.workItems} بنود عمل`,
  ].filter(Boolean);
  if (inUse.length) {
    throw new RequestRejected(
      `This request cannot be deleted: it still has ${inUse.join(", ")}.`,
      `لا يمكن حذف هذا الطلب: لا يزال لديه ${inUseAr.join("، ")}.`,
    );
  }

  await repository.deleteRequest(request.id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:delete",
    objectType: "Request",
    objectLabel: key,
  });
}

/* ------------------------------------------------- S-30: editing a request type's draft */

/* --------------------------------------------- S-29: acting on the step a request is at */
