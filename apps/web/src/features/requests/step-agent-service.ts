import * as agents from "@/features/agents/service";
import { requestBrief } from "./brief-service";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { messageArOf } from "@/lib/rejection";
import { NotPermitted, requirePermission } from "@/lib/session";
import { stepContract, stepMissionPrompt } from "./step-contract";
import * as repository from "./repository";
import type { AssignRequestToAgentInput } from "./schema";
import { RequestRejected } from "./errors";
import { boundAgent, stepActors } from "./step-actors-service";

/**
 * What the agent working one step is asked to do, and the contract its output is checked
 * against before the mission may be reported complete (D41, D115).
 */
async function stepMissionFor(
  requestKey: string,
  stepId: string,
  stepName: string | null,
): Promise<{ prompt: string; outputSchema?: Record<string, unknown> }> {
  const contract = stepContract(await repository.rulesOutOf(stepId), stepName);
  // A step that offers no named action has nothing objective to be judged against, so it
  // is asked in plain words rather than held to a schema nothing could satisfy.
  if (!contract) {
    logger().info({ request: requestKey, step: stepName }, "a step mission has no declared contract");
    return { prompt: agents.withBrief(`Work the "${stepName ?? "current"}" step of request ${requestKey}.`, await requestBrief(requestKey), requestKey) };
  }
  // Which contract the mission will be held to, logged where a refused output can be read
  // back against it: "the output did not match" is only actionable next to the schema.
  logger().info({ request: requestKey, step: stepName, actions: contract.actions }, "a step mission carries its step contract");
  // D384: the request's brief follows the step's contract, so the agent starts from what is recorded.
  return {
    prompt: agents.withBrief(stepMissionPrompt(requestKey, stepName, contract), await requestBrief(requestKey), requestKey),
    outputSchema: contract.outputSchema,
  };
}

/** Why a run did not start, in both languages, for the request's history. */
type NotStarted = { en: string; ar: string };

/** A refusal from `startRun` carries its own Arabic; anything else is named by kind. */
function whyNotStarted(problem: unknown): NotStarted {
  const en = problem instanceof Error ? problem.message : String(problem);
  if (problem instanceof NotPermitted) return { en, ar: `غير مسموح: ${problem.permission}` };
  return { en, ar: messageArOf(problem) ?? "حدث خطأ غير متوقع." };
}

/**
 * Starts a run for every agent the step a request just landed on names as its audience.
 *
 * Mirrors `assignToAgent`: the same start call, the same event whether or not it started.
 * The difference is who decides — here it is the step's own configured audience, the
 * moment the request reaches it, rather than a person choosing an agent by hand.
 *
 * A run acts for a person, so a request with nobody behind it — one an external contact
 * raised — starts no run, and its history says so.
 */
export async function triggerAgentAudience(input: {
  requestId: string;
  requestKey: string;
  stepId: string;
  stepName?: string | null;
  actorId: string | null;
}): Promise<void> {
  const agentCodes = await repository.agentAudiencesOf(input.stepId);
  if (agentCodes.length === 0) return;
  const mission = await stepMissionFor(input.requestKey, input.stepId, input.stepName ?? null);
  for (const agentCode of agentCodes) {
    let started = false;
    let reason: NotStarted | null = null;
    if (input.actorId === null) {
      reason = { en: "nobody is behind this request for the agent to act for", ar: "لا أحد وراء هذا الطلب ليعمل الوكيل نيابةً عنه" };
    } else {
      try {
        await agents.startRun({
          agentCode,
          prompt: mission.prompt,
          outputSchema: mission.outputSchema,
          surface: "Request",
          contextId: input.requestKey,
        });
        started = true;
      } catch (problem) {
        reason = whyNotStarted(problem);
      }
    }
    if (!started) logger().warn({ request: input.requestKey, agent: agentCode, problem: reason?.en }, "the agent run did not start");
    await repository.recordEvent({
      requestId: input.requestId,
      actorId: input.actorId,
      eventType: "Assigned",
      detailEn: started ? `Assigned to ${agentCode}.` : `Could not start ${agentCode}: ${reason?.en}`,
      detailAr: started ? `أُسند إلى ${agentCode}.` : `تعذّر تشغيل ${agentCode}: ${reason?.ar}`,
    });
  }
}

