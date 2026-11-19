import { and, eq, inArray } from "drizzle-orm";
import Stripe from "stripe";

import { db, schema } from "@/db";
import { Refused } from "./api";
import { audit } from "./audit";
import { env } from "./env";
import { sendMail } from "./mail";
import { notify } from "./notifications";
import type { MemberContext } from "./session";

/**
 * The payment provider (BIL-001 FR-020 to FR-022): Stripe. Card details are entered on Stripe's
 * hosted page (Checkout in setup mode), so Hiwar only ever sees the brand and last 4 digits.
 * Month-end invoices are charged off-session; Stripe's signed webhook reports the outcome.
 *
 * Without STRIPE_SECRET_KEY the provider is off and Plan and usage uses its development card
 * dialog, which also stores only the brand and last 4 digits.
 */

type Org = typeof schema.organizations.$inferSelect;
type Invoice = typeof schema.invoices.$inferSelect;

let client: Stripe | null = null;

/** The Stripe client, or null when no provider is configured. STRIPE_API_BASE points it at stripe-mock in tests. */
export function provider(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) {
    const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
    client = new Stripe(key, base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : {});
  }
  return client;
}

export function providerHosted(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

async function customerOf(stripe: Stripe, org: Org, email: string): Promise<string> {
  if (org.paymentCustomerId) return org.paymentCustomerId;
  const customer = await stripe.customers.create({ name: org.name, email, metadata: { org_id: org.id } });
  await db.update(schema.organizations).set({ paymentCustomerId: customer.id }).where(eq(schema.organizations.id, org.id));
  return customer.id;
}

/** "Update card" with a provider: the URL of Stripe's hosted card form. */
export async function startCardSetup(member: MemberContext): Promise<string> {
  const stripe = provider();
  if (!stripe) throw new Refused("No payment provider is configured.", 409);
  const customer = await customerOf(stripe, member.org, member.user.email);
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "aed",
    success_url: `${env().APP_URL}/api/payments/setup-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env().APP_URL}/billing`,
    metadata: { org_id: member.org.id },
  });
  if (!session.url) throw new Refused("The payment provider did not return a card form.", 502);
  return session.url;
}

/** Back from the hosted form: makes the new card the default and stores its brand and last 4 digits. */
export async function completeCardSetup(member: MemberContext, sessionId: string): Promise<{ brand: string; last4: string }> {
  const stripe = provider();
  if (!stripe) throw new Refused("No payment provider is configured.", 409);
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
  if (session.metadata?.org_id !== member.org.id) throw new Refused("This card set-up belongs to another organization.", 403);
  const intent = session.setup_intent as Stripe.SetupIntent | null;
  const method = intent?.payment_method as Stripe.PaymentMethod | null;
  if (!method?.card) throw new Refused("The card was not saved. Try again.", 409);
  await stripe.customers.update(String(session.customer), { invoice_settings: { default_payment_method: method.id } });
  const card = { brand: method.card.brand.replace(/^\w/, (c) => c.toUpperCase()), last4: method.card.last4 };
  await db.update(schema.organizations).set({ paymentCard: card, paymentFailedAt: null }).where(eq(schema.organizations.id, member.org.id));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Billing", action: "Updated the payment method", item: `${card.brand} ending ${card.last4}` });
  return card;
}

/** Charges a month-end invoice off-session. Returns the invoice status. */
export async function chargeInvoice(org: Org, invoice: Invoice): Promise<"paid" | "failed" | "open"> {
  const stripe = provider();
  if (!stripe) return org.paymentCard ? "paid" : "open";
  if (!org.paymentCustomerId) return "open";
  const fils = Math.round(Number(invoice.totalAed) * 100);
  if (fils === 0) return "paid";
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: fils,
        currency: "aed",
        customer: org.paymentCustomerId,
        off_session: true,
        confirm: true,
        description: `Hiwar ${invoice.number}`,
        metadata: { invoice_id: invoice.id, org_id: org.id },
      },
      { idempotencyKey: `invoice-${invoice.id}` },
    );
    await db.update(schema.invoices).set({ paymentRef: intent.id }).where(eq(schema.invoices.id, invoice.id));
    return intent.status === "succeeded" ? "paid" : intent.status === "requires_payment_method" ? "failed" : "open";
  } catch (problem) {
    const reason = problem instanceof Stripe.errors.StripeError ? problem.message : "The payment failed.";
    await paymentFailed(org.id, invoice.id, reason);
    return "failed";
  }
}

/** FR-021: a failed payment starts the grace period (7 days, then new chats pause); Owner and Billing are told. */
export async function paymentFailed(orgId: string, invoiceId: string, reason: string): Promise<void> {
  await db.update(schema.invoices).set({ status: "failed", failureReason: reason }).where(eq(schema.invoices.id, invoiceId));
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!org) return;
  if (!org.paymentFailedAt) await db.update(schema.organizations).set({ paymentFailedAt: new Date() }).where(eq(schema.organizations.id, orgId));
  await notify(orgId, "usage", "A payment failed. Update the card within 7 days to keep new chats running.", "/billing");
  const recipients = await db
    .select({ email: schema.users.email })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.orgId, orgId), inArray(schema.members.role, ["owner", "billing"])));
  for (const r of recipients) {
    await sendMail(r.email, "Hiwar: a payment failed", `The payment for ${org.name} failed: ${reason}\nUpdate the card in Plan and usage within 7 days, or new chats pause. Your data stays.`);
  }
}

async function paymentSucceeded(invoiceId: string): Promise<void> {
  const [invoice] = await db.update(schema.invoices).set({ status: "paid", failureReason: null }).where(eq(schema.invoices.id, invoiceId)).returning();
  if (invoice) await db.update(schema.organizations).set({ paymentFailedAt: null }).where(eq(schema.organizations.id, invoice.orgId));
}

/** The provider's signed webhook (POST /api/payments/webhook). Unsigned or wrongly signed bodies are refused. */
export async function handleWebhook(rawBody: string, signature: string | null): Promise<string> {
  const stripe = provider();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret || !signature) throw new Refused("Webhook not configured.", 400);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new Refused("Invalid signature.", 400);
  }
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = intent.metadata?.invoice_id;
    if (!invoiceId) return event.type;
    const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) });
    if (!invoice || invoice.orgId !== intent.metadata?.org_id) return event.type;
    if (event.type === "payment_intent.succeeded") await paymentSucceeded(invoiceId);
    else await paymentFailed(invoice.orgId, invoiceId, intent.last_payment_error?.message ?? "The card was declined.");
  }
  return event.type;
}
