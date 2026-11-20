import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db, schema } from "@/db";
import type { PlanLimits } from "@/db/schema";
import { Refused } from "./api";
import { audit } from "./audit";
import { Forbidden } from "./authz";
import { hashToken, newToken } from "./crypto";
import { env } from "./env";
import { sendMail } from "./mail";
import { PLAN_LABEL, periodOf } from "./plans";
import { getSession, SESSION_COOKIE } from "./session";

/** OPS-001 to OPS-004: the operator portal for the Hiwar team. */

export type PlatformRole = "platform_admin" | "support_operator";
type Plan = (typeof schema.planEnum.enumValues)[number];

export interface Operator {
  id: string;
  name: string;
  role: PlatformRole;
}

/** OPS-001 FR-007: Hiwar staff with a platform role and 2-step sign-in only. */
export async function requireOperator(need?: PlatformRole): Promise<Operator> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/ops");
  const role = session.user.platformRole;
  if (!role || session.support) redirect("/");
  if (!session.user.totpEnabledAt) redirect("/two-step/setup");
  if (!session.mfaPassed) redirect("/two-step?next=/ops");
  if (need === "platform_admin" && role !== "platform_admin") throw new Forbidden("platform_admin");
  return { id: session.user.id, name: session.user.name, role };
}

async function record(op: Operator, orgId: string | null, action: string, reason: string): Promise<void> {
  await db.insert(schema.operatorActions).values({ operatorId: op.id, operatorName: op.name, orgId, action, reason });
}

export async function listOrganizations(filters: { q?: string; plan?: string; status?: string }) {
  const period = periodOf();
  return (
    await db.execute<{
      id: string;
      name: string;
      plan: Plan;
      status: string;
      created_at: string;
      owner: string | null;
      used: number;
      allowance: number;
    }>(sql`
      SELECT o.id, o.name, o.plan, o.status, o.created_at::text,
        (SELECT u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = 'owner' LIMIT 1) AS owner,
        (SELECT count(*) FROM usage_events e WHERE e.org_id = o.id AND e.period = ${period})::int AS used,
        coalesce((o.custom_limits->>'aiConversations')::int, (SELECT (pv.limits->>'aiConversations')::int FROM plan_versions pv WHERE pv.id = o.plan_version_id), 0) AS allowance
      FROM organizations o
      WHERE (${filters.q ?? ""} = '' OR o.name ILIKE '%' || ${filters.q ?? ""} || '%'
             OR EXISTS (SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND u.email ILIKE '%' || ${filters.q ?? ""} || '%'))
        AND (${filters.plan ?? ""} = '' OR o.plan::text = ${filters.plan ?? ""})
        AND (${filters.status ?? ""} = '' OR o.status::text = ${filters.status ?? ""})
      ORDER BY o.created_at DESC LIMIT 500`)
  ).rows;
}

export async function organizationDetail(id: string) {
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
  if (!org) return null;
  const [counts] = (
    await db.execute<{ members: number; used: number }>(sql`
      SELECT (SELECT count(*) FROM members WHERE org_id = ${id})::int AS members,
             (SELECT count(*) FROM usage_events WHERE org_id = ${id} AND period = ${periodOf()})::int AS used`)
  ).rows;
  const deployments = await db.query.deployments.findMany({ where: eq(schema.deployments.orgId, id) });
  const origins = await db.query.origins.findMany({ where: eq(schema.origins.orgId, id) });
  const actions = await db.query.operatorActions.findMany({ where: eq(schema.operatorActions.orgId, id), orderBy: desc(schema.operatorActions.createdAt), limit: 50 });
  const grant = await db.query.supportGrants.findFirst({ where: and(eq(schema.supportGrants.orgId, id), isNull(schema.supportGrants.revokedAt), gt(schema.supportGrants.expiresAt, new Date())) });
  return { org, counts, deployments: deployments.map((d) => ({ ...d, origins: origins.filter((o) => o.deploymentId === d.id) })), actions, grant };
}

