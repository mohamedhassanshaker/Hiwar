import { z } from "zod";

import { ARTIFACT_LINK_TYPES, ATTACHMENT_OWNERS, FILE_SCOPES_OF_USE } from "@/db/schema/enums";

/** Requirement 32: the artifact and project-file action inputs. */

export const setFileStatusInput = z.object({
  name: z.string().min(1),
  kind: z.enum(["artifact", "file"]),
  active: z.boolean(),
});

export const setScopeOfUseInput = z.object({
  name: z.string().min(1),
  scope: z.enum(FILE_SCOPES_OF_USE),
  grants: z.array(z.string().min(1)).default([]),
});

/** `UC-33.1-01` … `-04`: an uploaded file, as the browser hands it over. */
export const uploadFileInput = z.object({
  projectKey: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  /** The bytes, as the `data:` URL a file input produces. */
  dataUrl: z.string().min(1),
  scope: z.enum(FILE_SCOPES_OF_USE),
  /** Person ids and agent codes, used only when the scope is `Selected`. */
  grants: z.array(z.string().trim().min(1)).max(64).default([]),
});

/** The items a person attaches files to; a conversation's files come from its visitor. */
const ITEM_ATTACHMENT_OWNERS = ATTACHMENT_OWNERS.filter((owner) => owner !== "Conversation") as ["Request", "WorkItem", "Room"];

/**
 * `UC-25.1-03`: a file attached to one request or work item.
 *
 * An attachment belongs to the item rather than to the project, so it carries no scope of
 * its own: whoever may see the item may read what is attached to it.
 */
export const attachFileInput = z.object({
  ownerType: z.enum(ITEM_ATTACHMENT_OWNERS),
  /** The item's key, as the screen shows it: `REQ-9012`, `TSK-2311`. */
  ownerKey: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(1),
});

/** An attachment picker's search of what the platform already holds. */
export const searchHeldInput = z.object({
  kind: z.enum(["File", "Artifact"]),
  q: z.string().max(200).default(""),
});

/** `UC-32.1-02`: the item a preview is of, as `/api/files` names it. */
export const previewInput = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["artifact", "file", "attachment"]),
  owner: z.object({ type: z.enum(ITEM_ATTACHMENT_OWNERS), key: z.string().trim().min(1) }).optional(),
});

/** A file or an artifact the platform already holds, attached to an item by its id. */
export const attachHeldInput = z.object({
  ownerType: z.enum(ITEM_ATTACHMENT_OWNERS),
  ownerKey: z.string().trim().min(1),
  kind: z.enum(["File", "Artifact"]),
  id: z.uuid(),
});

/**
 * `UC-32.1-01`: a new, versioned artifact — a run's or a person's own output, not a file
 * uploaded from somewhere else. `attachFileInput` above is for an existing file; this is
 * for what was just produced and may stand in a project on its own, or against a work item,
 * a request or a room.
 */
export const createArtifactInput = z.object({
  /** Optional when the artifact is linked to an item: it then stands in that item's project. */
  projectKey: z.string().trim().min(1).optional(),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(200),
  /** The bytes, as the `data:` URL a file input produces. */
  dataUrl: z.string().min(1),
  linkedToType: z.enum(ARTIFACT_LINK_TYPES).optional(),
  /** The item's key, as the screen shows it: `REQ-9012`, `TSK-2311`, `SES-1003`. */
  linkedToKey: z.string().trim().min(1).optional(),
  /** The run that produced it, when one did — carried for the run viewer's own trace. */
  runId: z.uuid().optional(),
});

/**
 * One artifact or project file as a patch — the one write path for a stored item.
 *
 * Name the fields to change and nothing else: an omitted field is left alone, and the
 * grants are replaced whole by the list sent. `expectedVersion` is the version last read
 * and goes in the SQL `WHERE`, so an item somebody has saved since is refused rather than
 * overwritten. An artifact has no scope of use of its own; it takes its project's.
 */
export const updateFileInput = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(["artifact", "file"]),
    expectedVersion: z.number().int().positive(),
    active: z.boolean().optional(),
    /** Sensitive: this is who may read the file. Never offered to an agent. */
    scopeOfUse: z.enum(FILE_SCOPES_OF_USE).optional(),
    /** Person ids and agent codes, read only when the scope is `Selected`. */
    grants: z.array(z.string().trim().min(1)).max(64).optional(),
  })
  .strict()
  .refine((patch) => ["active", "scopeOfUse", "grants"].some((field) => field in patch), {
    message: "An edit has to change something: name one field.",
  });

/**
 * The same patch as an agent may send it: the scope of use and its grants are left out.
 *
 * Who may read a file is an authorisation decision, and an agent that could make it could
 * grant itself a file it may not read. It is not gated behind an approval, it is absent.
 */
export const agentUpdateFileInput = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(["artifact", "file"]),
    expectedVersion: z.number().int().positive(),
    active: z.boolean(),
  })
  .strict();

export type UpdateFileInput = z.infer<typeof updateFileInput>;
export type AttachFileInput = z.infer<typeof attachFileInput>;
export type SearchHeldInput = z.infer<typeof searchHeldInput>;
export type AttachHeldInput = z.infer<typeof attachHeldInput>;
export type UploadFileInput = z.infer<typeof uploadFileInput>;
export type SetFileStatusInput = z.infer<typeof setFileStatusInput>;
export type SetScopeOfUseInput = z.infer<typeof setScopeOfUseInput>;
export type CreateArtifactInput = z.infer<typeof createArtifactInput>;

/** A page of the Files or Artifacts list as a tool asks for it: at most 200 rows, 50 unless asked. */
export const itemListInput = z.object({
  q: z.string().trim().max(200).optional(),
  project: z.string().trim().max(64).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
