import { audit } from "@/lib/audit";
import { mintRunToken } from "@/lib/run-token";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { NOT_RUNNABLE } from "./repository";
import { childGrant, grantedToolNames, HARNESS_PLUMBING_TOOLS } from "./run-payload";
import { UUID, connectorsForRun } from "./run-start-service";

/** What `registerDelegatedRun` hands back: everything the harness needs to run as that agent. */
export type DelegatedRunPayload = {
  agentId: string;
  agentVersionId: string;
  agentName: string;
  profile: string;
  route: string;
  instructions: string;
  organisationRules: string;
  budgetSoftAed: number;
  budgetHardAed: number;
  mcpToken: string;
  /** The delegated run's plumbing credential, separate from its model token. */
  harnessToken: string;
  tools: unknown[];
  /** The child's own grant: the parent's, narrowed to its configuration (D36). */
  grantedTools: string[];
  skills: unknown[];
  delegatableAgents: { code: string; nameEn: string; descriptionEn: string }[];
  knowledge: unknown[];
  memory: unknown[];
};

/**
 * `delegate_to_agent`'s own run row (`UC-03.1-01`), for the run a hop further out.
 *
 * A delegated run is as real as the one that asked for it: it needs the row `startRun`
 * would have written, under the same permission, before anything can finalise it — writing
 * its own steps otherwise fails the foreign key `ai.run_step` holds against `ai.run`. It is
 * also as much *that* agent as the top-level case is: its own instructions, skills, tools,
 * knowledge and memory, under a token scoped to its own routes and connectors, not a copy of
 * whatever the delegating agent was given (specification 7.4).
 *
 * The agent service already runs this as a child workflow; nothing here starts it, it only
 * makes the row and the payload that running it needs.
 *
 * A code the model invented is refused in the result, not thrown: this call is answering
 * `delegate_to_agent`, the same tool call a refused T0 call answers everywhere else, and the
 * model reads the reason and tries again rather than losing the run that asked for it.
 */
