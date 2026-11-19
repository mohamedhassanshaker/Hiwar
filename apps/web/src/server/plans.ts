import { and, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import type { PlanLimits } from "@/db/schema";

type Plan = (typeof schema.planEnum.enumValues)[number];

/** The launch plans (BIL-001 FR-017, trial per ORG-004 FR-013). Seeded as version 1 of each plan. */
export const LAUNCH_PLANS: {
  plan: Plan;
  monthlyAed: string | null;
  yearlyAed: string | null;
  overageAed: string | null;
  trialDays: number | null;
  limits: PlanLimits;
}[] = [
  {
    plan: "trial",
    monthlyAed: "0",
    yearlyAed: "0",
    overageAed: null,
    trialDays: 14,
    limits: { aiConversations: 100, agents: 5, deployments: 1, seats: 10, storageGb: 5, models: ["fast", "standard"], httpTools: true },
  },
  {
    plan: "starter",
    monthlyAed: "199",
    yearlyAed: "1990",
    overageAed: "1.00",
    trialDays: null,
    limits: { aiConversations: 300, agents: 1, deployments: 1, seats: 2, storageGb: 1, models: ["fast"], httpTools: false },
  },
  {
    plan: "growth",
    monthlyAed: "799",
    yearlyAed: "7990",
    overageAed: "0.80",
    trialDays: null,
    limits: { aiConversations: 2000, agents: 5, deployments: 5, seats: 10, storageGb: 5, models: ["fast", "standard"], httpTools: true },
  },
  {
    plan: "business",
    monthlyAed: "2999",
    yearlyAed: "29990",
    overageAed: "0.60",
    trialDays: null,
    limits: {
      aiConversations: 10000,
      agents: 20,
      deployments: 20,
      seats: 30,
      storageGb: 25,
      models: ["fast", "standard", "advanced"],
      httpTools: true,
    },
  },
  {
    plan: "enterprise",
    monthlyAed: null,
    yearlyAed: null,
    overageAed: null,
    trialDays: null,
    limits: {
      aiConversations: 100000,
      agents: 100,
      deployments: 100,
      seats: 200,
      storageGb: 100,
      models: ["fast", "standard", "advanced"],
      httpTools: true,
    },
  },
];

export const PLAN_ORDER: Plan[] = ["trial", "starter", "growth", "business", "enterprise"];
export const PLAN_LABEL: Record<Plan, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  business: "Business",
  enterprise: "Enterprise",
};

export const VAT_RATE = 0.05;

/** Inserts version 1 of each launch plan when the table is empty. */
export async function ensurePlans(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.planVersions);
  if (count > 0) return;
  await db.insert(schema.planVersions).values(LAUNCH_PLANS.map((p) => ({ ...p, version: 1, reason: "Launch prices" })));
}

/** The latest version of a plan, which new subscriptions use (OPS-002 FR-003). */
export async function latestPlanVersion(plan: Plan) {
  await ensurePlans();
  const row = await db.query.planVersions.findFirst({
    where: eq(schema.planVersions.plan, plan),
    orderBy: desc(schema.planVersions.version),
  });
  if (!row) throw new Error(`No plan version for ${plan}`);
  return row;
}

/** The plan version an organization is on, with Enterprise custom limits applied. */
export async function orgPlan(org: typeof schema.organizations.$inferSelect) {
  await ensurePlans();
  const version = org.planVersionId
    ? await db.query.planVersions.findFirst({ where: eq(schema.planVersions.id, org.planVersionId) })
    : await db.query.planVersions.findFirst({
        where: and(eq(schema.planVersions.plan, org.plan)),
        orderBy: desc(schema.planVersions.version),
      });
  if (!version) throw new Error("Plan version missing");
  const limits: PlanLimits = { ...version.limits, ...(org.customLimits ?? {}) };
  return { version, limits };
}

/** The billing period key for a date: YYYY-MM, calendar month in UTC (BIL-001 FR-015). */
export function periodOf(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}
