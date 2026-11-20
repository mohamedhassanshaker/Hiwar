import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, pool, schema } from "@/db";
import { changePlan } from "@/server/billing";
import { allowance, checkAlerts, countAiConversation, usedThisPeriod } from "@/server/metering";
import { ensurePlans, latestPlanVersion, periodOf } from "@/server/plans";
import { conversation, world } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

async function onPlan(w: Awaited<ReturnType<typeof world>>, plan: "trial" | "starter" | "growth", extra: Partial<typeof schema.organizations.$inferInsert> = {}) {
  await ensurePlans();
  const v = await latestPlanVersion(plan);
  const [org] = await db.update(schema.organizations).set({ plan, planVersionId: v.id, status: plan === "trial" ? "trial" : "active", ...extra }).where(eq(schema.organizations.id, w.org.id)).returning();
  return org;
}

async function use(w: Awaited<ReturnType<typeof world>>, count: number) {
  for (let i = 0; i < count; i += 1) {
    const c = await conversation(w);
    // Closed, so the deployment's concurrent-conversation limit does not apply.
    await db.update(schema.conversations).set({ state: "CLOSED", closedAt: new Date() }).where(eq(schema.conversations.id, c.id));
    await db.insert(schema.usageEvents).values({ orgId: w.org.id, deploymentId: w.deployment.id, conversationId: c.id, period: periodOf() });
  }
}

describe("BIL-001 allowance at the limit", () => {
  it("AC-DEP-002-07: the concurrent limit counts the other open conversations, not the one asking", async () => {
    const w = await world();
    const org = await onPlan(w, "growth");
    const [deployment] = await db.update(schema.deployments).set({ settings: { ...w.deployment.settings, concurrentLimit: 1 } }).where(eq(schema.deployments.id, w.deployment.id)).returning();
    const first = await conversation(w);
    expect(await allowance(org, deployment, first.id)).toMatchObject({ allowed: true });
    const second = await conversation(w);
    expect(await allowance(org, deployment, second.id)).toMatchObject({ allowed: false, reason: "concurrent" });
  });

  it("AC-BIL-001-05: past the plan limit with the default behaviour the AI stops and routes to a person", async () => {
    const w = await world();
    const org = await onPlan(w, "starter");
    await use(w, 300);
    const a = await allowance(org, w.deployment);
    expect(a).toMatchObject({ allowed: false, behaviour: "stop_route" });
  });

  it("AC-BIL-001-07, -08: capped overage at AED 1.00 each on Starter, then the default behaviour at the cap", async () => {
    const w = await world();
    const org = await onPlan(w, "starter", { limitBehaviour: "overage", overageCapAed: "2.00" });
    await use(w, 300);
    expect(await allowance(org, w.deployment)).toMatchObject({ allowed: true, overage: true, rateAed: 1 });
    for (let i = 0; i < 2; i += 1) {
      const c = await conversation(w);
      await db.insert(schema.usageEvents).values({ orgId: w.org.id, deploymentId: w.deployment.id, conversationId: c.id, period: periodOf(), overage: true, amountAed: "1.00" });
    }
    expect((await usedThisPeriod(w.org.id)).overageAed).toBe(2);
    expect(await allowance(org, w.deployment)).toMatchObject({ allowed: false, reason: "overage cap" });
  });

  it("AC-BIL-001-08: reaching the overage cap notifies Owner and Billing once per period", async () => {
    const w = await world(["owner", "billing", "support_agent"]);
    const org = await onPlan(w, "starter", { limitBehaviour: "overage", overageCapAed: "2.00" });
    for (let i = 0; i < 2; i += 1) {
      const c = await conversation(w);
      await db.insert(schema.usageEvents).values({ orgId: w.org.id, deploymentId: w.deployment.id, conversationId: c.id, period: periodOf(), overage: true, amountAed: "1.00" });
    }
    await checkAlerts(org);
    await checkAlerts(org);
    const notices = await db.query.notifications.findMany({ where: eq(schema.notifications.orgId, w.org.id) });
    const cap = notices.filter((n) => n.title === "The monthly overage cap of AED 2.00 is reached");
    expect(cap).toHaveLength(1);
    expect(cap[0].roles).toEqual(expect.arrayContaining(["owner", "billing"]));
    expect(cap[0].roles).not.toContain("support_agent");
  });

  it("AC-BIL-001-17: new chats pause after a failed payment's 7-day grace period", async () => {
    const w = await world();
    const inGrace = await onPlan(w, "growth", { paymentFailedAt: new Date(Date.now() - 3 * 86_400_000) });
    expect((await allowance(inGrace, w.deployment)).allowed).toBe(true);
    const lapsed = await onPlan(w, "growth", { paymentFailedAt: new Date(Date.now() - 8 * 86_400_000) });
    expect(await allowance(lapsed, w.deployment)).toMatchObject({ allowed: false, behaviour: "offline", reason: "payment" });
  });

  it("AC-ORG-004-16: a trial that ended without a plan stops the AI", async () => {
    const w = await world();
    const org = await onPlan(w, "trial", { status: "trial_ended" });
    expect(await allowance(org, w.deployment)).toMatchObject({ allowed: false, behaviour: "offline" });
  });
});

describe("BIL-001 FR-027 counting", () => {
  it("AC-BIL-001-06: a conversation counts once, however many AI replies it has", async () => {
    const w = await world();
    const c = await conversation(w);
    const first = await db.transaction((tx) => countAiConversation(tx, c, { overage: false, rateAed: 0 }, 0.1));
    const fresh = (await db.query.conversations.findFirst({ where: eq(schema.conversations.id, c.id) }))!;
    const second = await db.transaction((tx) => countAiConversation(tx, fresh, { overage: false, rateAed: 0 }, 0.1));
    expect([first, second]).toEqual([true, false]);
    expect((await usedThisPeriod(w.org.id)).count).toBe(1);
  });
});

describe("BIL-001 FR-019 plan changes", () => {
  it("AC-BIL-001-11: a downgrade is blocked while usage exceeds the new limits", async () => {
    const w = await world(["owner", "admin", "builder"]);
    const org = await onPlan(w, "growth", { paymentCard: { brand: "Visa", last4: "4242" } });
    const member = { ...w.members[0], org };
    await expect(changePlan(member, "starter", "month")).rejects.toThrow(/seats: 3 in use, 2 allowed/);
  });

  it("AC-BIL-001-10: an upgrade applies at once", async () => {
    const w = await world(["owner"]);
    const org = await onPlan(w, "starter", { paymentCard: { brand: "Visa", last4: "4242" } });
    const result = await changePlan({ ...w.members[0], org }, "growth", "month");
    expect(result.immediate).toBe(true);
    const after = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, w.org.id) });
    expect(after?.plan).toBe("growth");
  });
});

describe("DEP-002 FR-010 concurrent conversations", () => {
  it("AC-DEP-002-07: at the concurrent limit the behaviour at limit applies to new conversations", async () => {
    const w = await world();
    await db.update(schema.deployments).set({ settings: { ...w.deployment.settings, concurrentLimit: 2 } }).where(eq(schema.deployments.id, w.deployment.id));
    const deployment = (await db.query.deployments.findFirst({ where: eq(schema.deployments.id, w.deployment.id) }))!;
    await conversation(w);
    await conversation(w);
    expect(await allowance(w.org, deployment)).toMatchObject({ allowed: false, reason: "concurrent" });
  });
});