async function ownerEmail(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: schema.users.email })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.orgId, orgId), eq(schema.members.role, "owner")));
  return row?.email ?? null;
}

const reasonOf = (reason: string) => {
  if (!reason.trim()) throw new Refused("Give a reason.");
  return reason.trim();
};

/** OPS-001 FR-003, FR-004. */
export async function extendTrial(op: Operator, orgId: string, days: number, reason: string): Promise<void> {
  if (op.role !== "platform_admin") throw new Forbidden("platform_admin");
  if (days < 1 || days > 30) throw new Refused("Extend by 1 to 30 days.");
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || (org.status !== "trial" && org.status !== "trial_ended")) throw new Refused("This organization is not on a trial.");
  const base = Math.max(Date.now(), org.trialEndsAt?.getTime() ?? Date.now());
  await db.update(schema.organizations).set({ status: "trial", trialEndsAt: new Date(base + days * 86_400_000) }).where(eq(schema.organizations.id, orgId));
  await record(op, orgId, `Extended the trial by ${days} days`, reasonOf(reason));
}

export async function suspend(op: Operator, orgId: string, reason: string): Promise<void> {
  if (op.role !== "platform_admin") throw new Forbidden("platform_admin");
  const why = reasonOf(reason);
  await db.update(schema.organizations).set({ status: "suspended", suspendedReason: why }).where(eq(schema.organizations.id, orgId));
  await db.delete(schema.sessions).where(eq(schema.sessions.orgId, orgId));
  await record(op, orgId, "Suspended", why);
  const owner = await ownerEmail(orgId);
  if (owner) await sendMail(owner, "Your Hiwar organization is suspended", `Your organization was suspended: ${why}\nYour data is kept. Contact support to resolve it.`);
}

export async function reactivate(op: Operator, orgId: string, reason: string): Promise<void> {
  if (op.role !== "platform_admin") throw new Forbidden("platform_admin");
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org) throw new Refused("Unknown organization.", 404);
  await db
    .update(schema.organizations)
    .set({ status: org.trialEndsAt && org.plan === "trial" ? (org.trialEndsAt > new Date() ? "trial" : "trial_ended") : "active", suspendedReason: null })
    .where(eq(schema.organizations.id, orgId));
  await record(op, orgId, "Reactivated", reasonOf(reason));
}

export const customLimitsInput = z.object({
  aiConversations: z.number().int().positive(),
  agents: z.number().int().positive(),
  deployments: z.number().int().positive(),
  seats: z.number().int().positive(),
  storageGb: z.number().positive(),
});

export async function setPlan(op: Operator, orgId: string, plan: Plan, custom: z.infer<typeof customLimitsInput> | null, reason: string): Promise<void> {
  if (op.role !== "platform_admin") throw new Forbidden("platform_admin");
  const version = await db.query.planVersions.findFirst({ where: eq(schema.planVersions.plan, plan), orderBy: desc(schema.planVersions.version) });
  if (!version) throw new Refused("Unknown plan.");
  await db
    .update(schema.organizations)
    .set({ plan, planVersionId: version.id, status: plan === "trial" ? "trial" : "active", customLimits: plan === "enterprise" ? custom : null })
    .where(eq(schema.organizations.id, orgId));
  await record(op, orgId, `Set the plan to ${PLAN_LABEL[plan]}${custom ? " with custom limits" : ""}`, reasonOf(reason));
}

// ---------------------------------------------------------------- plans and prices (OPS-002)

export const planVersionInput = z.object({
  monthlyAed: z.number().min(0).nullable(),
  yearlyAed: z.number().min(0).nullable(),
  overageAed: z.number().min(0).nullable(),
  trialDays: z.number().int().min(1).max(60).nullable(),
  limits: z.object({
    aiConversations: z.number().int().positive(),
    agents: z.number().int().positive(),
    deployments: z.number().int().positive(),
    seats: z.number().int().positive(),
    storageGb: z.number().positive(),
    models: z.array(z.enum(["fast", "standard", "advanced"])).min(1),
    httpTools: z.boolean(),
  }),
  applyLimitIncreaseNow: z.boolean(),
  reason: z.string().trim().min(1, "Give a reason."),
});

