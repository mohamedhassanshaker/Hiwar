import * as budgets from "@/features/budgets/service";
import { postVisitorReply } from "@/features/engage/visitor-agent";
import * as files from "@/features/files/service";
import * as requests from "@/features/requests/service";
import * as rooms from "@/features/rooms/service";
import * as workItems from "@/features/work-items/service";
import { audit } from "@/lib/audit";
import { notifyDashboard, notifyInbox } from "@/lib/live";
import { requirePermission } from "@/lib/session";
import { agentAnswerOf } from "./brief";
import * as repository from "./repository";

export type { ApprovalClaimFailure } from "./repository";
import { refreshRunCredentials, registerDelegatedRun } from "./service";

export { spendApproval, requestApproval } from "./approval-service";

/**
 * What a run writes back to the platform (stack specification 4.2).
 *
 * The agent service never touches the database. It calls the platform MCP server, and
 * these are the services behind the three tools a run needs: the approval a T2 call waits
 * on, the question it asks a person, and the record of what it produced.
 *
 * Each runs under the person the run acts for, because the run token names them and
 * `agents:invoke` is what let the run start at all.
 */

/** The handoff columns are text; a list of decisions reads as one per line. */
const LINE_BREAK = String.fromCharCode(10);

/** How a run that ended without finishing its work is described on the record it was about. */
const STOPPED_SHORT: Record<string, { en: string; ar: string }> = {
  Failed: { en: "stopped without finishing: the run failed", ar: "توقف دون إنهاء العمل: فشل التشغيل" },
  Blocked: { en: "stopped without finishing: it is blocked and needs a person", ar: "توقف دون إنهاء العمل: العمل معطّل ويحتاج إلى شخص" },
  Cancelled: { en: "stopped without finishing: the run was cancelled", ar: "توقف دون إنهاء العمل: أُلغي التشغيل" },
  BudgetExceeded: { en: "stopped without finishing: it reached its effort limit", ar: "توقف دون إنهاء العمل: بلغ حد الجهد" },
};

/**
 * Fresh credentials for a run still in flight (#31).
 *
 * The MCP server has already checked that the token presenting this was minted for this
 * run (D52), so the binding is the authority here; `refreshRunCredentials` re-derives the
 * grant and refuses a run that has finished.
 */
export async function refreshCredentials(input: { run_id: string }): Promise<{
  mcp_token: string;
  harness_token: string;
  granted_tools: string[];
  expires_at: string;
}> {
  const fresh = await refreshRunCredentials(input.run_id);
  return {
    mcp_token: fresh.mcpToken,
    harness_token: fresh.harnessToken,
    granted_tools: fresh.grantedTools,
    expires_at: fresh.expiresAt,
  };
}

/** `UC-03.1-01`: the row and the payload a delegated run needs before anything can finalise it. */
export async function startRun(input: {
  run_id: string;
  /** The run delegating this one. The MCP server has already checked it is the caller's. */
  parent_run_id: string;
  agent_code: string;
  context_type: string;
  context_id: string;
}): Promise<
  | {
      ok: true;
      agent_id: string;
      agent_version_id: string;
      agent_name: string;
      profile: string;
      route: string;
      instructions: string;
      organisation_rules: string;
      mcp_token: string;
      /** The delegated run's plumbing credential, separate from its model token. */
      harness_token: string;
      tools: unknown[];
      granted_tools: string[];
      skills: unknown[];
      delegatable_agents: { code: string; name: string; description: string }[];
      knowledge: unknown[];
      memory: unknown[];
      budget: { soft_cost_aed: number; hard_cost_aed: number };
    }
  | { ok: false; message: string; message_ar: string }
