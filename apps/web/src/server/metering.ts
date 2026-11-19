import { and, eq, ne, sql } from "drizzle-orm";

import { db, schema, type Tx } from "@/db";
import { sendMail } from "./mail";
import { notify } from "./notifications";
import { orgPlan, periodOf } from "./plans";

/**
 * BIL-001 FR-025, FR-027 and DEP-002 FR-010: an AI conversation is counted once, when the
 * first AI reply in it is stored. The allowance check runs before the AI may reply.
 */

type Org = typeof schema.organizations.$inferSelect;
type Deployment = typeof schema.deployments.$inferSelect;

export async function usedThisPeriod(orgId: string, deploymentId?: string): Promise<{ count: number; overage: number; overageAed: number }> {
  const where = [eq(schema.usageEvents.orgId, orgId), eq(schema.usageEvents.period, periodOf())];
  if (deploymentId) where.push(eq(schema.usageEvents.deploymentId, deploymentId));
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      overage: sql<number>`count(*) filter (where ${schema.usageEvents.overage})::int`,
      overageAed: sql<string>`coalesce(sum(${schema.usageEvents.amountAed}), 0)`,
    })
    .from(schema.usageEvents)
    .where(and(...where));
  return { count: row.count, overage: row.overage, overageAed: Number(row.overageAed) };
}

export type Allowance =
  | { allowed: true; overage: boolean; rateAed: number }
  | { allowed: false; behaviour: "stop_route" | "offline"; reason: string };

/** Whether a new AI conversation may start on this deployment now. */
export async function allowance(org: Org, deployment: Deployment): Promise<Allowance> {
  if (org.status === "trial_ended" || org.status === "suspended") return { allowed: false, behaviour: "offline", reason: "plan" };
  if (org.paymentFailedAt && Date.now() - org.paymentFailedAt.getTime() > 7 * 86_400_000) {
    return { allowed: false, behaviour: "offline", reason: "payment" };
  }
  const { version, limits } = await orgPlan(org);
  const settings = deployment.settings;
  const behaviour = (b: string) => (b === "offline" ? "offline" : "stop_route") as "stop_route" | "offline";

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.deploymentId, deployment.id), ne(schema.conversations.state, "CLOSED")));
  if (open >= settings.concurrentLimit) return { allowed: false, behaviour: behaviour(settings.limitBehaviour), reason: "concurrent" };

  if (settings.monthlyQuota) {
    const site = await usedThisPeriod(org.id, deployment.id);
    if (site.count >= settings.monthlyQuota && settings.limitBehaviour !== "overage") {
      return { allowed: false, behaviour: behaviour(settings.limitBehaviour), reason: "deployment quota" };
    }
  }
  const used = await usedThisPeriod(org.id);
  if (used.count < limits.aiConversations) return { allowed: true, overage: false, rateAed: 0 };
  const rate = Number(version.overageAed ?? 0);
  if (org.limitBehaviour === "overage" && rate > 0 && org.status !== "trial") {
    if (used.overageAed + rate <= Number(org.overageCapAed)) return { allowed: true, overage: true, rateAed: rate };
    return { allowed: false, behaviour: "stop_route", reason: "overage cap" };
  }
  return { allowed: false, behaviour: org.limitBehaviour === "offline" ? "offline" : "stop_route", reason: "plan" };
}

/** Counts the conversation once; returns false when it was already counted. */
export async function countAiConversation(tx: Tx, conversation: typeof schema.conversations.$inferSelect, overage: { overage: boolean; rateAed: number }, costAed: number): Promise<boolean> {
  if (conversation.aiCounted) return false;
  await tx.update(schema.conversations).set({ aiCounted: true }).where(eq(schema.conversations.id, conversation.id));
  await tx
    .insert(schema.usageEvents)
    .values({
      orgId: conversation.orgId,
      deploymentId: conversation.deploymentId,
      conversationId: conversation.id,
      period: periodOf(),
      overage: overage.overage,
      amountAed: overage.overage ? overage.rateAed.toFixed(2) : "0",
      costAed: costAed.toFixed(4),
    })
    .onConflictDoNothing();
  return true;
}

/** Adds the AI cost of later turns to the conversation's usage row (for cost per conversation). */
export async function addCost(tx: Tx, conversationId: string, costAed: number): Promise<void> {
  await tx
    .update(schema.usageEvents)
    .set({ costAed: sql`${schema.usageEvents.costAed} + ${costAed.toFixed(4)}::numeric` })
    .where(eq(schema.usageEvents.conversationId, conversationId));
}

/** BIL-001 FR-011, FR-012: each threshold alerts once per period, to Owner and Billing by email and bell. */
export async function checkAlerts(org: Org): Promise<void> {
  const { limits } = await orgPlan(org);
  const used = await usedThisPeriod(org.id);
  const percent = Math.floor((used.count / limits.aiConversations) * 100);
  const period = periodOf();
  for (const threshold of [org.alertFirst, org.alertSecond]) {
    if (percent < threshold) continue;
    const inserted = await db
      .insert(schema.alertsSent)
      .values({ orgId: org.id, period, threshold: String(threshold) })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) continue;
    const title = `You have used ${percent}% of this month's AI conversations`;
    await notify(org.id, "usage", title, "/billing");
    const recipients = await db
      .select({ email: schema.users.email })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(and(eq(schema.members.orgId, org.id), sql`${schema.members.role} in ('owner','billing')`));
    for (const r of recipients) {
      await sendMail(r.email, `Hiwar: ${title}`, `${org.name} has used ${used.count} of ${limits.aiConversations} AI conversations this month (${percent}%).\nSee Plan and usage to upgrade or change what happens at the limit.`);
    }
  }
}
