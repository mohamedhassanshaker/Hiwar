"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";
import * as service from "./service";

const pauseAgentsInput = z.object({ paused: z.boolean() });

/** S-78: pausing and resuming every agent. */
export async function setAgentsPaused(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const { paused } = pauseAgentsInput.parse(input);
    await service.pauseAgents(paused);
  });
  revalidatePath("/ops/ai/system");
  revalidatePath("/ops/ai/agents");
  return outcome;
}