export async function latestVersions() {
  return (
    await db.execute<typeof schema.planVersions.$inferSelect & { plan: Plan }>(sql`
      SELECT DISTINCT ON (plan) id, plan, version, monthly_aed AS "monthlyAed", yearly_aed AS "yearlyAed", overage_aed AS "overageAed",
        limits, trial_days AS "trialDays", reason, effective_from AS "effectiveFrom"
      FROM plan_versions ORDER BY plan, version DESC`)
  ).rows;
}

function increaseOnly(before: PlanLimits, after: PlanLimits): boolean {
  return (
    after.aiConversations >= before.aiConversations &&
    after.agents >= before.agents &&
    after.deployments >= before.deployments &&
    after.seats >= before.seats &&
    after.storageGb >= before.storageGb
  );
}

/** OPS-002 FR-002 to FR-004: a new version; existing subscriptions keep theirs until renewal. */
export async function savePlanVersion(op: Operator, plan: Plan, input: z.infer<typeof planVersionInput>): Promise<void> {
  if (op.role !== "platform_admin") throw new Forbidden("platform_admin");
  const current = await db.query.planVersions.findFirst({ where: eq(schema.planVersions.plan, plan), orderBy: desc(schema.planVersions.version) });
  if (!current) throw new Refused("Unknown plan.");
  const [created] = await db
    .insert(schema.planVersions)
    .values({
      plan,
      version: current.version + 1,
      monthlyAed: input.monthlyAed?.toFixed(2) ?? null,
      yearlyAed: input.yearlyAed?.toFixed(2) ?? null,
      overageAed: input.overageAed?.toFixed(2) ?? null,
      trialDays: input.trialDays,
      limits: input.limits,
      reason: input.reason,
      changedBy: op.id,
    })
    .returning();
  await record(op, null, `Saved ${PLAN_LABEL[plan]} version ${created.version}`, input.reason);
  const priceUp = Number(input.monthlyAed ?? 0) > Number(current.monthlyAed ?? 0) || Number(input.yearlyAed ?? 0) > Number(current.yearlyAed ?? 0);
  if (input.applyLimitIncreaseNow) {
    if (priceUp || !increaseOnly(current.limits, input.limits)) {
      throw new Refused("Only a limit increase without a price increase can apply to existing customers now. The version is saved for new subscriptions.");
    }
    await db.update(schema.organizations).set({ planVersionId: created.id }).where(eq(schema.organizations.plan, plan));
  } else if (priceUp) {
    // FR-003: existing customers get at least 30 days' notice before a price increase applies at renewal.
    const orgs = await db.query.organizations.findMany({ where: eq(schema.organizations.plan, plan) });
    for (const org of orgs) {
      const owner = await ownerEmail(org.id);
      if (owner) {
        await sendMail(owner, `Hiwar ${PLAN_LABEL[plan]} price change`, `The ${PLAN_LABEL[plan]} price changes for new subscriptions. Your current price stays until your next renewal at least 30 days from now; we will remind you before it applies.`);
      }
    }
  }
}

// ---------------------------------------------------------------- support access (OPS-003)

export async function activeGrants() {
  return (
    await db.execute<{ id: string; org_id: string; name: string; expires_at: string; include_conversations: boolean }>(sql`
      SELECT g.id, g.org_id, o.name, g.expires_at::text, g.include_conversations FROM support_grants g JOIN organizations o ON o.id = g.org_id
      WHERE g.revoked_at IS NULL AND g.expires_at > now() ORDER BY g.expires_at`)
  ).rows;
}

const OPERATOR_COOKIE = "hiwar_operator";

