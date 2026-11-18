import { audit } from "@/lib/audit";
import { can, requirePermission, type Session } from "@/lib/session";
import { RequestRejected } from "./errors";
import { actionsOf } from "./routing";
import * as repository from "./repository";

/** The run statuses in which a run still acts. A token can outlive its run; the authority does not. */
const LIVE_RUN_STATUSES = ["Queued", "Running", "Waiting"];

/**
 * The agent that may act on this request as an audience of its own, or null.
 *
 * The rule "agent audience, step-bound": an agent acts as an `Agent` audience only from a
 * live run whose context is this request. The run is the run token's own, set on the session
 * by the MCP server, never an argument the model wrote. An integration client, a person in
 * the console and a run about anything else all get null and are judged as the person alone.
 */
export async function boundAgent(session: Session, requestId: string): Promise<string | null> {
  const agent = session.actingAgent;
  if (!agent?.runId) return null;
  const run = await repository.runBinding(agent.runId);
  if (!run || run.agentId !== agent.id || run.personId !== session.personId) return null;
  if (run.contextType !== "Request" || run.contextId !== requestId) return null;
  return LIVE_RUN_STATUSES.includes(run.status) ? agent.id : null;
}

/**
 * Whether the requester may approve their own request: only when the step names them, as a
 * person, among the audiences that can act (D217). Separation of duties holds everywhere else.
 */
export function mayApproveOwn(
  request: { requesterId: string | null; audiences: { principalType: string; principalId: string | null; access: string }[] },
  personId: string,
): boolean {
  return (
    request.requesterId === personId &&
    request.audiences.some(
      (audience) => audience.principalType === "Person" && audience.principalId === personId && audience.access === "CanAct",
    )
  );
}

/**
 * Whether one person, or the agent acting for them, may act on the step a request is at
 * (`UC-29.2-06`, `-07`).
 *
 * An audience is reached by being named, by a group they belong to, by a role they hold in
 * the request's project (`rolesOf`, `UC-41.2-03`), or by being the requester where the step
 * names `Requester`. An `Agent` audience is reached only by `agentId`, which is `boundAgent`'s
 * answer. Only `CanAct` may act; the other two
 * accesses read. A sequential audience acts in order, so somebody later in the sequence
 * waits for the one before them.
 */
export async function stepActors(
  request: Awaited<ReturnType<typeof repository.readForAction>>,
  personId: string,
  agentId: string | null = null,
): Promise<{ mayAct: boolean; waitingOn: number | null; reason: string | null; reasonAr: string | null }> {
  if (!request) {
    return { mayAct: false, waitingOn: null, reason: "That request no longer exists.", reasonAr: "لم يعد هذا الطلب موجوداً." };
  }
  if (request.currentStepIsTerminal || request.currentStepId === null) {
    // `UC-29.2-08`: a request at a terminal step is finished, so it offers no actions.
    return { mayAct: false, waitingOn: null, reason: "This request is closed.", reasonAr: "هذا الطلب مغلق." };
  }
  // A step somebody has taken is theirs until it moves (D147). An agent acting for that
  // person is them here, as it is for the requester rule.
  if (request.claimedBy !== null && request.claimedBy !== personId) {
    const who = request.claimedByName ?? "Another person";
    return { mayAct: false, waitingOn: null, reason: `${who} has taken this step.`, reasonAr: `تولّى ${who} هذه الخطوة.` };
  }

  const [groups, roles] = await Promise.all([repository.groupsOf(personId), repository.rolesOf(personId, request.projectId)]);
  const reaches = (audience: (typeof request.audiences)[number]) => {
    switch (audience.principalType) {
      case "Requester":
        return request.requesterId === personId;
      case "Person":
        return audience.principalId === personId;
      case "Group":
        return audience.principalId !== null && groups.includes(audience.principalId);
      case "Role":
        return audience.principalId !== null && roles.includes(audience.principalId);
      case "Agent":
        return agentId !== null && audience.principalId === agentId;
      default:
        return false;
    }
  };

  const mine = request.audiences.filter(reaches);
  if (mine.length === 0) {
    return { mayAct: false, waitingOn: null, reason: "You are not an audience of this step.", reasonAr: "لست ضمن جمهور هذه الخطوة." };
  }
  if (!mine.some((audience) => audience.access === "CanAct")) {
    return {
      mayAct: false,
      waitingOn: null,
      reason: "You can read this request but not act on it.",
      reasonAr: "يمكنك قراءة هذا الطلب دون التصرف فيه.",
    };
  }

  // `UC-29.2-05`: a sequential audience acts in order. The lowest sequence still waiting is
  // whose turn it is; an audience without a sequence is not part of the ordering.
  const sequenced = request.audiences.filter((audience) => audience.access === "CanAct" && audience.sequence !== null);
  if (sequenced.length > 1) {
    const turn = Math.min(...sequenced.map((audience) => audience.sequence as number));
    const mineInOrder = mine.filter((audience) => audience.sequence !== null);
    if (mineInOrder.length > 0 && !mineInOrder.some((audience) => audience.sequence === turn)) {
      return {
        mayAct: false,
        waitingOn: turn,
        reason: "Another audience acts on this step first.",
        reasonAr: "يتصرف جمهور آخر في هذه الخطوة أولاً.",
      };
    }
  }
  return { mayAct: true, waitingOn: null, reason: null, reasonAr: null };
}

