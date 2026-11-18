"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import { attachFileInput, attachHeldInput, previewInput, searchHeldInput, setFileStatusInput, setScopeOfUseInput, uploadFileInput } from "./schema";
import type { Preview } from "./types";
import * as service from "./service";

/** S-32 and S-33 mutations. */

export async function setFileStatus(input: unknown): Promise<Outcome<void>> {
  const parsed = setFileStatusInput.parse(input);
  const outcome = await attempt(() => service.setFileStatus(parsed));
  revalidatePath(parsed.kind === "artifact" ? "/artifacts" : "/files");
  return outcome;
}

/**
 * `UC-33.1-07`: change a file's scope of use and grants through `service.setScopeOfUse`, which
 * refuses anybody but the uploader (D183), then revalidate `/files`. Returns the outcome.
 */
export async function setScopeOfUse(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setScopeOfUse(setScopeOfUseInput.parse(input)));
  revalidatePath("/files");
  return outcome;
}

const ATTACHMENT_OWNER_PATH: Record<string, string> = {
  Request: "/requests",
  WorkItem: "/work-items",
  Room: "/discussion-rooms",
};

/** `UC-25.1-03`: attach a file to a request, a work item or a discussion room. */
export async function attachFile(input: unknown): Promise<Outcome<{ name: string }>> {
  const parsed = attachFileInput.parse(input);
  const outcome = await attempt(() => service.attachFile(parsed));
  revalidatePath(ATTACHMENT_OWNER_PATH[parsed.ownerType]);
  return outcome;
}

/** `UC-32.1-02`: what the preview of one file, artifact or attachment draws. */
export async function loadPreview(input: unknown): Promise<Outcome<Preview>> {
  const parsed = previewInput.parse(input);
  return attempt(() => service.previewOf(parsed.name, parsed.kind, parsed.owner));
}

/** `UC-25.1-03`: what an attachment picker may offer from the Files or Artifacts screens. */
export async function searchHeld(input: unknown): Promise<Outcome<service.HeldItem[]>> {
  const parsed = searchHeldInput.parse(input);
  return attempt(() => service.searchHeld(parsed));
}

/** `UC-25.1-03`, `UC-23.1-07`: attach a file or an artifact the platform already holds. */
export async function attachHeld(input: unknown): Promise<Outcome<{ name: string }>> {
  const parsed = attachHeldInput.parse(input);
  const outcome = await attempt(() => service.attachHeld(parsed));
  revalidatePath(ATTACHMENT_OWNER_PATH[parsed.ownerType]);
  return outcome;
}

/** `UC-33.1-01`: upload a file into a project under a scope of use. */
export async function uploadFile(input: unknown): Promise<Outcome<{ id: string; name: string; quarantined: string | null }>> {
  // Parsed inside `attempt`, so a name past its limit is a refusal the dialog shows, not a thrown 500 (UC-33.1-04).
  const outcome = await attempt(() => service.uploadFile(uploadFileInput.parse(input)));
  revalidatePath("/files");
  return outcome;
}

/** `UC-32.1-05`: delete an artifact or a file from its project. */
export async function deleteItem(input: unknown): Promise<Outcome<void>> {
  const parsed = setFileStatusInput.parse(input);
  const outcome = await attempt(() => service.deleteItem(parsed));
  revalidatePath(parsed.kind === "artifact" ? "/artifacts" : "/files");
  return outcome;
}