> {
  const result = await registerDelegatedRun({
    runId: input.run_id,
    parentRunId: input.parent_run_id,
    agentCode: input.agent_code,
    contextType: input.context_type,
    contextId: input.context_id || null,
  });
  if (!result.ok) return { ok: false, message: result.message, message_ar: result.messageAr };

  const payload = result.payload;
  return {
    ok: true,
    agent_id: payload.agentId,
    agent_version_id: payload.agentVersionId,
    agent_name: payload.agentName,
    // The agent service's `ProfileName` enum is lower case; the console stores the display case.
    profile: payload.profile.toLowerCase(),
    route: payload.route,
    instructions: payload.instructions,
    organisation_rules: payload.organisationRules,
    mcp_token: payload.mcpToken,
    harness_token: payload.harnessToken,
    tools: payload.tools,
    granted_tools: payload.grantedTools,
    skills: payload.skills,
    delegatable_agents: payload.delegatableAgents.map((one) => ({
      code: one.code,
      name: one.nameEn,
      description: one.descriptionEn,
    })),
    knowledge: payload.knowledge,
    memory: payload.memory,
    budget: { soft_cost_aed: payload.budgetSoftAed, hard_cost_aed: payload.budgetHardAed },
  };
}

/** `UC-12.2-01`: the question the run waits on, asked of the person it acts for. */
export async function askPerson(input: {
  run_id: string;
  question: string;
  options: string[];
}): Promise<{ id: string }> {
  const session = await requirePermission("agents:invoke");

  const run = await repository.readRunById(input.run_id);
  if (!run) throw new Error("no such run");

  // Asked of the person the run acts for: they are the one who knows what they wanted, and
  // the agent is working on their behalf.
  const question = await repository.createQuestion(
    { runId: run.id, question: input.question, options: input.options, askedTo: session.personId },
    session.personId,
  );
  // Same reason as `requestApproval`: the run is blocked on an answer, not stalled.
  await repository.markRunStatus(run.id, "Waiting", session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:ask",
    objectType: "AgentQuestion",
    objectId: question.id,
    detail: { run: run.key },
  });
  // A run inside a room asks there too, so the person answers where the work is (as `requestApproval` does).
  if (run.contextType === "Room" && run.contextId) {
    await rooms.noteQuestionInRoom(run.contextId, question.id, session.personId);
  }
  await Promise.all([notifyDashboard("question"), notifyInbox(session.personId, "question")]);
  return question;
}

/**
 * Record what a run produced, and account its cost against the agent's budget.
 *
 * The cost is the only moment a budget moves, so the accounting is here rather than in a
 * sweep: a threshold is crossed by a particular run, and that run is what pays for
 * noticing it (`UC-72.1-04` … `-07`).
 */