/** Who has the request's current step, as the request screen shows it. */
export type StepClaim = { by: string | null; mine: boolean; mayTake: boolean };

/** What a person is offered on a request: the actions, or why there are none, in both languages. */
export type OfferedActions = { actions: string[]; reason: string | null; reasonAr: string | null; claim: StepClaim };

/** `UC-29.2-01` and `-06`: the actions this person is offered on a request, which may be none. */
export async function actionsFor(key: string): Promise<OfferedActions> {
  const session = await requirePermission("requests:read");
  const request = await repository.readForAction(key);
  if (!request) {
    return {
      actions: [],
      reason: "That request no longer exists.",
      reasonAr: "لم يعد هذا الطلب موجوداً.",
      claim: { by: null, mine: false, mayTake: false },
    };
  }

  const actors = await stepActors(request, session.personId, await boundAgent(session, request.id));
  const claimOf = (mayTake: boolean): StepClaim => ({
    by: request.claimedByName,
    mine: request.claimedBy === session.personId,
    mayTake: mayTake && request.claimedBy === null,
  });
  if (!actors.mayAct) return { actions: [], reason: actors.reason, reasonAr: actors.reasonAr, claim: claimOf(false) };
  // An audience member who may only read requests is told so, rather than offered actions
  // `takeStepAction` refuses (it needs `requests:write`).
  if (!(await can("requests:write"))) {
    return {
      actions: [],
      reason: "You can read this request but not act on it.",
      reasonAr: "يمكنك قراءة هذا الطلب دون التصرف فيه.",
      claim: claimOf(false),
    };
  }

  const offered = actionsOf(
    request.rules.map((rule) => ({
      kind: rule.kind as "Condition" | "Action",
      expression: rule.expression,
      actionName: rule.actionName,
      toStepName: rule.toStepName,
    })),
  );
  // `UC-29.2-07`: an approval of one's own request is not among them unless the step names the
  // requester (D217), and a step that offers nothing else says so rather than showing nothing.
  const ownBlocked = request.requesterId === session.personId && !mayApproveOwn(request, session.personId);
  const actions = ownBlocked ? offered.filter((action) => !/approve/i.test(action)) : offered;
  const ownApproval = actions.length === 0 && offered.length > 0;
  return {
    actions,
    reason: ownApproval ? "You cannot approve your own request." : null,
    reasonAr: ownApproval ? "لا يمكنك اعتماد طلبك." : null,
    // A step is taken to act on it, so one with nothing left to offer this person is not.
    claim: claimOf(actions.length > 0),
  };
}

/**
 * Take the request's current step (D147): the other audiences of the step wait until it moves
 * on or is released. Only somebody who may act on the step may take it.
 */
export async function takeStep(key: string): Promise<void> {
  const session = await requirePermission("requests:write");
  const request = await repository.readForAction(key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const actors = await stepActors(request, session.personId);
  if (!actors.mayAct || request.currentStepId === null) {
    throw new RequestRejected(actors.reason ?? "You cannot act on this step.", actors.reasonAr ?? "لا يمكنك التصرف في هذه الخطوة.");
  }
  if (request.claimedBy === session.personId) return;
  const taken = await repository.claimStep({ requestId: request.id, stepId: request.currentStepId, personId: session.personId });
  if (!taken) throw new RequestRejected("Somebody else has just taken this step.", "تولّى شخص آخر هذه الخطوة للتو.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: "Take step", step: request.currentStepName },
  });
}

/** Hand back a step this person took, so the other audiences may act again (D147). */
export async function releaseStep(key: string): Promise<void> {
  const session = await requirePermission("requests:write");
  const request = await repository.readForAction(key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const first = await repository.firstStepOf(request.versionId);
  const released = await repository.releaseStep({
    requestId: request.id,
    personId: session.personId,
    status: first?.id === request.currentStepId ? "Submitted" : "InReview",
  });
  if (!released) throw new RequestRejected("You have not taken this step.", "لم تتولَّ هذه الخطوة.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: "Release step", step: request.currentStepName },
  });
}
