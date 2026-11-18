import { z } from "zod";

import { PRIORITIES } from "@/db/schema/enums";
import { COMMENT_CARDS } from "./types";

/** What the comment layer accepts (handoff v2 section 5). */

/** A comment is a note on a card, not a document. */
const BODY = z.string().trim().max(2000);

/**
 * The captured area of a card, as the browser produced it: a `data:` URL.
 *
 * JPEG only, which is what the capture encodes, and bounded well above the ~560-pixel-wide
 * picture it produces and well below anything that would be a file upload in disguise.
 */
const CAPTURE = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, "The capture must be a JPEG data URL.");

export const postCommentInput = z.object({
  card: z.enum(COMMENT_CARDS),
  body: BODY,
  /** Person ids, as the composer's `@` list offered them. */
  mentions: z.array(z.uuid()).max(20).default([]),
  capture: CAPTURE.optional(),
});

export const editCommentInput = z.object({
  commentId: z.uuid(),
  body: BODY.min(1),
  mentions: z.array(z.uuid()).max(20).default([]),
});

export const commentIdInput = z.object({ commentId: z.uuid() });
export const cardInput = z.object({ card: z.enum(COMMENT_CARDS) });

export const makeTaskInput = z.object({
  commentId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  /** A person id, or nothing to leave it unassigned. */
  assignee: z.uuid().optional(),
  priority: z.enum(PRIORITIES),
  dueAt: z.string().date().optional(),
  /** Which project the task is raised in; the form offers the ones they may write to. */
  projectKey: z.string().trim().min(1).max(20),
});

export type CardInput = z.infer<typeof cardInput>;
export type PostCommentInput = z.infer<typeof postCommentInput>;
export type EditCommentInput = z.infer<typeof editCommentInput>;
export type MakeTaskInput = z.infer<typeof makeTaskInput>;
