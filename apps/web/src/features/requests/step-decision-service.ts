import { logger } from "@/lib/logger";
import { Rejected } from "@/lib/rejection";
import { NotPermitted, requirePermission, runAs } from "@/lib/session";
import * as repository from "./repository";
import { actionsOf, type Rule } from "./routing";
import { rejectRequest, requestChanges, takeStepAction } from "./step-action-service";
import { REJECT_ACTION, RETURN_ACTION, stepDecisionOf, type StepDecision } from "./step-contract";

/**
 * D385: a step agent's run succeeded with the step's decision as its result, so the platform
 * takes that action for it, as the agent would with `request_step_action_create`. An agent
 * granted only its connector tools did the work and named the action, and the request stayed
 * on the step (REQ-9002, RUN-88183).
 *
 * Called while the run is still live, so the step's audience rules see the agent acting, and
 * under the person behind the run, as every action of the run is. Left alone: an output that
 * is no decision, an action the current step does not offer, and a request somebody, the agent
 * included, already moved while the run went on. A refusal is written in the request's history
 * rather than failing the run, which has already done its work.
 *
 * @returns whether the decision was taken, so the caller does not post it a second time.
 */
export async function applyAgentDecision(input: {
  requestId: string;
  agentId: string;
  agentCode: string;
  runId: string;
  output: string;
  since: Date | null;
}): Promise<boolean> {
  const decision = stepDecisionOf(input.output);
  if (!decision) return false;
  const key = await repository.requestKeyOf(input.requestId);
  if (!key) return false;
  if (input.since && (await repository.requestMovedSince(input.requestId, input.since))) return false;
  const request = await repository.readForAction(key);
  const rules = (request?.rules ?? []).map((rule) => ({ ...rule, kind: rule.kind as Rule["kind"] }));
  const offered = [...actionsOf(rules), RETURN_ACTION, REJECT_ACTION];
  if (!request || !offered.includes(decision.action)) return false;

  try {
    const session = await requirePermission("requests:write");
    await runAs(session.personId, { id: input.agentId, label: input.agentCode, runId: input.runId }, () => take(key, decision));
    return true;
  } catch (problem) {
    const refused =
      problem instanceof Rejected
        ? { en: problem.message, ar: problem.messageAr }
        : problem instanceof NotPermitted
          ? { en: "the person it works for may not act on requests", ar: "لا يملك الشخص الذي يعمل له صلاحية التصرف في الطلبات" }
          : null;
    if (!refused) throw problem;
    logger().warn({ key, action: decision.action, problem: refused.en }, "an agent's step decision could not be taken");
    await repository.recordEvent({
      requestId: input.requestId,
      actorId: null,
      agentId: input.agentId,
      eventType: "Comment",
      detailEn: `decided "${decision.action}" but it could not be taken: ${refused.en}`,
      detailAr: `قرر "${decision.action}" لكن تعذّر تنفيذه: ${refused.ar}`,
    });
    return false;
  }
}

/** The step service each kind of decision goes through, as the console's buttons do. */
async function take(key: string, decision: StepDecision): Promise<void> {
  if (decision.action === RETURN_ACTION) await requestChanges(key, decision.comment);
  else if (decision.action === REJECT_ACTION) await rejectRequest(key, decision.comment);
  else await takeStepAction({ key, action: decision.action, comment: decision.comment || undefined });
}
