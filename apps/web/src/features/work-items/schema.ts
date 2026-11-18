import { z } from "zod";

import { PRIORITIES, WORK_ITEM_STATUSES, WORK_ITEM_TYPES } from "@/db/schema/enums";

/** Requirement 32: every work-item action input, validated before the service sees it. */

export const createWorkItemInput = z.object({
  projectKey: z.string().min(1),
  type: z.enum(WORK_ITEM_TYPES),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().max(4000).optional(),
  assignee: z.string().min(1).optional(),
  reviewer: z.string().min(1).optional(),
  priority: z.enum(PRIORITIES),
  dueAt: z.string().date().optional(),
  parentKey: z.string().min(1).optional(),
  /** D312: the request the work is for; the item takes the request's project and is listed on it. */
  requestKey: z.string().trim().min(1).max(20).optional(),
  /** `UC-24.3-04`: a bug's severity, steps, and expected against actual. */
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const changeStatusInput = z.object({
  key: z.string().min(1),
  status: z.enum(WORK_ITEM_STATUSES),
  version: z.number().int().positive(),
});

/**
 * `UC-24.1` and `UC-24.3`: one work item as a patch — the one write path for a work item.
 *
 * Name the fields to change and nothing else: an omitted field is left alone and an
 * explicit null clears one. `expectedVersion` is the version last read and goes in the
 * SQL `WHERE`, so an item somebody has moved since is refused rather than overwritten.
 */
export const updateWorkItemInput = z
  .object({
    key: z.string().trim().min(1).max(20),
    expectedVersion: z.number().int().positive(),
    titleEn: z.string().trim().min(1).max(200).optional(),
    titleAr: z.string().trim().min(1).max(200).optional(),
    descriptionEn: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: z.string().date().nullable().optional(),
    /** Sensitive: the status is what says the work is finished, cancelled or started again. */
    status: z.enum(WORK_ITEM_STATUSES).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      ["titleEn", "titleAr", "descriptionEn", "priority", "dueAt", "status"].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  );

export type CreateWorkItemInput = z.infer<typeof createWorkItemInput>;
export type ChangeStatusInput = z.infer<typeof changeStatusInput>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemInput>;

/** `UC-24.2-01`: the advanced search criteria. */
export const searchInput = z.object({
  keyword: z.string().trim().max(200).optional(),
  projectKey: z.string().trim().max(20).optional(),
  type: z.enum(WORK_ITEM_TYPES).optional(),
  status: z.enum(WORK_ITEM_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  /** A person id, an agent code, `unassigned`, or nothing for anyone. */
  assignee: z.string().trim().max(80).optional(),
  dueFrom: z.string().date().optional(),
  dueTo: z.string().date().optional(),
});

/** `UC-24.2-02`: a name for one set of criteria. */
export const saveViewInput = z.object({
  name: z.string().trim().min(1).max(60),
  filter: z.record(z.string(), z.unknown()),
});

/** `UC-24.3-05`: what to look for a near-duplicate of. */
export const similarInput = z.object({
  projectKey: z.string().trim().min(1).max(20),
  title: z.string().trim().max(200),
});

/** `UC-25.2`: an act on one work item from its drawer. */
export const workItemKeyInput = z.object({ key: z.string().trim().min(1).max(20) });

export const approveInput = z.object({
  key: z.string().trim().min(1).max(20),
  /** `UC-25.2-08`: why open sub items are being overridden. */
  override: z.string().trim().max(500).optional(),
});

export const commentInput = z.object({
  key: z.string().trim().min(1).max(20),
  text: z.string().trim().min(1).max(4000),
});

export const reasonInput = z.object({
  key: z.string().trim().min(1).max(20),
  reason: z.string().trim().min(1).max(500),
});

export const assignToAgentInput = z.object({
  key: z.string().trim().min(1).max(20),
  agentCode: z.string().trim().min(1).max(40),
});

/** A person id or an agent code. */
export const assignInput = z.object({
  key: z.string().trim().min(1).max(20),
  assignee: z.string().trim().min(1).max(40),
});

export const subItemInput = z.object({
  parentKey: z.string().trim().min(1).max(20),
  titleEn: z.string().trim().min(1).max(200),
});

export const subItemDoneInput = z.object({
  key: z.string().trim().min(1).max(20),
  done: z.boolean(),
});

/** `UC-25.1-03`: a file the browser hands over as a `data:` URL. */
export const attachInput = z.object({
  key: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  dataUrl: z.string().min(1).max(40_000_000),
});
