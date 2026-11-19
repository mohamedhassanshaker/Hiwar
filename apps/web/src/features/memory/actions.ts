"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import type { MemoryVersion } from "./types";
import { createMemoryInput, deleteMemoryInput, restoreMemoryInput, reviewMemoryInput, saveMemoryInput } from "./schema";
import * as service from "./service";

/** S-55 mutations. */

export async function saveMemory(input: unknown): Promise<Outcome<service.SaveOutcome>> {
  const outcome = await attempt(() => service.saveMemory(saveMemoryInput.parse(input)));
  revalidatePath("/memory");
  return outcome;
}

/**
 * `UC-55.2-04`: approve or reject a proposed memory version through `service.reviewMemory`,
 * which refuses an agent and the person who proposed it, then revalidate `/memory`.
 */
export async function reviewMemory(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.reviewMemory(reviewMemoryInput.parse(input)));
  revalidatePath("/memory");
  return outcome;
}

/** One memory's version history, read when its History opens: the page carries only the opened one's. */
export async function loadVersions(path: string): Promise<Outcome<MemoryVersion[]>> {
  return attempt(() => service.loadVersions(path));
}

/** `UC-55.3-04`: two versions side by side. */
export async function compareVersions(path: string, from: number, to: number): Promise<{ from: string; to: string }> {
  return service.compareVersions(path, from, to);
}

/** `UC-55.3-05`: a new version carrying an older one's content. */
export async function restoreVersion(input: unknown): Promise<Outcome<number>> {
  const outcome = await attempt(() => service.restoreVersion(restoreMemoryInput.parse(input)));
  revalidatePath("/memory");
  return outcome;
}

/** `UC-55.3-06`: a memory of one's own. */
export async function createMemory(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createMemory(createMemoryInput.parse(input)));
  revalidatePath("/memory");
  return outcome;
}

/** D68: clears this person's own agent memory. Takes no argument, so it can clear nobody else's. */
export async function clearMyMemory(): Promise<Outcome<number>> {
  const outcome = await attempt(() => service.clearMyMemory());
  revalidatePath("/memory");
  return outcome;
}

/** Deletes a memory entry, its own version history with it. */
export async function deleteMemory(input: unknown): Promise<Outcome<void>> {
  const { path } = deleteMemoryInput.parse(input);
  const outcome = await attempt(() => service.deleteMemory(path));
  revalidatePath("/memory");
  return outcome;
}

