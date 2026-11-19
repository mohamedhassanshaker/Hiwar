import { and, desc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { Refused } from "./api";
import { audit } from "./audit";
import { sendMail } from "./mail";
import { usedThisPeriod } from "./metering";
import { notify } from "./notifications";
import { chargeInvoice } from "./payments";
import { latestPlanVersion, orgPlan, PLAN_LABEL, PLAN_ORDER, periodBounds, periodOf, VAT_RATE } from "./plans";
import type { MemberContext } from "./session";

/** BIL-001 and the trial of ORG-004 FR-013. */

type Plan = (typeof schema.planEnum.enumValues)[number];
type Org = typeof schema.organizations.$inferSelect;

async function counts(orgId: string) {
  const [row] = await db.execute<{ agents: number; deployments: number; seats: number; bytes: string }>(sql`
    SELECT (SELECT count(*) FROM agents WHERE org_id = ${orgId})::int AS agents,
           (SELECT count(*) FROM deployments WHERE org_id = ${orgId})::int AS deployments,
           ((SELECT count(*) FROM members WHERE org_id = ${orgId}) +
            (SELECT count(*) FROM invitations WHERE org_id = ${orgId} AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > now()))::int AS seats,
           (SELECT coalesce(sum(bytes), 0) FROM sources WHERE org_id = ${orgId})::text AS bytes`).then((r) => r.rows);
  return { agents: Number(row.agents), deployments: Number(row.deployments), seats: Number(row.seats), storageGb: Number(row.bytes) / 1024 ** 3 };
}

export async function billingSummary(org: Org) {
  const { version, limits } = await orgPlan(org);
  const used = await usedThisPeriod(org.id);
  const other = await counts(org.id);
  const { start, end } = periodBounds(periodOf());
  const plans = await Promise.all((["starter", "growth", "business", "enterprise"] as Plan[]).map((p) => latestPlanVersion(p)));
  const invoices = await db.query.invoices.findMany({ where: eq(schema.invoices.orgId, org.id), orderBy: desc(schema.invoices.periodStart), limit: 24 });
  return {
    plan: org.plan,
    status: org.status,
    trialEndsAt: org.trialEndsAt,
    trialDaysLeft: org.trialEndsAt ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null,
    period: { start, end },
    meters: [
      { key: "ai", name: "AI conversations", used: used.count, limit: limits.aiConversations, unit: "" },
      { key: "agents", name: "Agents", used: other.agents, limit: limits.agents, unit: "" },
      { key: "deployments", name: "Deployments", used: other.deployments, limit: limits.deployments, unit: "" },
      { key: "seats", name: "Seats", used: other.seats, limit: limits.seats, unit: "" },
      { key: "storage", name: "Knowledge storage", used: Math.round(other.storageGb * 10) / 10, limit: limits.storageGb, unit: " GB" },
    ],
    overage: { count: used.overage, amountAed: used.overageAed, rateAed: Number(version.overageAed ?? 0) },
    plans: plans.map((p) => ({ plan: p.plan, monthlyAed: p.monthlyAed, yearlyAed: p.yearlyAed, overageAed: p.overageAed, limits: p.limits })),
    invoices,
  };
}

/** D-017: upgrade now, downgrade from the next period; blocked while usage exceeds the new limits. */
export async function changePlan(member: MemberContext, plan: Plan, interval: "month" | "year"): Promise<{ effective: Date; immediate: boolean }> {
  if (plan === "trial" || plan === "enterprise") throw new Refused("Choose Starter, Growth or Business. For Enterprise, talk to us.");
  const org = member.org;
  if (!org.paymentCard) throw new Refused("Add a payment card first.", 402);
  const target = await latestPlanVersion(plan);
  const current = PLAN_ORDER.indexOf(org.plan);
  const upgrade = org.plan === "trial" || PLAN_ORDER.indexOf(plan) > current;
  if (!upgrade) {
    const used = await counts(org.id);
    const over: string[] = [];
    if (used.agents > target.limits.agents) over.push(`agents: ${used.agents} in use, ${target.limits.agents} allowed`);
    if (used.deployments > target.limits.deployments) over.push(`deployments: ${used.deployments} in use, ${target.limits.deployments} allowed`);
    if (used.seats > target.limits.seats) over.push(`seats: ${used.seats} in use, ${target.limits.seats} allowed`);
    if (used.storageGb > target.limits.storageGb) over.push(`knowledge storage: ${used.storageGb.toFixed(1)} GB in use, ${target.limits.storageGb} GB allowed`);
    if (over.length) throw new Refused(`Reduce these before switching to ${PLAN_LABEL[plan]}: ${over.join("; ")}.`, 409, { over });
  }
  const now = new Date();
  if (upgrade) {
    await db
      .update(schema.organizations)
      .set({ plan, status: "active", planVersionId: target.id, billingInterval: interval, scheduledPlan: null, scheduledPlanAt: null, trialEndsAt: null, renewsAt: periodBounds(periodOf()).end })
      .where(eq(schema.organizations.id, org.id));
    await audit({ orgId: org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Billing", action: "Changed the plan", item: org.name, change: `${PLAN_LABEL[org.plan]} to ${PLAN_LABEL[plan]} · ${interval === "year" ? "yearly" : "monthly"}` });
    return { effective: now, immediate: true };
  }
  const effective = periodBounds(periodOf()).end;
  await db.update(schema.organizations).set({ scheduledPlan: plan, scheduledPlanAt: effective, billingInterval: interval }).where(eq(schema.organizations.id, org.id));
  await audit({ orgId: org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Billing", action: "Scheduled a plan change", item: org.name, change: `${PLAN_LABEL[org.plan]} to ${PLAN_LABEL[plan]} on ${effective.toISOString().slice(0, 10)}` });
  return { effective, immediate: false };
}

export const limitsInput = z.object({
  limitBehaviour: z.enum(["stop_route", "offline", "overage"]),
  overageCapAed: z.number().min(0).max(1_000_000),
  alertFirst: z.union([z.literal(70), z.literal(80), z.literal(90)]),
  alertSecond: z.union([z.literal(95), z.literal(100)]),
});

export async function setLimits(member: MemberContext, input: z.infer<typeof limitsInput>): Promise<void> {
  if (input.limitBehaviour === "overage" && member.org.status === "trial") throw new Refused("Overage is not available during the trial.");
  await db.update(schema.organizations).set({ ...input, overageCapAed: input.overageCapAed.toFixed(2) }).where(eq(schema.organizations.id, member.org.id));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Billing", action: "Changed limits and alerts", item: member.org.name, change: `${input.limitBehaviour}${input.limitBehaviour === "overage" ? ` up to AED ${input.overageCapAed}` : ""} · alerts ${input.alertFirst}% and ${input.alertSecond}%` });
}

/** The payment provider returns only the brand and last 4 digits; Hiwar never sees the card number (FR-020). */
export async function setCard(member: MemberContext, card: { brand: string; last4: string }): Promise<void> {
  if (!/^\d{4}$/.test(card.last4)) throw new Refused("Invalid card reference.");
  await db.update(schema.organizations).set({ paymentCard: card, paymentFailedAt: null }).where(eq(schema.organizations.id, member.org.id));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Billing", action: "Updated the payment method", item: `${card.brand} ending ${card.last4}` });
}

/** Issues the invoice of a closed period: plan amount, overage lines and 5% VAT. */
export async function issueInvoice(org: Org, period: string): Promise<void> {
  if (org.plan === "trial") return;
  const { version } = await orgPlan(org);
  const usage = await db
    .select({ count: sql<number>`count(*) filter (where ${schema.usageEvents.overage})::int`, amount: sql<string>`coalesce(sum(${schema.usageEvents.amountAed}), 0)` })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.orgId, org.id), eq(schema.usageEvents.period, period)));
  const planAmount = org.billingInterval === "year" ? 0 : Number(version.monthlyAed ?? 0);
  const overage = Number(usage[0].amount);
  const vat = Math.round((planAmount + overage) * VAT_RATE * 100) / 100;
  const { start, end } = periodBounds(period);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.invoices);
  await db
    .insert(schema.invoices)
    .values({
      orgId: org.id,
      number: `INV-${period.replace("-", "")}-${String(n + 1).padStart(5, "0")}`,
      periodStart: start,
      periodEnd: end,
      plan: org.plan,
      planAmountAed: planAmount.toFixed(2),
      overageCount: usage[0].count,
      overageAmountAed: overage.toFixed(2),
      vatAed: vat.toFixed(2),
      totalAed: (planAmount + overage + vat).toFixed(2),
      status: "open",
    })
    .onConflictDoNothing()
    .returning();
  // FR-021: charged through the payment provider; a failure starts the grace period.
  const invoice = (await db.select().from(schema.invoices).where(and(eq(schema.invoices.orgId, org.id), eq(schema.invoices.periodStart, start))))[0];
  if (!invoice || invoice.status !== "open") return;
  const status = await chargeInvoice(org, invoice);
  if (status !== "open") await db.update(schema.invoices).set({ status }).where(and(eq(schema.invoices.id, invoice.id), eq(schema.invoices.status, "open")));
}

const DAY = 86_400_000;

/** Trial notices and end, data retention, scheduled downgrades and month-end invoices. */
export async function billingSweep(): Promise<void> {
  const now = new Date();
  // Three days before the trial ends: one notice (ORG-004 AC-ORG-004-15).
  const ending = await db.query.organizations.findMany({
    where: and(eq(schema.organizations.status, "trial"), isNotNull(schema.organizations.trialEndsAt), lte(schema.organizations.trialEndsAt, new Date(now.getTime() + 3 * DAY))),
  });
  for (const org of ending) {
    if (org.trialEndsAt! <= now) {
      await db.update(schema.organizations).set({ status: "trial_ended" }).where(eq(schema.organizations.id, org.id));
      await notify(org.id, "operator", "Your trial ended. Choose a plan to turn the AI back on.", "/billing");
      continue;
    }
    const sent = await db.insert(schema.alertsSent).values({ orgId: org.id, period: "trial", threshold: "3-days" }).onConflictDoNothing().returning();
    if (sent.length) {
      await notify(org.id, "operator", "Your trial ends in 3 days. Choose a plan to keep the AI running.", "/billing");
      const owner = await ownerEmail(org.id);
      if (owner) await sendMail(owner, "Your Hiwar trial ends in 3 days", `Your trial of ${org.name} ends on ${org.trialEndsAt!.toUTCString()}. Choose a plan in Plan and usage to keep your agents answering.`);
    }
  }
  // Trial ended without a plan: notices at 30 and 7 days before deletion, deletion after 90 days.
  const ended = await db.query.organizations.findMany({ where: and(eq(schema.organizations.status, "trial_ended"), isNotNull(schema.organizations.trialEndsAt)) });
  for (const org of ended) {
    const deleteAt = org.trialEndsAt!.getTime() + 90 * DAY;
    for (const days of [30, 7]) {
      if (now.getTime() >= deleteAt - days * DAY) {
        const sent = await db.insert(schema.alertsSent).values({ orgId: org.id, period: "retention", threshold: `${days}` }).onConflictDoNothing().returning();
        const owner = sent.length ? await ownerEmail(org.id) : null;
        if (owner) await sendMail(owner, `Your Hiwar data will be deleted in ${days} days`, `The trial of ${org.name} ended without a plan. Choose a plan within ${days} days to keep your agents, knowledge and conversations.`);
      }
    }
    if (now.getTime() >= deleteAt) await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
  }
  // Scheduled downgrades.
  const scheduled = await db.query.organizations.findMany({ where: and(isNotNull(schema.organizations.scheduledPlan), lt(schema.organizations.scheduledPlanAt, now)) });
  for (const org of scheduled) {
    const target = await latestPlanVersion(org.scheduledPlan!);
    await db.update(schema.organizations).set({ plan: org.scheduledPlan!, planVersionId: target.id, scheduledPlan: null, scheduledPlanAt: null }).where(eq(schema.organizations.id, org.id));
  }
  // OPS-002 FR-003: at renewal a subscription moves to the plan's latest version once that
  // version is at least 30 days old, so a price increase always had 30 days' notice.
  const renewing = await db.query.organizations.findMany({ where: and(eq(schema.organizations.status, "active"), isNotNull(schema.organizations.renewsAt), lt(schema.organizations.renewsAt, now)) });
  for (const org of renewing) {
    const latest = await latestPlanVersion(org.plan);
    const next = latest.id !== org.planVersionId && latest.effectiveFrom.getTime() <= now.getTime() - 30 * DAY ? latest.id : org.planVersionId;
    await db.update(schema.organizations).set({ planVersionId: next, renewsAt: periodBounds(periodOf(now)).end }).where(eq(schema.organizations.id, org.id));
  }
  // Invoices for the last closed period.
  const last = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
  const paying = await db.query.organizations.findMany({ where: eq(schema.organizations.status, "active") });
  for (const org of paying) {
    const exists = await db.query.invoices.findFirst({ where: and(eq(schema.invoices.orgId, org.id), eq(schema.invoices.periodStart, periodBounds(last).start)) });
    if (!exists && org.createdAt < periodBounds(last).end) await issueInvoice(org, last);
  }
}

async function ownerEmail(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: schema.users.email })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.orgId, orgId), eq(schema.members.role, "owner")));
  return row?.email ?? null;
}
