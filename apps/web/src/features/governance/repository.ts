import { eq, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";

/** The platform switches the AI capabilities read: the agent kill switch and feature flags. */

export async function readSystemState() {
  const [state] = await dbRo().select({ agentsPaused: s.systemState.agentsPaused, pausedAt: s.systemState.pausedAt }).from(s.systemState).limit(1);
  const [runs] = await dbRo()
    .select({
      active: sql<number>`count(*) filter (where ${s.run.status} in ('Running', 'Waiting'))::int`,
      queued: sql<number>`count(*) filter (where ${s.run.status} = 'Queued')::int`,
    })
    .from(s.run);
  const [conversations] = await dbRo()
    .select({ open: sql<number>`count(*) filter (where ${s.conversations.state} <> 'CLOSED')::int` })
    .from(s.conversations);
  return {
    agentsPaused: state?.agentsPaused ?? false,
    pausedAt: state?.pausedAt?.toISOString() ?? null,
    activeRuns: runs?.active ?? 0,
    queueDepth: runs?.queued ?? 0,
    openConversations: conversations?.open ?? 0,
  };
}

export async function setAgentsPaused(paused: boolean, personId: string): Promise<void> {
  await db()
    .update(s.systemState)
    .set({ agentsPaused: paused, pausedBy: paused ? personId : null, pausedAt: paused ? new Date() : null, updatedAt: new Date(), updatedBy: personId });
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const [row] = await dbRo().select({ enabled: s.featureFlag.isEnabled }).from(s.featureFlag).where(eq(s.featureFlag.key, key)).limit(1);
  return row?.enabled ?? false;
}

export async function setFeatureFlag(key: string, enabled: boolean, personId: string): Promise<void> {
  await db().update(s.featureFlag).set({ isEnabled: enabled, updatedAt: new Date(), updatedBy: personId }).where(eq(s.featureFlag.key, key));
}