/** Opens the customer's control panel read-only under their grant; the operator session is kept aside. */
export async function openSupportSession(op: Operator, orgId: string): Promise<void> {
  const grant = await db.query.supportGrants.findFirst({
    where: and(eq(schema.supportGrants.orgId, orgId), isNull(schema.supportGrants.revokedAt), gt(schema.supportGrants.expiresAt, new Date())),
  });
  if (!grant) throw new Refused("This organization has not granted support access.", 403);
  const jar = await cookies();
  const own = jar.get(SESSION_COOKIE)?.value;
  const { token, hash } = newToken();
  await db.insert(schema.sessions).values({ id: hash, userId: op.id, orgId, mfaPassed: true, supportGrantId: grant.id, expiresAt: grant.expiresAt });
  if (own) jar.set(OPERATOR_COOKIE, own, { httpOnly: true, sameSite: "lax", path: "/", secure: env().APP_URL.startsWith("https://") });
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", expires: grant.expiresAt, secure: env().APP_URL.startsWith("https://") });
  await record(op, orgId, "Opened the control panel under support access", `grant until ${grant.expiresAt.toISOString()}`);
  await audit({ orgId, actorUserId: op.id, actorName: "Hiwar support", area: "Users", action: "Opened support access", item: "Hiwar support" });
}

export async function exitSupportSession(): Promise<void> {
  const jar = await cookies();
  const support = jar.get(SESSION_COOKIE)?.value;
  if (support) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(support)));
  const own = jar.get(OPERATOR_COOKIE)?.value;
  if (own) jar.set(SESSION_COOKIE, own, { httpOnly: true, sameSite: "lax", path: "/" });
  else jar.delete(SESSION_COOKIE);
  jar.delete(OPERATOR_COOKIE);
}

// ---------------------------------------------------------------- cost and health (OPS-004)

export async function business(days: 7 | 30 | 90) {
  const from = new Date(Date.now() - days * 86_400_000);
  const perPlan = (
    await db.execute<{ plan: Plan; revenue: string; cost: string; conversations: number }>(sql`
      SELECT o.plan,
        coalesce((SELECT sum(i.plan_amount_aed + i.overage_amount_aed) FROM invoices i WHERE i.org_id = ANY(array_agg(o.id)) AND i.period_start >= ${from}), 0)::text AS revenue,
        coalesce((SELECT sum(u.cost_aed) FROM usage_events u WHERE u.org_id = ANY(array_agg(o.id)) AND u.occurred_at >= ${from}), 0)::text AS cost,
        (SELECT count(*) FROM usage_events u WHERE u.org_id = ANY(array_agg(o.id)) AND u.occurred_at >= ${from})::int AS conversations
      FROM organizations o GROUP BY o.plan ORDER BY o.plan`)
  ).rows;
  const perOrg = (
    await db.execute<{ id: string; name: string; plan: Plan; revenue: string; cost: string; conversations: number }>(sql`
      SELECT o.id, o.name, o.plan,
        coalesce((SELECT sum(i.plan_amount_aed + i.overage_amount_aed) FROM invoices i WHERE i.org_id = o.id AND i.period_start >= ${from}), 0)::text AS revenue,
        coalesce((SELECT sum(u.cost_aed) FROM usage_events u WHERE u.org_id = o.id AND u.occurred_at >= ${from}), 0)::text AS cost,
        (SELECT count(*) FROM usage_events u WHERE u.org_id = o.id AND u.occurred_at >= ${from})::int AS conversations
      FROM organizations o ORDER BY (coalesce((SELECT sum(i.plan_amount_aed + i.overage_amount_aed) FROM invoices i WHERE i.org_id = o.id AND i.period_start >= ${from}), 0)
        - coalesce((SELECT sum(u.cost_aed) FROM usage_events u WHERE u.org_id = o.id AND u.occurred_at >= ${from}), 0)) ASC LIMIT 200`)
  ).rows;
  const [health] = (
    await db.execute<{ p50: number | null; p95: number | null; ai_failures: number; ai_turns: number; ingestion_failures: number; double_replies: number; widget_load_errors: number }>(sql`
      WITH pairs AS (
        SELECT extract(epoch FROM (SELECT min(m2.created_at) FROM messages m2 WHERE m2.conversation_id = m.conversation_id AND m2.kind = 'ai' AND m2.created_at > m.created_at) - m.created_at) AS s
        FROM messages m WHERE m.kind = 'visitor' AND m.created_at > now() - interval '24 hours')
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY s) AS p95,
        (SELECT count(*) FROM messages WHERE kind = 'event' AND text LIKE 'The AI could not reply%' AND created_at > now() - interval '24 hours')::int AS ai_failures,
        (SELECT count(*) FROM messages WHERE kind = 'ai' AND created_at > now() - interval '24 hours')::int AS ai_turns,
        (SELECT count(*) FROM sources WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS ingestion_failures,
        (SELECT count(*) FROM widget_load_errors WHERE created_at > now() - interval '24 hours')::int AS widget_load_errors,
        (SELECT count(*) FROM (SELECT kind, lag(kind) OVER (PARTITION BY conversation_id ORDER BY created_at) AS prev FROM messages
           WHERE kind IN ('visitor','ai','staff') AND created_at > now() - interval '24 hours') x WHERE kind = 'ai' AND prev = 'staff')::int AS double_replies
      FROM pairs WHERE s IS NOT NULL`)
  ).rows;
  return { perPlan, perOrg, health };
}

