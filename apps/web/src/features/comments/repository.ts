import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import type { Comment, CommentCard, CommentThread, Mentionable } from "./types";

/** The only module in `comments` that touches Drizzle. */

/** The thread for a card, created on the first comment rather than ahead of time. */
export async function threadFor(card: CommentCard, actedBy: string): Promise<string> {
  const [existing] = await dbRo()
    .select({ id: s.cardCommentThread.id })
    .from(s.cardCommentThread)
    .where(eq(s.cardCommentThread.cardId, card))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db()
    .insert(s.cardCommentThread)
    .values({ cardId: card, createdBy: actedBy, updatedBy: actedBy })
    .onConflictDoUpdate({
      target: s.cardCommentThread.cardId,
      set: { updatedAt: new Date(), updatedBy: actedBy },
    })
    .returning({ id: s.cardCommentThread.id });
  return created.id;
}

/**
 * How many comments on each card this person has not read.
 *
 * "Unread" is a fact about a reader: their own comments never count, a thread they have
 * never opened counts everything anyone else wrote, and a comment edited to name them after
 * they last read the thread counts too. One query, so the badge costs one round trip
 * whatever the thread count is.
 */
export async function unreadByCard(personId: string): Promise<Record<string, number>> {
  const { rows } = await dbRo().execute<{ card: string; unread: number }>(sql`
    select t.card_id as "card",
           count(*) filter (
             where c.author_id <> ${personId}
               and c.deleted_at is null
               and (
                 r.last_read_at is null
                 or c.created_at > r.last_read_at
                 or exists (
                   select 1 from work.card_comment_mention m
                    where m.comment_id = c.id and m.person_id = ${personId} and m.created_at > r.last_read_at
                 )
               )
           )::int as "unread"
      from work.card_comment_thread t
      join work.card_comment c on c.thread_id = t.id
      left join work.card_comment_read r on r.thread_id = t.id and r.person_id = ${personId}
     group by t.card_id
  `);
  return Object.fromEntries(rows.filter((row) => row.unread > 0).map((row) => [row.card, row.unread]));
}

/** The comments of one card, oldest first, with everything the thread draws. */
export async function readThread(card: CommentCard, personId: string): Promise<CommentThread> {
  const [thread] = await dbRo()
    .select({ id: s.cardCommentThread.id, lastMessageAt: s.cardCommentThread.lastMessageAt })
    .from(s.cardCommentThread)
    .where(eq(s.cardCommentThread.cardId, card))
    .limit(1);
  if (!thread) return { card, comments: [], unread: false, unreadCount: 0, lastMessageAt: null };

  const rows = await dbRo()
    .select({
      id: s.cardComment.id,
      authorId: s.cardComment.authorId,
      bodyText: s.cardComment.bodyText,
      captureRef: s.cardComment.captureRef,
      createdAt: s.cardComment.createdAt,
      editedAt: s.cardComment.editedAt,
      deletedAt: s.cardComment.deletedAt,
      taskKey: s.workItem.key,
      taskStatus: s.workItem.status,
    })
    .from(s.cardComment)
    .leftJoin(s.workItem, eq(s.workItem.id, s.cardComment.workItemId))
    .where(eq(s.cardComment.threadId, thread.id))
    .orderBy(asc(s.cardComment.createdAt));

  const mentions =
    rows.length === 0
      ? []
      : await dbRo()
          .select({
            commentId: s.cardCommentMention.commentId,
            personId: s.cardCommentMention.personId,
            // Named this reader after they last read the thread: an edit, compared on the database's clock.
            newForReader: sql<boolean>`${outer(s.cardCommentMention.personId)} = ${personId} and ${outer(s.cardCommentMention.createdAt)} > coalesce(
              (select r.last_read_at from work.card_comment_read r where r.thread_id = ${thread.id} and r.person_id = ${personId}),
              '-infinity'::timestamptz)`,
          })
          .from(s.cardCommentMention)
          .where(
            inArray(
              s.cardCommentMention.commentId,
              rows.map((row) => row.id),
            ),
          );
  const named = new Map<string, string[]>();
  for (const mention of mentions) {
    named.set(mention.commentId, [...(named.get(mention.commentId) ?? []), mention.personId]);
  }

  const [read] = await dbRo()
    .select({ lastReadAt: s.cardCommentRead.lastReadAt })
    .from(s.cardCommentRead)
    .where(and(eq(s.cardCommentRead.threadId, thread.id), eq(s.cardCommentRead.personId, personId)))
    .limit(1);
  const since = read?.lastReadAt ?? null;
  const namedSinceRead = new Set(mentions.filter((mention) => mention.newForReader).map((mention) => mention.commentId));
  const unreadCount = rows.filter(
    (row) =>
      row.authorId !== personId &&
      row.deletedAt === null &&
      (since === null || row.createdAt > since || namedSinceRead.has(row.id)),
  ).length;

  const comments: Comment[] = rows.map((row) => ({
    id: row.id,
    authorId: row.authorId,
    // A deleted comment keeps its row so the conversation still reads in order, but its
    // words do not leave the database: the placeholder is drawn from `deletedAt` alone.
    bodyText: row.deletedAt ? "" : row.bodyText,
    captureUrl: row.deletedAt || !row.captureRef ? null : `/api/comments/capture?comment=${encodeURIComponent(row.id)}`,
    at: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    mentions: named.get(row.id) ?? [],
    task: row.taskKey && row.taskStatus ? { key: row.taskKey, status: row.taskStatus } : null,
  }));

  return {
    card,
    comments,
    unread: unreadCount > 0,
    unreadCount,
    lastMessageAt: thread.lastMessageAt.toISOString(),
  };
}

