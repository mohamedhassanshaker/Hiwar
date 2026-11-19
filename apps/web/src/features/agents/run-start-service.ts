import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { notifyDashboard } from "@/lib/live";
import { mintRunToken, RUN_TOKEN_LIFETIME_SECONDS } from "@/lib/run-token";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { NOT_RUNNABLE } from "./repository";
import { grantedToolNames, HARNESS_PLUMBING_TOOLS, type RunPayload } from "./run-payload";
import { runTitle } from "./run-title";
import type { ConversationTurn } from "./types";
import { RunNotStarted } from "./errors";

/** A context id is a row id or it is nothing; the screens also pass their own names. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where a run was started from.
 *
 * Named by the server code that starts the run — a route handler, a service — and never
 * by the caller of that code. The context type follows from it, so a browser cannot claim
 * one.
 */
export type RunSurface =
  | "AssistantPanel"
  | "Playground"
  | "Room"
  | "WorkItem"
  | "Request"
  | "Deployment";

/** The context type a surface implies. The surface is the fact; this is the consequence. */
function contextTypeFor(surface: RunSurface): string {
  if (surface === "AssistantPanel" || surface === "Playground") return "Console";
  return surface;
}

/**
 * Start an agent run and return its id, for the caller to stream.
 *
 * The run is assembled here, where the agent's version, instructions, route and budget
 * live and where the person's permissions are evaluated. The agent service is handed a
 * finished run, never a database.
 *
 * `UC-03.1-04`: the run token carries the person, and every platform MCP call the run makes
 * is checked against them. An agent therefore cannot read what the person asking cannot —
 * not because it was told to refuse, but because the data is not reachable under that
 * token. A prompt instruction would be a request; this is the system.
 *
 * @throws {RunNotStarted} when the agent is unknown or the agent service refuses the run.
 */
