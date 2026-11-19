import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool, schema } from "@/db";
import { Refused } from "@/server/api";
import { chargeInvoice, completeCardSetup, handleWebhook, provider, startCardSetup } from "@/server/payments";
import { world } from "./fixtures";

/**
 * BIL-001 FR-020 to FR-022 against Stripe's official API mock (`docker compose --profile payments up -d stripe-mock`)
 * and webhooks signed with the Stripe library.
 */
const SECRET = "whsec_test_hiwar";

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_hiwar";
  process.env.STRIPE_API_BASE = "http://localhost:12111";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterAll(async () => {
  await pool.end();
});

async function invoiceFor(orgId: string, total = "838.95") {
  const [invoice] = await db
    .insert(schema.invoices)
    .values({
      orgId,
      number: `INV-T-${Math.random().toString(36).slice(2, 10)}`,
      periodStart: new Date(Date.UTC(2026, 9, 1)),
      periodEnd: new Date(Date.UTC(2026, 10, 1)),
      plan: "growth",
      planAmountAed: "799.00",
      vatAed: "39.95",
      totalAed: total,
    })
    .returning();
  return invoice;
}

function signed(event: object): { body: string; signature: string } {
  const body = JSON.stringify(event);
  return { body, signature: Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) };
}

function intentEvent(type: string, invoiceId: string, orgId: string) {
  return {
    id: "evt_test",
    object: "event",
    type,
    data: { object: { id: "pi_test", object: "payment_intent", metadata: { invoice_id: invoiceId, org_id: orgId }, last_payment_error: { message: "Your card was declined." } } },
  };
}

describe("BIL-001 payment provider", () => {
  it("FR-020: Update card opens the provider's hosted form and creates the customer once", async () => {
    const w = await world(["owner"]);
    const url = await startCardSetup(w.members[0]);
    expect(url).toMatch(/^https:\/\//);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, w.org.id) });
    expect(org?.paymentCustomerId).toMatch(/^cus_/);
  });

  it("FR-020: a card set-up from another organization is refused", async () => {
    const w = await world(["owner"]);
    await expect(completeCardSetup(w.members[0], "cs_test_other")).rejects.toBeInstanceOf(Refused);
  });

  it("FR-022: a month-end invoice is charged off-session and the payment is recorded", async () => {
    const w = await world(["owner"]);
    await db.update(schema.organizations).set({ paymentCustomerId: "cus_test" }).where(eq(schema.organizations.id, w.org.id));
    const org = (await db.query.organizations.findFirst({ where: eq(schema.organizations.id, w.org.id) }))!;
    const invoice = await invoiceFor(w.org.id);
    const status = await chargeInvoice(org, invoice);
    expect(["paid", "open", "failed"]).toContain(status);
    const stored = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) });
    expect(stored?.paymentRef).toMatch(/^pi_/);
  });

  it("AC-BIL-001-17: a failed payment starts the grace period; a later success clears it", async () => {
    const w = await world(["owner", "billing", "support_agent"]);
    const invoice = await invoiceFor(w.org.id);
    const failed = signed(intentEvent("payment_intent.payment_failed", invoice.id, w.org.id));
    expect(await handleWebhook(failed.body, failed.signature)).toBe("payment_intent.payment_failed");
    let org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, w.org.id) });
    let stored = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) });
    expect(org?.paymentFailedAt).toBeInstanceOf(Date);
    expect([stored?.status, stored?.failureReason]).toEqual(["failed", "Your card was declined."]);
    const ok = signed(intentEvent("payment_intent.succeeded", invoice.id, w.org.id));
    await handleWebhook(ok.body, ok.signature);
    org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, w.org.id) });
    stored = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) });
    expect([org?.paymentFailedAt, stored?.status]).toEqual([null, "paid"]);
  });

  it("the webhook refuses unsigned, wrongly signed and cross-organization events", async () => {
    const a = await world(["owner"]);
    const b = await world(["owner"]);
    const invoice = await invoiceFor(a.org.id);
    const event = intentEvent("payment_intent.payment_failed", invoice.id, a.org.id);
    await expect(handleWebhook(JSON.stringify(event), null)).rejects.toBeInstanceOf(Refused);
    await expect(handleWebhook(JSON.stringify(event), "t=1,v1=bad")).rejects.toBeInstanceOf(Refused);
    const crossed = signed(intentEvent("payment_intent.payment_failed", invoice.id, b.org.id));
    await handleWebhook(crossed.body, crossed.signature);
    const stored = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) });
    expect(stored?.status).toBe("open");
    expect(provider()).not.toBeNull();
  });
});
