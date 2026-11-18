import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { can, requirePermission, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";

export { FileRejected } from "./errors";
export { readContent, mayReadFile, previewOf } from "./content-service";
export { setFileStatus, type FileDiff, updateFile, deleteItem, setScopeOfUse } from "./edit-service";
export { uploadFile, attachFile, attachHeld, readHeld, searchHeld, createArtifact, artifactsProducedSince } from "./upload-service";
export type { HeldItem, ItemFilters } from "./repository";

/** S-32 artifacts, S-33 project files. */

/** One page of the Artifacts screen, newest first, with the total matching the filters (D349). */

export async function loadArtifacts(
  filters: repository.ItemFilters = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  await requirePermission("files:read");
  const [listed, mayWrite] = await Promise.all([
    // `UC-32.1-07`: an artifact of a project this person cannot see is not listed.
    repository.listArtifacts(await visibleProjectIds("files:read"), filters, page),
    can("files:write"),
  ]);
  return { ...listed, mayWrite };
}

/**
 * One page of the Files screen, newest first: the files in projects this person may see with
 * `files:read` that their scope of use lets them read, the total matching the filters, and
 * whether they may write. Requires `files:read`.
 */
export async function loadFiles(
  filters: repository.ItemFilters = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  const session = await requirePermission("files:read");
  const [listed, mayWrite] = await Promise.all([
    // `UC-33.1-01` … `-03`: the scope of use decides who the file is listed to at all.
    repository.listFiles(await visibleProjectIds("files:read"), session.personId, filters, page),
    can("files:write"),
  ]);
  return { ...listed, mayWrite };
}
