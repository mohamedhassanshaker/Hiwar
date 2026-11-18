"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import { createSkillInput, importSkillInput, skillNameInput, updateSkillPackageInput, validatePackageInput } from "./schema";
import * as service from "./service";

/** S-53 mutations. */

export async function createSkill(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    await service.createSkill(createSkillInput.parse(input));
  });
  revalidatePath("/skills");
  return outcome;
}

/** `UC-53.2-01`: read a package and report what it is, without storing anything. */
export async function validateSkillPackage(
  input: unknown,
): Promise<
  | { ok: true; review: Awaited<ReturnType<typeof service.validateSkillPackage>> }
  | { ok: false; message: string; messageAr: string }
> {
  const values = validatePackageInput.parse(input);
  try {
    return { ok: true, review: await service.validateSkillPackage(values) };
  } catch (error) {
    if (error instanceof service.SkillRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-53.2-02`: import a package and enable it for the chosen agents. */
export async function importSkill(
  input: unknown,
): Promise<{ ok: true; skillName: string } | { ok: false; message: string; messageAr: string; reasons?: string[] }> {
  const values = importSkillInput.parse(input);
  try {
    const skillName = await service.importSkill(values);
    revalidatePath("/skills");
    return { ok: true, skillName };
  } catch (error) {
    if (error instanceof service.SkillRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr, reasons: error.reasons };
    }
    throw error;
  }
}

/** `UC-53.2`: replace an installed skill's files from a new package, as its next version. */
export async function updateSkillPackage(
  input: unknown,
): Promise<
  | { ok: true; versionLabel: string; moved: { agent: string; version: number }[] }
  | { ok: false; message: string; messageAr: string; reasons?: string[] }
> {
  const values = updateSkillPackageInput.parse(input);
  try {
    const result = await service.updateSkillPackage(values);
    revalidatePath("/skills");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof service.SkillRejected) {
      return { ok: false, message: error.message, messageAr: error.messageAr, reasons: error.reasons };
    }
    throw error;
  }
}

/** Deletes a skill no agent has ever enabled, or says which still carry it. */
export async function deleteSkill(input: unknown): Promise<Outcome<void>> {
  const { skillName } = skillNameInput.parse(input);
  const outcome = await attempt(() => service.deleteSkill(skillName));
  revalidatePath("/skills");
  return outcome;
}

/** `UC-53.3-03`: publish the skill's current version. */
export async function publishSkill(
  input: unknown,
): Promise<
  | { ok: true; usedBy: { agent: string; version: string }[] }
  | { ok: false; message: string; messageAr: string }
> {
  const { skillName } = skillNameInput.parse(input);
  try {
    const { usedBy } = await service.publishSkill(skillName);
    revalidatePath("/skills");
    return { ok: true, usedBy };
  } catch (error) {
    if (error instanceof service.SkillRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** The files of the skill's package, by path, or why they cannot be read. */
export async function loadSkillFiles(input: unknown): Promise<Outcome<{ path: string; size: number }[]>> {
  const { skillName } = skillNameInput.parse(input);
  return attempt(() => service.listSkillFiles(skillName));
}
