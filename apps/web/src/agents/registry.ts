import { evaluate } from "@/authz/evaluate";
import {
  selectDeploymentAgentIds,
  selectRegistrableAgents,
  selectRoomAgentIds,
} from "@/db/queries/agents";
import { getSession, type Session } from "@/lib/session";

/**
 * Which agents one request may use, and the token each of them runs under.
 *
 * Stack specification 4.3.2: agents are registered per request from this registry,
 * filtered by the person's permissions, their project membership and the Integrations
 * settings. A room registers its lead and member agents; the embedded widget registers
 * only its deployment's agent. Nothing here reaches the browser — the key the UI names is
 * the agent's code, and the token is attached on the server when the runtime builds the
 * `HttpAgent`.
 *
 * No run token is minted here. A token is for one run, and the run is assembled by
 * `/api/agui/[agentCode]` when the person actually asks something — minting one per
 * registered agent on every request produced credentials for runs that never happened.
 */

export type RegisteredAgent = {
  /** The agent code, which is what `<CopilotKit agent="…">` names. */
  key: string;
  /** The agent row's id, which is what the agent service's AG-UI path carries. */
  id: string;
  nameEn: string;
  nameAr: string;
};

/** What the request asks for: every agent the person may use, or one room's, or one deployment's. */
export type AgentScope =
  | { kind: "all" }
  | { kind: "room"; roomId: string }
  | { kind: "deployment"; deploymentId: string };

/**
 * Resolve the agents for one request. Returns nothing at all when the caller has no
 * session or may not start a run, which leaves the runtime with no agent to register
 * rather than an agent the caller should not have.
 */
export async function resolveAgentsForRequest(scope: AgentScope): Promise<RegisteredAgent[]> {
  const session: Session | null = await getSession();
  if (!session) return [];
  if (!evaluate(session.principal, "agents:invoke", { type: "Organisation" }).allowed) return [];

  const ids =
    scope.kind === "room"
      ? await selectRoomAgentIds(scope.roomId)
      : scope.kind === "deployment"
        ? await selectDeploymentAgentIds(scope.deploymentId)
        : null;
  if (ids !== null && ids.length === 0) return [];

  const agents = await selectRegistrableAgents(ids);
  return agents.map((agent) => ({
    key: agent.code,
    id: agent.id,
    nameEn: agent.nameEn,
    nameAr: agent.nameAr,
  }));
}

/** The scope a CopilotKit request names, from its query string. */
export function scopeFromRequest(request: Request): AgentScope {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("room");
  if (roomId) return { kind: "room", roomId };
  const deploymentId = url.searchParams.get("deployment");
  if (deploymentId) return { kind: "deployment", deploymentId };
  return { kind: "all" };
}