/** OPS-004 FR-004: cost per conversation above AED 0.30 for 7 days, model errors above 2%, any double reply. */
export async function healthAlerts(): Promise<string[]> {
  const alerts: string[] = [];
  const [cost] = (
    await db.execute<{ avg: string | null }>(sql`SELECT avg(cost_aed)::text AS avg FROM usage_events WHERE occurred_at > now() - interval '7 days'`)
  ).rows;
  if (cost.avg && Number(cost.avg) > 0.3) alerts.push(`AI cost per conversation is AED ${Number(cost.avg).toFixed(2)} over 7 days (alert above AED 0.30).`);
  const { health } = await business(7);
  // "Above 2% for 5 minutes": the rate over the last 5 minutes, so a burst of errors is not diluted by a day of turns.
  const [recent] = (
    await db.execute<{ failures: number; turns: number }>(sql`
      SELECT count(*) FILTER (WHERE kind = 'event' AND text LIKE 'The AI could not reply%')::int AS failures,
        count(*) FILTER (WHERE kind = 'ai')::int AS turns
      FROM messages WHERE created_at > now() - interval '5 minutes' AND kind IN ('event', 'ai')`)
  ).rows;
  if (recent.failures > 0 && recent.failures / (recent.turns + recent.failures) > 0.02) alerts.push("Model error rate is above 2%.");
  if (health && health.double_replies > 0) alerts.push(`${health.double_replies} double replies in the last 24 hours.`);
  return alerts;
}

export async function operatorLog(limit = 100) {
  return db.query.operatorActions.findMany({ orderBy: desc(schema.operatorActions.createdAt), limit });
}

/** OPS-004 FR-004: emails each active alert to every Platform admin, once per day, and records it. */
export async function pushHealthAlerts(): Promise<void> {
  const alerts = await healthAlerts();
  if (alerts.length === 0) return;
  const admins = await db.query.users.findMany({ where: eq(schema.users.platformRole, "platform_admin") });
  for (const alert of alerts) {
    const already = await db.query.operatorActions.findFirst({
      where: and(eq(schema.operatorActions.action, "Health alert sent"), eq(schema.operatorActions.reason, alert), gt(schema.operatorActions.createdAt, new Date(Date.now() - 86_400_000))),
    });
    if (already) continue;
    for (const admin of admins) await sendMail(admin.email, "Hiwar health alert", `${alert}\n\nSee ${env().APP_URL}/ops/business`);
    await db.insert(schema.operatorActions).values({ operatorId: "00000000-0000-0000-0000-000000000000", operatorName: "Hiwar", orgId: null, action: "Health alert sent", reason: alert });
  }
}