/** The threads that have anything in them, newest activity first. */
export async function activeCards(): Promise<CommentCard[]> {
  const rows = await dbRo()
    .select({ card: s.cardCommentThread.cardId })
    .from(s.cardCommentThread)
    .where(sql`exists (select 1 from work.card_comment c where c.thread_id = ${outer(s.cardCommentThread.id)})`)
    .orderBy(desc(s.cardCommentThread.lastMessageAt));
  return rows.map((row) => row.card as CommentCard);
}

/**
 * Inserts a comment with its mentions in one transaction, moves the thread's last message time,
 * and marks the thread read for the author. Returns the new comment's id.
 */
export async function insertComment(
  threadId: string,
  authorId: string,
  bodyText: string,
  captureRef: string | null,
  mentioned: string[],
): Promise<string> {
  return db().transaction(async (tx) => {
    const [comment] = await tx
      .insert(s.cardComment)
      .values({ threadId, authorId, bodyText, captureRef, createdBy: authorId, updatedBy: authorId })
      .returning({ id: s.cardComment.id });
    if (mentioned.length > 0) {
      await tx
        .insert(s.cardCommentMention)
        .values(
          mentioned.map((personId) => ({ commentId: comment.id, personId, createdBy: authorId, updatedBy: authorId })),
        )
        .onConflictDoNothing();
    }
    await tx
      .update(s.cardCommentThread)
      .set({ lastMessageAt: new Date(), updatedAt: new Date(), updatedBy: authorId })
      .where(eq(s.cardCommentThread.id, threadId));
    // Writing is reading: the author is never shown their own comment as unread.
    await tx
      .insert(s.cardCommentRead)
      .values({ threadId, personId: authorId, lastReadAt: sql`now()` })
      .onConflictDoUpdate({
        target: [s.cardCommentRead.threadId, s.cardCommentRead.personId],
        set: { lastReadAt: sql`now()` },
      });
    return comment.id;
  });
}

/** One comment with what deciding about it needs: who wrote it, and whether it still is. */
export async function readComment(commentId: string) {
  const [row] = await dbRo()
    .select({
      id: s.cardComment.id,
      threadId: s.cardComment.threadId,
      card: s.cardCommentThread.cardId,
      authorId: s.cardComment.authorId,
      bodyText: s.cardComment.bodyText,
      captureRef: s.cardComment.captureRef,
      deletedAt: s.cardComment.deletedAt,
      workItemId: s.cardComment.workItemId,
    })
    .from(s.cardComment)
    .innerJoin(s.cardCommentThread, eq(s.cardCommentThread.id, s.cardComment.threadId))
    .where(eq(s.cardComment.id, commentId))
    .limit(1);
  return row ?? null;
}

/**
 * Replaces the text and whom it names: a person no longer named loses their mention, a person
 * still named keeps theirs, and a person named for the first time gets one. Returns the people
 * named for the first time, or null when the comment was gone.
 */
export async function updateComment(
  commentId: string,
  authorId: string,
  bodyText: string,
  mentioned: string[],
): Promise<string[] | null> {
  return db().transaction(async (tx) => {
    const changed = await tx
      .update(s.cardComment)
      .set({ bodyText, editedAt: new Date(), updatedAt: new Date(), updatedBy: authorId })
      .where(and(eq(s.cardComment.id, commentId), eq(s.cardComment.authorId, authorId), isNull(s.cardComment.deletedAt)))
      .returning({ id: s.cardComment.id });
    if (changed.length === 0) return null;
    const before = await tx
      .select({ personId: s.cardCommentMention.personId })
      .from(s.cardCommentMention)
      .where(eq(s.cardCommentMention.commentId, commentId));
    const kept = new Set(before.map((row) => row.personId));
    const removed = [...kept].filter((personId) => !mentioned.includes(personId));
    const added = mentioned.filter((personId) => !kept.has(personId));
    if (removed.length > 0) {
      await tx
        .delete(s.cardCommentMention)
        .where(and(eq(s.cardCommentMention.commentId, commentId), inArray(s.cardCommentMention.personId, removed)));
    }
    if (added.length > 0) {
      await tx
        .insert(s.cardCommentMention)
        .values(added.map((personId) => ({ commentId, personId, createdBy: authorId, updatedBy: authorId })))
        .onConflictDoNothing();
    }
    return added;
  });
}

