import { and, asc, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/db";
import { isGenerating, REASON_TEXT } from "./inbox";

/** Reads for C-Inbox (INB-001). */

export type InboxTab = "all" | "pending" | "ai" | "human";
const TAB_STATE: Record<Exclude<InboxTab, "all">, "HANDOVER_PENDING" | "AI_ACTIVE" | "HUMAN_ACTIVE"> = {
  pending: "HANDOVER_PENDING",
  ai: "AI_ACTIVE",
  human: "HUMAN_ACTIVE",
};

export async function inboxList(orgId: string, filters: { tab: InboxTab; deployment?: string; period: "today" | "7" | "30"; q?: string }) {
  const since = filters.period === "today" ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - Number(filters.period) * 86_400_000);
  const base: SQL[] = [eq(schema.conversations.orgId, orgId), gte(schema.conversations.lastMessageAt, since)];
  if (filters.deployment) base.push(eq(schema.conversations.deploymentId, filters.deployment));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const matching = db.select({ id: schema.messages.conversationId }).from(schema.messages).where(and(eq(schema.messages.orgId, orgId), ilike(schema.messages.text, like)));
    base.push(or(sql`${schema.conversations.visitor}->>'name' ilike ${like}`, inArray(schema.conversations.id, matching))!);
  }
  const counts = await db
    .select({ state: schema.conversations.state, n: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(...base))
    .groupBy(schema.conversations.state);
  const n = (s: string) => counts.find((c) => c.state === s)?.n ?? 0;
  const tabs = {
    all: counts.reduce((sum, c) => sum + c.n, 0),
    pending: n("HANDOVER_PENDING"),
    ai: n("AI_ACTIVE"),
    human: n("HUMAN_ACTIVE"),
  };
  const where = filters.tab === "all" ? base : [...base, eq(schema.conversations.state, TAB_STATE[filters.tab])];
  const rows = await db
    .select({
      c: schema.conversations,
      site: schema.deployments.name,
      owner: schema.users.name,
      last: sql<string | null>`(select text from messages m where m.conversation_id = ${schema.conversations.id} and m.kind in ('visitor','ai','staff') order by m.created_at desc limit 1)`,
    })
    .from(schema.conversations)
    .innerJoin(schema.deployments, eq(schema.deployments.id, schema.conversations.deploymentId))
    .leftJoin(schema.users, eq(schema.users.id, schema.conversations.ownerUserId))
    .where(and(...where))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(200);
  return { tabs, rows };
}

export async function thread(orgId: string, id: string) {
  const c = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.id, id), eq(schema.conversations.orgId, orgId)) });
  if (!c) return null;
  const [messages, history, tools, deployment, owner, agentVersion] = await Promise.all([
    db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) }),
    db.query.ownershipEvents.findMany({ where: eq(schema.ownershipEvents.conversationId, c.id), orderBy: asc(schema.ownershipEvents.createdAt) }),
    db.query.toolCalls.findMany({ where: eq(schema.toolCalls.conversationId, c.id), orderBy: asc(schema.toolCalls.createdAt) }),
    db.query.deployments.findFirst({ where: eq(schema.deployments.id, c.deploymentId) }),
    c.ownerUserId ? db.query.users.findFirst({ where: eq(schema.users.id, c.ownerUserId) }) : Promise.resolve(undefined),
    db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, c.agentId), eq(schema.agentVersions.number, c.agentVersion)) }),
  ]);
  return {
    c,
    messages,
    history,
    tools,
    site: deployment?.name ?? "",
    ownerName: owner?.name ?? null,
    agentName: agentVersion?.config.name ?? "AI",
    typing: isGenerating(c.id),
    reason: c.reasonCode ? (REASON_TEXT[c.reasonCode] ?? c.reasonCode) : null,
  };
}

export async function deploymentsOf(orgId: string) {
  return db.select({ id: schema.deployments.id, name: schema.deployments.name }).from(schema.deployments).where(eq(schema.deployments.orgId, orgId));
}
