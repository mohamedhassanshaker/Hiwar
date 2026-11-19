"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { act } from "@/server/actions";
import {
  customLimitsInput,
  exitSupportSession,
  extendTrial,
  openSupportSession,
  planVersionInput,
  reactivate,
  requireOperator,
  savePlanVersion,
  setPlan,
  suspend,
} from "@/server/ops";

type Plan = "trial" | "starter" | "growth" | "business" | "enterprise";
const done = () => revalidatePath("/ops", "layout");

export async function extendAction(orgId: string, days: number, reason: string) {
  return act(async () => {
    await extendTrial(await requireOperator("platform_admin"), orgId, days, reason);
    done();
  });
}
export async function suspendAction(orgId: string, reason: string) {
  return act(async () => {
    await suspend(await requireOperator("platform_admin"), orgId, reason);
    done();
  });
}
export async function reactivateAction(orgId: string, reason: string) {
  return act(async () => {
    await reactivate(await requireOperator("platform_admin"), orgId, reason);
    done();
  });
}
export async function setPlanAction(orgId: string, plan: Plan, custom: unknown, reason: string) {
  return act(async () => {
    await setPlan(await requireOperator("platform_admin"), orgId, plan, custom ? customLimitsInput.parse(custom) : null, reason);
    done();
  });
}
export async function savePlanAction(plan: Plan, input: unknown) {
  return act(async () => {
    await savePlanVersion(await requireOperator("platform_admin"), plan, planVersionInput.parse(input));
    done();
  });
}
export async function openSupportAction(orgId: string) {
  const op = await requireOperator();
  await openSupportSession(op, orgId);
  redirect("/conversations");
}
export async function exitSupportAction() {
  await exitSupportSession();
  redirect("/ops/support");
}
