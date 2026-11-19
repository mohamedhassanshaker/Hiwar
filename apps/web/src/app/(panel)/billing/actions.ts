"use server";

import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { act } from "@/server/actions";
import { changePlan, limitsInput, setCard, setLimits } from "@/server/billing";
import { sendMail } from "@/server/mail";
import { startCardSetup } from "@/server/payments";
import { apiMember } from "@/server/session";

const write = () => apiMember("billing", { write: true });
const done = () => revalidatePath("/", "layout");

export async function changePlanAction(plan: "starter" | "growth" | "business", interval: "month" | "year") {
  return act(async () => {
    const r = await changePlan(await write(), plan, interval);
    done();
    return { effective: r.effective.toISOString(), immediate: r.immediate };
  });
}

export async function limitsAction(input: unknown) {
  return act(async () => {
    await setLimits(await write(), limitsInput.parse(input));
    done();
  });
}

/**
 * The payment provider's hosted card form returns only a brand and the last 4 digits.
 * In development the provider is simulated by the form in `card-dialog.tsx`.
 */
export async function cardAction(brand: string, last4: string) {
  return act(async () => {
    await setCard(await write(), { brand, last4 });
    done();
  });
}

/** With a payment provider: the URL of its hosted card form (FR-020). */
export async function cardSetupAction() {
  return act(async () => startCardSetup(await write()));
}

/** Enterprise: Talk to us (BIL-001 FR-018). */
export async function talkToUsAction() {
  return act(async () => {
    const member = await write();
    await db.insert(schema.salesRequests).values({ orgId: member.org.id, name: member.user.name, email: member.user.email, company: member.org.name, message: "Enterprise from Plan and usage" });
    await sendMail("sales@hiwar.local", `Enterprise request from ${member.org.name}`, `${member.user.name} <${member.user.email}> asked about Enterprise from Plan and usage.`);
  });
}