export async function finishRun(input: {
  run_id: string;
  status: string;
  output: string;
  handoff?: { goal: string; decisions: string[]; open_questions: string[]; next_step: string } | null;
  tokens_in: number;
  tokens_out: number;
  tool_call_count: number;
  estimated_cost_aed: string | number;
  eval_scores: Record<string, number>;
  steps: {
    seq: number;
    type: string;
    name: string;
    status: string;
    result: string;
    hooks_applied: string[];
    estimated_cost_aed: string | number;
    started_at: string;
    ended_at: string;
  }[];
}): Promise<{ run: string; budget: { warned: boolean; hardLimit: boolean } }> {
  const session = await requirePermission("agents:invoke");

  const run = await repository.readRunById(input.run_id);
  if (!run) throw new Error("no such run");

  const cost = Number(input.estimated_cost_aed) || 0;
  // D385: a step agent's decision is its last act, so it is taken while the run is still live,
  // where the step's audience rules see the agent; its history line is then the answer.
  const decided =
    input.status === "Succeeded" && run.contextType === "Request" && run.contextId
      ? await requests.applyAgentDecision({
          requestId: run.contextId,
          agentId: run.agentId,
          agentCode: run.agentCode,
          runId: run.id,
          output: input.output,
          since: run.startedAt,
        })
      : false;
  await repository.finishRun(
    {
      runId: run.id,
      status: input.status,
      output: input.output,
      tokensIn: input.tokens_in,
      tokensOut: input.tokens_out,
      toolCallCount: input.tool_call_count,
      estimatedCostAed: cost,
      handoff: input.handoff
        ? {
            goal: input.handoff.goal,
            decisions: input.handoff.decisions.join(LINE_BREAK),
            openQuestions: input.handoff.open_questions.join(LINE_BREAK),
            nextStep: input.handoff.next_step,
          }
        : null,
      contextType: run.contextType,
      contextId: run.contextId,
      steps: input.steps.map((step) => ({
        seq: step.seq,
        type: step.type,
        name: step.name,
        status: step.status,
        result: step.result,
        hooksApplied: step.hooks_applied,
        estimatedCostAed: Number(step.estimated_cost_aed) || 0,
        startedAt: new Date(step.started_at),
        endedAt: new Date(step.ended_at),
      })),
    },
    session.personId,
  );

  // `UC-23.1-07`: a room run's reply is what the room actually shows. Without this, the
  // room's "X is working" state never resolves — nothing ever tells participants it ended.
  if (run.contextType === "Room" && run.contextId) {
    // Whatever `artifact_create` linked here while this run was going — the model names the
    // room itself when it calls that tool, so this is read back by that same link, not by
    // asking the model to also report what it made.
    const produced = run.startedAt
      ? await files.artifactsProducedSince("Room", run.contextId, run.startedAt)
      : [];
    await rooms.postAgentReply({
      roomId: run.contextId,
      agentId: run.agentId,
      agentCode: run.agentCode,
      status: input.status,
      text: input.output,
      runId: run.id,
      toolCalls: input.tool_call_count,
      estimatedCostAed: cost,
      actedBy: session.personId,
      artifactName: produced.at(-1),
    });
  }

  // A widget visitor's free conversation gets the answer, or that there is none (D221).
  if (run.contextType === "Deployment" && run.contextId) {
    await postVisitorReply({ conversationId: run.contextId, status: input.status, text: input.output });
  }

  // D384: a request or work item gets the run's answer as the agent's comment, because the
  // run viewer is not where a person reading the record looks. A run that stopped short says
  // so first; the record does not move. A step decision taken above already says it (D385).
  const stopped = STOPPED_SHORT[input.status];
  const answer = decided ? "" : agentAnswerOf(input.output);
  if ((stopped || answer) && run.contextId && (run.contextType === "Request" || run.contextType === "WorkItem")) {
    const why = stopped
      ? { en: `${run.agentCode} ${stopped.en} (run ${run.key}).`, ar: `${run.agentCode} ${stopped.ar} (التشغيل ${run.key}).` }
      : null;
    const note = {
      agentId: run.agentId,
      detailEn: [why?.en, answer].filter(Boolean).join("\n\n"),
      detailAr: [why?.ar, answer].filter(Boolean).join("\n\n"),
    };
    if (run.contextType === "Request") await requests.noteAgentStopped({ requestId: run.contextId, ...note });
    else await workItems.noteAgentStopped({ workItemId: run.contextId, ...note });
  }

  // D346: the agent assigned a work item finished its mission, so the work goes to review
  // instead of staying in progress until somebody notices.
  if (input.status === "Succeeded" && run.contextType === "WorkItem" && run.contextId) {
    await workItems.submitAgentWork({ workItemId: run.contextId, agentId: run.agentId, agentCode: run.agentCode, runId: run.id });
  }

  const spend = await budgets.recordRunSpend({
    agentId: run.agentId,
    amountAed: cost,
    actedBy: session.personId,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "runs:finish",
    objectType: "Run",
    objectId: run.id,
    objectLabel: run.key,
    detail: {
      status: input.status,
      estimatedCostAed: cost,
      budgetWarned: spend.warned,
      budgetHardLimit: spend.hardLimit,
    },
  });
  await notifyDashboard("run");
  return { run: run.key, budget: { warned: spend.warned, hardLimit: spend.hardLimit } };
}