/** Clears the words and marks the row deleted; the placeholder is what stays. */
export async function softDeleteComment(commentId: string, authorId: string): Promise<boolean> {
  const rows = await db()
    .update(s.cardComment)
    .set({ bodyText: "", captureRef: null, deletedAt: new Date(), updatedAt: new Date(), updatedBy: authorId })
    .where(and(eq(s.cardComment.id, commentId), eq(s.cardComment.authorId, authorId), isNull(s.cardComment.deletedAt)))
    .returning({ id: s.cardComment.id });
  return rows.length > 0;
}

/** A file attached to a work item: a comment's capture copied onto the task raised from it. */
export async function insertWorkItemAttachment(input: {
  workItemId: string;
  fileName: string;
  contentRef: string;
  size: number;
  mimeType: string;
  uploadedBy: string;
}): Promise<void> {
  await db().insert(s.attachment).values({
    ownerType: "WorkItem",
    ownerId: input.workItemId,
    fileName: input.fileName,
    contentRef: input.contentRef,
    size: input.size,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
    createdBy: input.uploadedBy,
    updatedBy: input.uploadedBy,
  });
}

/** Records the work item raised from a comment on that comment. */
export async function linkWorkItem(commentId: string, workItemId: string, actedBy: string): Promise<void> {
  await db()
    .update(s.cardComment)
    .set({ workItemId, updatedAt: new Date(), updatedBy: actedBy })
    .where(eq(s.cardComment.id, commentId));
}

/** The comment a work item was raised from, for the message posted back when it is done. */
export async function commentForWorkItem(workItemId: string) {
  const [row] = await dbRo()
    .select({ id: s.cardComment.id, threadId: s.cardComment.threadId, card: s.cardCommentThread.cardId })
    .from(s.cardComment)
    .innerJoin(s.cardCommentThread, eq(s.cardCommentThread.id, s.cardComment.threadId))
    .where(eq(s.cardComment.workItemId, workItemId))
    .limit(1);
  return row ?? null;
}

/** Sets the person's read marker on the card's thread to now; does nothing when the card has no thread. */
export async function markRead(card: CommentCard, personId: string): Promise<void> {
  const [thread] = await dbRo()
    .select({ id: s.cardCommentThread.id })
    .from(s.cardCommentThread)
    .where(eq(s.cardCommentThread.cardId, card))
    .limit(1);
  if (!thread) return;
  await db()
    .insert(s.cardCommentRead)
    // The database's clock, which stamped the comments it is compared with.
    .values({ threadId: thread.id, personId, lastReadAt: sql`now()` })
    .onConflictDoUpdate({
      target: [s.cardCommentRead.threadId, s.cardCommentRead.personId],
      set: { lastReadAt: sql`now()` },
    });
}

/** Everyone a comment may name: the people of the organisation, the asker excluded. */
export async function mentionable(exceptPersonId: string): Promise<Mentionable[]> {
  const rows = await dbRo()
    .select({
      id: s.person.id,
      name: s.person.nameEn,
      nameAr: s.person.nameAr,
      ini: s.person.initials,
      role: s.role.nameEn,
      roleAr: s.role.nameAr,
    })
    .from(s.person)
    .leftJoin(s.roleAssignment, eq(s.roleAssignment.personId, s.person.id))
    .leftJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .where(and(eq(s.person.status, "Active"), sql`${s.person.id} <> ${exceptPersonId}`))
    .orderBy(asc(s.person.nameEn));
  // One row per role assignment, so the first of each person is the one kept.
  const seen = new Map<string, Mentionable>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.set(row.id, { ...row, role: row.role ?? "Member", roleAr: row.roleAr ?? "عضو" });
  }
  return [...seen.values()];
}

/** The id of the project with this key, or null when there is none. */
export async function projectIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, key)).limit(1);
  return row?.id ?? null;
}

/** The person ids that are real, active people — what a mention list is filtered to. */
export async function activePeople(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await dbRo()
    .select({ id: s.person.id })
    .from(s.person)
    .where(and(inArray(s.person.id, ids), eq(s.person.status, "Active")));
  return rows.map((row) => row.id);
}

/** The ids behind work-item keys, for the comment the task was raised from. */
export async function workItemIdsByKey(keys: string[]): Promise<{ key: string; id: string }[]> {
  if (keys.length === 0) return [];
  return dbRo()
    .select({ key: s.workItem.key, id: s.workItem.id })
    .from(s.workItem)
    .where(inArray(s.workItem.key, keys));
}
