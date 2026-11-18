"use server";

import { cardInput, commentIdInput, editCommentInput, makeTaskInput, postCommentInput } from "./schema";
import * as service from "./service";
import type { CommentThread, Mentionable } from "./types";

/** What the comment layer on the dashboard cards calls (handoff v2 section 5). */

export async function loadThread(input: unknown): Promise<CommentThread> {
  return service.loadThread(cardInput.parse(input));
}

/** Every card thread with anything in it, with the caller's unread state on each. */
export async function loadThreads(): Promise<CommentThread[]> {
  return service.loadThreads();
}

/** The caller's unread comment count per card; cards with none are left out. */
export async function unreadByCard(): Promise<Record<string, number>> {
  return service.unreadByCard();
}

/** The active people a comment may name, the caller excluded. */
export async function mentionablePeople(): Promise<Mentionable[]> {
  return service.mentionable();
}

/** Marks the card's thread read for the caller up to now. */
export async function markThreadRead(input: unknown): Promise<void> {
  return service.markRead(cardInput.parse(input));
}

/** Posts a comment on a card and returns its id. */
export async function postComment(input: unknown): Promise<string> {
  return service.postComment(postCommentInput.parse(input));
}

/** Replaces the text and mentions of the caller's own comment. */
export async function editComment(input: unknown): Promise<void> {
  return service.editComment(editCommentInput.parse(input));
}

/** Deletes the caller's own comment, leaving a placeholder in the thread. */
export async function deleteComment(input: unknown): Promise<void> {
  return service.deleteComment(commentIdInput.parse(input).commentId);
}

/** Returns the key of the work item raised, which the thread then shows. */
export async function makeTask(input: unknown): Promise<string> {
  return service.makeTask(makeTaskInput.parse(input));
}