/**
 * A request has just been raised: start the agents its first step names, as a step action
 * landing there would. Every way of raising a request calls this, so none of them leaves an
 * agent audience waiting for nothing.
 */
export async function startFirstStep(key: string, actorId: string | null): Promise<void> {
  const created = await repository.readForAction(key);
  if (!created?.currentStepId) return;
  await triggerAgentAudience({
    requestId: created.id,
    requestKey: key,
    stepId: created.currentStepId,
    stepName: created.currentStepName,
    actorId,
  });
}

/**
 * The agent working a request stopped without finishing, recorded in the request's history
 * so a person reading it sees why nothing moved. The request stays where it is.
 * D384: also how a run's answer is posted, as the agent's comment, when the run ends.
 *
 * Called by `finishRun` for the run's own context, which the run row named; the wording says
 * how the run ended and where to read it, not what the run produced. A request deleted while
 * the run went on has no history left to write to, and that must not stop the run finishing.
 */
export async function noteAgentStopped(input: { requestId: string; agentId: string; detailEn: string; detailAr: string }): Promise<void> {
  if (!(await repository.requestExists(input.requestId))) return;
  await repository.recordEvent({
    requestId: input.requestId,
    actorId: null,
    agentId: input.agentId,
    eventType: "Comment",
    detailEn: input.detailEn,
    detailAr: input.detailAr,
  });
}

/**
 * `UC-29.2-03`: hand the current step to an agent, which works it as a run.
 *
 * The run is started under the person who assigned it, so what the agent may read is what
 * they may read. The event is recorded whether or not the run starts, because the decision
 * to involve an agent is itself part of the request's history.
 */
export async function assignToAgent(input: AssignRequestToAgentInput): Promise<{ started: boolean; reason: string | null }> {
  const session = await requirePermission("requests:write");

  const request = await repository.readForAction(input.key);
  if (!request) throw new RequestRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const actors = await stepActors(request, session.personId, await boundAgent(session, request.id));
  if (!actors.mayAct) {
    throw new RequestRejected(
      actors.reason ?? "You cannot act on this step.",
      actors.reasonAr ?? "لا يمكنك التصرف في هذه الخطوة.",
    );
  }

  let started = false;
  let reason: NotStarted | null = null;
  const mission = request.currentStepId
    ? await stepMissionFor(request.key, request.currentStepId, request.currentStepName)
    : {
        prompt: agents.withBrief(
          `Work the "${request.currentStepName ?? "current"}" step of request ${request.key}.`,
          await requestBrief(request.key),
          request.key,
        ),
      };
  try {
    await agents.startRun({
      agentCode: input.agentCode,
      prompt: mission.prompt,
      outputSchema: mission.outputSchema,
      surface: "Request",
      contextId: request.key,
    });
    started = true;
  } catch (problem) {
    reason = whyNotStarted(problem);
    logger().warn({ request: request.key, agent: input.agentCode, problem: reason.en }, "the agent run did not start");
  }

  await repository.recordEvent({
    requestId: request.id,
    actorId: session.personId,
    eventType: "Assigned",
    detailEn: started ? `Assigned to ${input.agentCode}.` : `Could not start ${input.agentCode}: ${reason?.en}`,
    detailAr: started ? `أُسند إلى ${input.agentCode}.` : `تعذّر تشغيل ${input.agentCode}: ${reason?.ar}`,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "requests:step",
    objectType: "Request",
    objectLabel: request.key,
    detail: { action: "Assign to agent", agent: input.agentCode, started },
  });
  return { started, reason: reason?.en ?? null };
}
