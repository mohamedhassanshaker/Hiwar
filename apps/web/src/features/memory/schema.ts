import { z } from "zod";

/** Requirement 32: the memory action inputs. */

export const saveMemoryInput = z.object({
  path: z.string().min(1),
  /** Markdown: the first line of each block is its heading. */
  content: z.string().trim().min(1).max(20000),
  // `UC-55.3-02`: a version without a note is a change nobody can account for later.
  changeNote: z.string().trim().min(1, "Say what changed.").max(500),
  version: z.number().int().positive(),
});

export const reviewMemoryInput = z.object({
  path: z.string().min(1),
  decision: z.enum(["Approved", "Rejected"]),
});

export const deleteMemoryInput = z.object({ path: z.string().min(1) });

/** `UC-55.3-05`: a restore is a new version carrying an older one's content. */
export const restoreMemoryInput = z.object({
  path: z.string().min(1),
  fromVersion: z.number().int().positive(),
});

/** `UC-55.3-06`: a memory of one's own. */
export const createMemoryInput = z.object({
  scopePath: z.string().trim().min(1),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Use lower case, digits and hyphens."),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  requiresReview: z.boolean().default(true),
});

export type RestoreMemoryInput = z.infer<typeof restoreMemoryInput>;
export type CreateMemoryInput = z.infer<typeof createMemoryInput>;
export type SaveMemoryInput = z.infer<typeof saveMemoryInput>;
export type ReviewMemoryInput = z.infer<typeof reviewMemoryInput>;

/** A page of the memory list as a tool asks for it: at most 200 memories, 50 unless asked. */
export const memoryListInput = z.object({
  q: z.string().trim().max(200).optional(),
  scope: z.enum(["Organisation", "BusinessUnit", "Agent", "Session"]).optional(),
  status: z.enum(["Active", "PendingReview", "NeedsAttention", "Rejected", "Archived"]).optional(),
  reviewed: z.enum(["overdue", "never"]).optional(),
  open: z.string().trim().max(400).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
