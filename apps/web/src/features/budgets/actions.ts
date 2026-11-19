"use server";

import { revalidatePath } from "next/cache";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";

import { saveBudgetInput } from "./schema";
import * as service from "./service";

/** S-71 and S-72 mutations. */

/** What the window's typed fields are called, for a refusal that names the field (`UC-71.1-06`). */
const FIELDS: FieldNames = {
  limitAed: ["The limit in AED", "الحد بالدرهم"],
  warnAtPct: ["The warning percentage", "نسبة التنبيه"],
  effectiveFrom: ["The start date", "تاريخ البدء"],
  effectiveTo: ["The end date", "تاريخ الانتهاء"],
};

/** `UC-71.1-03` ... `-07`: save a budget window, or say why it was refused. */
export async function saveBudget(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = saveBudgetInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.saveBudget(parsed.data);
    revalidatePath("/budgets");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.BudgetRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-71.1-08`: the budgets as a file, labelled as estimates. */
export async function exportBudgets(): Promise<{ filename: string; csv: string }> {
  return service.exportBudgets();
}