export async function registerDelegatedRun(
  input: {
    runId: string;
    /** The run delegating this one, whose grant bounds the child's (D36). */
    parentRunId: string;
    agentCode: string;
    contextType: string;
    contextId?: string | null;
  },
): Promise<{ ok: true; payload: DelegatedRunPayload } | { ok: false; message: string; messageAr: string }> {
  const session = await requirePermission("agents:invoke");

  const agent = await repository.readRunnableAgent(input.agentCode);
  if (!agent) {
    return { ok: false, message: `No agent ${input.agentCode}.`, messageAr: `لا يوجد وكيل ${input.agentCode}.` };
  }
  if (NOT_RUNNABLE.includes(agent.status)) {
    return {
      ok: false,
      message: `${agent.code} is ${agent.status.toLowerCase()} and cannot start a run.`,
      messageAr: `${agent.code} في حالة ${agent.status.toLowerCase()} ولا يمكنه بدء تشغيل.`,
    };
  }

  const contextId = input.contextId
    ? UUID.test(input.contextId)
      ? input.contextId
      : await repository.contextIdForKey(input.contextType, input.contextId)
    : null;

  // D15: depth alone does not bound a tree. One agent delegating fifty children is as
  // expensive as a deep chain and arrives much faster, so the width is bounded too —
  // here, in the server, because a limit the agent could decline to apply is not one.
  // And the depth: a chain of agents each delegating once is bounded here too, since a
  // child mission is a workflow of its own that no library depth limit reaches.
  if ((await repository.delegationDepth(input.parentRunId)) + 1 > MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      message: `Delegation may go ${MAX_DELEGATION_DEPTH} hops below the mission, and this run is already at the limit. Do the work itself, or hand off what is left.`,
      messageAr: `يمكن أن يمتد التفويض ${MAX_DELEGATION_DEPTH} مستويات فقط تحت المهمة، وقد بلغ هذا التشغيل الحد. أنجز العمل بنفسك أو سلّم ما تبقى.`,
    };
  }
  const fanOut = await repository.delegationCounts(input.parentRunId);
  if (fanOut.total >= MAX_CHILDREN_PER_RUN) {
    return {
      ok: false,
      message: `This run has already delegated ${fanOut.total} times, which is its limit. Do the rest of the work itself, or hand off what is left.`,
      messageAr: `قام هذا التشغيل بالتفويض ${fanOut.total} مرات، وهو الحد الأقصى. أكمل بقية العمل بنفسك أو سلّم ما تبقى.`,
    };
  }
  if (fanOut.running >= MAX_CONCURRENT_CHILDREN) {
    return {
      ok: false,
      message: `This run already has ${fanOut.running} delegations in flight, which is its limit. Wait for one to finish before starting another.`,
      messageAr: `لدى هذا التشغيل ${fanOut.running} تفويضات جارية، وهو الحد الأقصى. انتظر انتهاء أحدها قبل بدء آخر.`,
    };
  }

  const connectors = await connectorsForRun(input.contextType, contextId);
  const payload = await repository.runPayloadFor(agent.versionId, connectors);
  const delegatableAgents = await repository.delegatableAgents(agent.code);

  // A child can never reach further than the run that delegated to it, and never further
  // than its own configuration allows (D36).
  const childTools = childGrant(
    await repository.grantedToolsOf(input.parentRunId),
    grantedToolNames({
      platformTools: await repository.platformToolGrant(agent.versionId),
      connectorTools: payload.tools.map((tool) => tool.name),
    }),
  );

  await repository.openRun({
    id: input.runId,
    agentId: agent.id,
    agentVersionId: agent.versionId,
    trigger: "Delegation",
    contextType: input.contextType,
    contextId,
    temporalWorkflowId: null,
    replayOfRunId: null,
    replayFromStep: null,
    personId: session.personId,
    grantedTools: childTools,
    parentRunId: input.parentRunId,
  });
  await repository.markRunStatus(input.runId, "Running", session.personId);

  const mcpToken = await mintRunToken({
    kind: "model",
    runId: input.runId,
    agentId: agent.id,
    personId: session.personId,
    routes: [agent.route],
    connectors,
    tools: childTools,
  });
  const mcpHarnessToken = await mintRunToken({
    kind: "harness",
    runId: input.runId,
    agentId: agent.id,
    personId: session.personId,
    routes: [agent.route],
    connectors,
    tools: [...HARNESS_PLUMBING_TOOLS],
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:invoke",
    objectType: "Agent",
    objectId: agent.id,
    objectLabel: agent.code,
    detail: { runId: input.runId, trigger: "Delegation" },
  });

  return {
    ok: true,
    payload: {
      agentId: agent.id,
      agentVersionId: agent.versionId,
      agentName: agent.nameEn,
      profile: agent.profile,
      route: agent.route,
      instructions: agent.instructions,
      organisationRules: agent.organisationRules,
      budgetSoftAed: agent.budgetSoft ?? 0,
      budgetHardAed: agent.budgetHard ?? 0,
      mcpToken,
      harnessToken: mcpHarnessToken,
      tools: payload.tools,
      grantedTools: childTools,
      skills: payload.skills,
      delegatableAgents,
      knowledge: payload.knowledge,
      memory: payload.memory,
    },
  };
}

/**
 * How wide one run's delegation may get (D15).
 *
 * Refused rather than thrown: `delegate_to_agent` is a tool call like any other, and a
 * model that is told why it was refused does the remaining work itself. Taking the run
 * down instead would lose everything it had already finished.
 */
const MAX_CHILDREN_PER_RUN = 8;

const MAX_CONCURRENT_CHILDREN = 3;

/** Delegation hops below the mission a person started: `agent_hop_limit` 2, `max_depth` 3 (D15). */
const MAX_DELEGATION_DEPTH = 2;
