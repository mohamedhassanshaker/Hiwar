"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  createProjectInput,
  deleteProjectInput,
  projectMemberInput,
  removeProjectMemberInput,
  renameProjectInput,
  updateProjectPolicyInput,
} from "./schema";
import * as service from "./service";

/** S-20 and S-21 mutations. */

export async function createProject(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.createProject(createProjectInput.parse(input)));
  revalidatePath("/projects");
  return outcome;
}

/** `UC-21.2-01` … `-06`: save the project's policy. */
export async function updateProjectPolicy(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.updatePolicy(updateProjectPolicyInput.parse(input)));
  revalidatePath("/projects");
  return outcome;
}

/** Renames a project. */
export async function renameProject(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.renameProject(renameProjectInput.parse(input)));
  revalidatePath("/projects");
  return outcome;
}

/** `UC-21.3-01` and `-02`: add a person or an agent to the project. */
export async function addProjectMember(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addMember(projectMemberInput.parse(input)));
  revalidatePath("/projects");
  return outcome;
}

/** `UC-21.3-04` and `-05`: remove a member, reporting the open work they still hold. */
export async function removeProjectMember(input: unknown): Promise<Outcome<service.RemovalOutcome>> {
  const outcome = await attempt(() => service.removeMember(removeProjectMemberInput.parse(input)));
  if (outcome.ok && outcome.value.removed) revalidatePath("/projects");
  return outcome;
}

/**
 * Delete a project through `service.deleteProject`, which refuses while anything is still built
 * under it, and revalidate `/projects` when it is gone.
 */
export async function deleteProject(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteProject(deleteProjectInput.parse(input).key));
  if (outcome.ok) revalidatePath("/projects");
  return outcome;
}
