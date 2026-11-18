"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import { runNowInput, saveScheduleInput, setAllSchedulesActiveInput, setScheduleActiveInput } from "./schema";
import * as service from "./service";

/** S-31 mutations. */

export async function setScheduleActive(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setScheduleActive(setScheduleActiveInput.parse(input)));
  revalidatePath("/scheduled-work-items");
  return outcome;
}

/** `UC-31.1-03`: fire one schedule now, reporting what the firing produced. */
export async function runNow(input: unknown): Promise<Outcome<service.FiringOutcome>> {
  const outcome = await attempt(() => service.runNow(runNowInput.parse(input).id));
  revalidatePath("/scheduled-work-items");
  return outcome;
}

/** `UC-31.2-01` and `UC-31.1-04`: create or edit a scheduled work item. */
export async function saveSchedule(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.saveSchedule(saveScheduleInput.parse(input)));
  revalidatePath("/scheduled-work-items");
  return outcome;
}

/** `UC-31.1-05`: pause or resume every schedule at once. */
export async function setAllSchedulesActive(input: unknown): Promise<number> {
  const changed = await service.setAllActive(setAllSchedulesActiveInput.parse(input).active);
  revalidatePath("/scheduled-work-items");
  return changed;
}

/**
 * Delete a scheduled work item and its Temporal Schedule through `service.deleteSchedule`, and
 * revalidate the schedules screen when it is gone.
 */
export async function deleteSchedule(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteSchedule(runNowInput.parse(input).id));
  if (outcome.ok) revalidatePath("/scheduled-work-items");
  return outcome;
}