export async function startRun(input: {
  agentCode: string;
  /** What the person asked, verbatim. */
  prompt: string;
  /** The screen the question is about, so the run reads that screen's data (`UC-03.1-02`). */
  screen?: string;
  /** Where the run was started from. Set by server code, never forwarded from a client. */
  surface: RunSurface;
  contextId?: string;
  /** `UC-52.1-06`: the run this one replays, so the new run points back at it. */
  replayOfRunKey?: string;
  replayFromStep?: number | null;
  /**
   * The contract the mission's output is checked against before it may be reported
   * complete (D41). Set by the surface that knows the step's contract; absent elsewhere,
   * where there is nothing objective to check.
   */
  outputSchema?: Record<string, unknown>;
  /** Earlier turns the run continues — a room's recent messages, an attached file's content.
   * The harness compacts it itself once it grows past the model's own budget. */
  conversation?: ConversationTurn[];
  /** The language the run answers in, when the reader is not the person it runs as: a
   * widget visitor, whose agent runs as the deployment's service identity (D231). */
  locale?: "en" | "ar";
}): Promise<string> {
  const session = await requirePermission("agents:invoke");

  const agent = await repository.readRunnableAgent(input.agentCode);
  if (!agent) throw new RunNotStarted("That agent no longer exists.", "لم يعد هذا الوكيل موجوداً.");
  // `UC-31.2-08`: a paused, retired or failing agent does not start work. The work it was
  // given still exists and still names it, so a person can see what is waiting on it.
  if (NOT_RUNNABLE.includes(agent.status)) {
    throw new RunNotStarted(
      `${agent.code} is ${agent.status.toLowerCase()} and cannot start a run.`,
      `${agent.code} في حالة ${agent.status.toLowerCase()} ولا يمكنه بدء تشغيل.`,
    );
  }

  const agentServiceUrl = env().AI_AGENT_SERVICE_URL;
  if (!agentServiceUrl) throw new RunNotStarted("The agent service is not configured.", "خدمة الوكلاء غير مُعدّة.");

  const runId = randomUUID();
  const replayOfRunId = input.replayOfRunKey ? await repository.runIdByKey(input.replayOfRunKey) : null;
  // Derived from where the run started, not from anything the caller sent. A run given
  // only a screen is about that screen, not about a work item: claiming `WorkItem` for it
  // put the screen path where a work item id belongs, the first approval such a run asked
  // for wrote "/dashboard" into a uuid column, the insert threw, and the run waited for an
  // approval that was never recorded.
  const contextType = contextTypeFor(input.surface);
  // The context id is a foreign key here and a free string to the agent service. A screen
  // passes the key it shows, so it is resolved; a screen name such as "playground" is
  // context for the run and nothing to point at.
  const contextId = input.contextId
    ? UUID.test(input.contextId)
      ? input.contextId
      : await repository.contextIdForKey(contextType, input.contextId)
    : null;

  // The platform records the run before the agent service is asked to run it. Everything
  // the run then does here — an approval, a question, its totals — names this row.
  //
  // Specification section 7.4: an agent is its instructions *and* its skills, tools, memory
  // and knowledge. All of it travels with the run — the harness builds its context and its
  // toolset from what arrives, so anything left out is something the agent does not have.
  const {
    connectors,
    payload,
    tools: modelTools,
  } = await configuredGrant({
    agentId: agent.id,
    agentVersionId: agent.versionId,
    contextType,
    contextId,
  });
  // The agents a run granted `delegate_to_agent` may name; without this it has nothing real to name.
  const delegatableAgents = await repository.delegatableAgents(agent.code);

  // The row is written before the agent service is asked to run anything, and it carries
  // the grant: everything the run then does names this row, and "what could it reach?"
  // has to be answerable from it afterwards (D35).
  await repository.openRun({
    id: runId,
    agentId: agent.id,
    agentVersionId: agent.versionId,
    trigger: input.replayOfRunKey ? "Replay" : "Manual",
    contextType,
    contextId,
    temporalWorkflowId: null,
    replayOfRunId,
    replayFromStep: input.replayFromStep ?? null,
    personId: session.personId,
    grantedTools: modelTools,
  });
  // Two tokens, because the harness and the model present identically otherwise. The
  // model's carries what the agent was granted; the plumbing lives only on the harness's,
  // so a model that learns the name `run_finish` still cannot call it.
  const harnessToken = await mintRunToken({
    kind: "harness",
    runId,
    agentId: agent.id,
    personId: session.personId,
    routes: [agent.route],
    connectors,
    tools: [...HARNESS_PLUMBING_TOOLS],
  });
  const runToken = await mintRunToken({
    kind: "model",
    runId,
    agentId: agent.id,
    personId: session.personId,
    routes: [agent.route],
    tools: modelTools,
    // The connectors this agent was published with, narrowed to what the project allows
    // (`UC-21.2-02`). The narrowing is in the token rather than in a check the agent could
    // skip: a connector the project forbids is not reachable under this run at all.
    connectors,
  });

  const body = {
    run_id: runId,
    agent_id: agent.id,
    agent_version_id: agent.versionId,
    agent_name: agent.nameEn,
    profile: agent.profile.toLowerCase(),
    route: agent.route,
    instructions: agent.instructions,
    organisation_rules: agent.organisationRules,
    trigger: input.replayOfRunKey ? "Replay" : "Manual",
    // The agent service names a run by its row id, not the key the console shows. Sending
    // the key would be quietly dropped and the new run would forget what it replays.
    replay_of_run_id: replayOfRunId,
    replay_from_step: input.replayFromStep ?? null,
    context_type: contextType,
    context_id: input.contextId ?? input.screen ?? "console",
    actor: {
      person_id: session.personId,
      display_name: session.nameEn,
      // The run writes for a person, and which language they read is their own setting.
      locale: input.locale ?? (await repository.preferredLanguage(session.personId)),
      // How the run authenticates to the platform MCP server. Every tool call it makes is
      // then checked against this person, which is what stops it reading anything they
      // cannot (`UC-03.1-04`).
      mcp_token: runToken,
      // The plumbing's own credential. The model's tool calls never travel on it, so
      // `run_finish` and the approval tools are out of the model's reach by construction.
      harness_token: harnessToken,
      // When both stop being accepted, so the harness replaces them before that rather
      // than discovering it mid-call (#31).
      expires_at: new Date(Date.now() + RUN_TOKEN_LIFETIME_SECONDS * 1000).toISOString(),
    },
    task: {
      title: runTitle(input.prompt),
      description: input.prompt,
      acceptance_criteria: [],
      output_schema: input.outputSchema ?? null,
    },
    conversation: (input.conversation ?? []).map((turn) => ({
      role: turn.role,
      author: turn.author ?? "",
      text: turn.text,
    })),
    tools: payload.tools,
    skills: payload.skills,
    delegatable_agents: delegatableAgents.map((one) => ({
      code: one.code,
      name: one.nameEn,
      description: one.descriptionEn,
    })),
    knowledge: payload.knowledge,
    memory: payload.memory,
    // What the token grants, so the harness offers the model exactly that and no more
    // (D37). The same list is on the run row and in the token: one decision, three
    // places that have to agree.
    granted_tools: modelTools,
    budget: {
      soft_cost_aed: agent.budgetSoft ?? 0,
      hard_cost_aed: agent.budgetHard ?? 0,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${agentServiceUrl}/agui/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runToken}` },
      body: JSON.stringify(body),
    });
  } catch (problem) {
    // `UC-03.1-05`: the caller turns this into "the assistant is unavailable", and the page
    // it is attached to keeps working. The row stays, as a run that failed to start.
    await repository.markRunStatus(runId, "Failed", session.personId);
    throw new RunNotStarted(
      `The agent service did not answer: ${String(problem).slice(0, 120)}`,
      `لم تستجب خدمة الوكلاء: ${String(problem).slice(0, 120)}`,
    );
  }
  if (!response.ok) {
    await repository.markRunStatus(runId, "Failed", session.personId);
    throw new RunNotStarted(
      `The agent service refused the run (${response.status}).`,
      `رفضت خدمة الوكلاء التشغيل (${response.status}).`,
    );
  }
  await repository.markRunStatus(runId, "Running", session.personId);
  await notifyDashboard("run");

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:invoke",
    objectType: "Agent",
    objectId: agent.id,
    objectLabel: agent.code,
    detail: { runId, screen: input.screen },
  });
  return runId;
}

/**
 * The connectors one run may reach: every enabled one, narrowed by the project's list. The
 * agent version's tool grant decides which of their tools it is offered (D227).
 *
 * `UC-21.2-02`: an empty project allow-list is "every connector", and a list is a
 * narrowing — a project can take a connector away from a run, never add one.
 */
export async function connectorsForRun(contextType: string, contextId: string | null): Promise<string[]> {
  const forAgent = await repository.enabledConnectorCodes();
  if (!contextId) return forAgent;
  const projectId = await repository.projectOfContext(contextType, contextId);
  if (!projectId) return forAgent;
  const forProject = await repository.connectorCodesForProject(projectId);
  return forProject.length === 0 ? forAgent : forAgent.filter((code) => forProject.includes(code));
}

/**
 * What the agent's configuration grants a run *right now*, before any snapshot narrows it.
 *
 * The one place this is computed. `startRun` uses it to set the run's grant; a refresh
 * intersects it with the run row's snapshot (D50). Two derivations would be two answers
 * to "what may this run reach", and the second would be the one that drifts.
 *
 * The platform tools come from the version's stored grant (D38), so an agent granted
 * nothing reaches nothing.
 */
export async function configuredGrant(input: {
  agentId: string;
  agentVersionId: string;
  contextType: string;
  contextId: string | null;
}): Promise<{ tools: string[]; connectors: string[]; payload: RunPayload }> {
  const connectors = await connectorsForRun(input.contextType, input.contextId);
  const payload = await repository.runPayloadFor(input.agentVersionId, connectors);
  const platformTools = await repository.platformToolGrant(input.agentVersionId);
  return {
    connectors,
    payload,
    tools: grantedToolNames({ platformTools, connectorTools: payload.tools.map((tool) => tool.name) }),
  };
}
