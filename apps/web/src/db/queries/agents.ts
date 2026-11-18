import { and, eq, inArray } from "drizzle-orm";

import { dbRo, schema as s } from "@/db/client";

/**
 * What the agent registry (`src/agents/registry.ts`) needs to decide which agents a
 * request may use. It sits here rather than in a feature module because the registry is
 * part of the agent runtime, not of a screen, and only `src/db/` and a feature's own
 * repository may touch the database client.
 */

export type RegistrableAgent = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  /** The alias of the agent version's primary route, which is what it may call. */
  primaryRoute: string | null;
};

/** The agent participants of one discussion room: its lead and member agents (§7.2.3). */
export async function selectRoomAgentIds(roomId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ id: s.roomParticipant.principalId })
    .from(s.roomParticipant)
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalType, "Agent")));
  return rows.map((row) => row.id).filter((id): id is string => Boolean(id));
}

/** The one agent an embedded deployment publishes (§7.4.10). */
export async function selectDeploymentAgentIds(deploymentId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ id: s.embeddedDeployment.defaultAgentId })
    .from(s.embeddedDeployment)
    .where(eq(s.embeddedDeployment.id, deploymentId));
  return rows.map((row) => row.id).filter((id): id is string => Boolean(id));
}

/**
 * The agents that can take a run now, with the route each one's active version uses.
 * A paused, retired or errored agent is not offered: specification §7.5.7 pauses every
 * agent by setting that status, and an agent that is not idle must not be handed work.
 */
export async function selectRegistrableAgents(ids: string[] | null): Promise<RegistrableAgent[]> {
  const live = inArray(s.agent.status, ["Idle", "Running", "Waiting"]);
  return dbRo()
    .select({
      id: s.agent.id,
      code: s.agent.code,
      nameEn: s.agent.nameEn,
      nameAr: s.agent.nameAr,
      primaryRoute: s.route.alias,
    })
    .from(s.agent)
    .leftJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .leftJoin(s.route, eq(s.route.id, s.agentVersion.primaryRouteId))
    .where(ids ? and(inArray(s.agent.id, ids), live) : live);
}

/** Whether one feature flag of §7.5.5 is on. A flag that is not there is off. */
export async function selectFeatureFlag(key: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ enabled: s.featureFlag.isEnabled })
    .from(s.featureFlag)
    .where(eq(s.featureFlag.key, key));
  return row?.enabled ?? false;
}
