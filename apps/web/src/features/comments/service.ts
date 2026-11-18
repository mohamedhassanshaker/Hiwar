import { insertWorkItem } from "@/db/queries/work-items";
import { audit } from "@/lib/audit";
import { notifyDashboard, notifyInbox } from "@/lib/live";
import { buckets, getObject, objectStoreConfigured, putObject } from "@/lib/objects";
import { Rejected } from "@/lib/rejection";
import { can, requireProjectPermission, requireSession } from "@/lib/session";
import * as repository from "./repository";
import type { CardInput, EditCommentInput, MakeTaskInput, PostCommentInput } from "./schema";
import type { CommentThread, Mentionable } from "./types";

/**
 * Comment threads on the dashboard cards (handoff v2 section 5).
 *
 * Anyone who can open the dashboard can write on a card they can see; there is no separate
 * permission, because the thread carries no data beyond what the card already shows. The
 * two places that do touch the rest of the platform are gated on the permission that owns
 * them: raising a task needs `work_items:write`, and a comment can only ever name a real,
 * active person — the list of who may be mentioned comes from the server, and what the
 * browser sends back is intersected with it rather than trusted.
 */

export class CommentRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "CommentRejected";
  }
}

/** One card's thread, with the caller's unread state; an empty thread when nobody has written. */
export async function loadThread(input: CardInput): Promise<CommentThread> {
  const session = await requireSession();
  return repository.readThread(input.card, session.personId);
}

/** The unread count per card, which the comment buttons and the Inbox both read. */
export async function unreadByCard(): Promise<Record<string, number>> {
  const session = await requireSession();
  return repository.unreadByCard(session.personId);
}

/** Every thread that has anything in it, with this person's unread state on each. */
export async function loadThreads(): Promise<CommentThread[]> {
  const session = await requireSession();
  const cards = await repository.activeCards();
  return Promise.all(cards.map((card) => repository.readThread(card, session.personId)));
}

/** The active people the caller may name in a comment, the caller excluded. */
export async function mentionable(): Promise<Mentionable[]> {
  const session = await requireSession();
  return repository.mentionable(session.personId);
}

/** Marks the card's thread read for the caller; a card with no thread is left alone. */
export async function markRead(input: CardInput): Promise<void> {
  const session = await requireSession();
  await repository.markRead(input.card, session.personId);
}

/** The bytes behind one comment's capture, or `null` when there are none to show. */
export async function readCapture(commentId: string): Promise<{ ref: string } | null> {
  await requireSession();
  const comment = await repository.readComment(commentId);
  if (!comment || comment.deletedAt !== null || !comment.captureRef) return null;
  return { ref: comment.captureRef };
}

/**
 * Posts a comment on a card and returns its id.
 *
 * Refused when there is neither text nor a capture, and when a capture is sent on an
 * installation with no object store. Mentions are filtered to active people other than the
 * author. A capture is stored as a JPEG in the attachments bucket. The thread is created on the
 * first comment. Audited as `comments:write`; the dashboard and every mentioned person's Inbox
 * are notified.
 */
export async function postComment(input: PostCommentInput): Promise<string> {
  const session = await requireSession();
  if (input.body.length === 0 && !input.capture) {
    throw new CommentRejected("Write something, or attach a capture.", "اكتب شيئاً أو أرفق لقطة.");
  }

  // Only people who exist and are still active are notified, whatever the browser sent.
  const mentioned = await repository.activePeople(input.mentions.filter((id) => id !== session.personId));

  let captureRef: string | null = null;
  if (input.capture) {
    if (!objectStoreConfigured()) {
      throw new CommentRejected(
        "Captures are not available on this installation.",
        "التقاط المناطق غير متاح في هذا التثبيت.",
      );
    }
    const bytes = Buffer.from(input.capture.slice(input.capture.indexOf(",") + 1), "base64");
    captureRef = await putObject(
      buckets.attachments,
      `card-comments/${input.card}/${crypto.randomUUID()}.jpg`,
      bytes,
      "image/jpeg",
    );
  }

  const threadId = await repository.threadFor(input.card, session.personId);
  const commentId = await repository.insertComment(threadId, session.personId, input.body, captureRef, mentioned);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "comments:write",
    objectType: "CardComment",
    objectId: commentId,
    objectLabel: input.card,
    detail: { mentions: mentioned.length, capture: captureRef !== null },
  });
  // Everyone named is told; so is the dashboard, so the comment buttons pick up the dot.
  await Promise.all([notifyDashboard("comment"), ...mentioned.map((personId) => notifyInbox(personId, "comment"))]);
  return commentId;
}

/**
 * Replaces the text and mentions of the caller's own comment, re-filtering mentions to active
 * people. Refused when the comment is not the caller's or has been deleted. Audited as
 * `comments:write`; the dashboard and the Inbox of each person named for the first time are
 * notified.
 */
export async function editComment(input: EditCommentInput): Promise<void> {
  const session = await requireSession();
  const mentioned = await repository.activePeople(input.mentions.filter((id) => id !== session.personId));
  const added = await repository.updateComment(input.commentId, session.personId, input.body, mentioned);
  // The `where` already carries the author, so a failure here is "not yours, or gone".
  if (!added) throw new CommentRejected("That comment is no longer yours to edit.", "لم يعد هذا التعليق قابلاً للتعديل.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "comments:write",
    objectType: "CardComment",
    objectId: input.commentId,
  });
  await Promise.all([notifyDashboard("comment"), ...added.map((personId) => notifyInbox(personId, "comment"))]);
}

/**
 * Soft-deletes the caller's own comment: its text and capture are cleared and the row stays as a
 * placeholder. Refused when the comment is not the caller's or is already deleted. Audited as
 * `comments:delete` and the dashboard is notified.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const session = await requireSession();
  const removed = await repository.softDeleteComment(commentId, session.personId);
  if (!removed) throw new CommentRejected("That comment is no longer yours to delete.", "لم يعد هذا التعليق قابلاً للحذف.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "comments:delete",
    objectType: "CardComment",
    objectId: commentId,
  });
  await notifyDashboard("comment");
}

/**
 * `Make it a task` (handoff v2 section 5.2): a work item raised from one comment.
 *
 * The item is marked as coming from a comment and keeps the comment's id, so the drawer
 * can show the conversation it came out of and the thread can show what became of it.
 * The comment's capture is copied onto the item as an attachment, so it outlives the comment
 * (D229); a capture that cannot be read refuses the task. Creating it needs the same
 * permission any other work item does.
 */
export async function makeTask(input: MakeTaskInput): Promise<string> {
  const projectId = await repository.projectIdByKey(input.projectKey);
  if (!projectId) throw new CommentRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  // D328: a work item is written only in a project the person may write in.
  const session = await requireProjectPermission("work_items:write", projectId);

  const comment = await repository.readComment(input.commentId);
  if (!comment || comment.deletedAt !== null) {
    throw new CommentRejected("That comment no longer exists.", "لم يعد هذا التعليق موجوداً.");
  }
  if (comment.workItemId) {
    throw new CommentRejected("A task was already raised from this comment.", "سبق إنشاء مهمة من هذا التعليق.");
  }

  const assignee = input.assignee ? (await repository.activePeople([input.assignee]))[0] : undefined;
  if (input.assignee && !assignee) {
    throw new CommentRejected("That assignee no longer exists.", "لم يعد هذا المسند إليه موجوداً.");
  }

  let capture: Uint8Array | null = null;
  if (comment.captureRef) {
    const object = objectStoreConfigured() ? await getObject(comment.captureRef) : null;
    if (!object) throw new CommentRejected("The comment's capture could not be read.", "تعذّرت قراءة لقطة التعليق.");
    capture = new Uint8Array(await new Response(object.body).arrayBuffer());
  }

  const key = await insertWorkItem({
    projectKey: input.projectKey,
    type: "Task",
    titleEn: input.title,
    titleAr: input.title,
    descriptionEn: comment.bodyText || null,
    assignee: assignee ? { type: "Person", id: assignee } : null,
    reviewerId: null,
    priority: input.priority,
    // Midday UTC, the same convention the work-item form uses, so a due date does not
    // move a day when it is read back in another time zone.
    dueAt: input.dueAt ? new Date(`${input.dueAt}T12:00:00Z`) : null,
    parentKey: null,
    status: assignee ? "ToDo" : "Backlog",
    attributes: {},
    createdBy: session.personId,
    origin: {
      type: "Comment",
      id: comment.id,
      detailEn: `created from a comment on ${comment.card}`,
      detailAr: `أُنشئ من تعليق على ${comment.card}`,
    },
  });

  const [raised] = await repository.workItemIdsByKey([key]);
  if (raised) {
    await repository.linkWorkItem(comment.id, raised.id, session.personId);
    if (capture) {
      const fileName = "comment-capture.jpg";
      const contentRef = await putObject(buckets.attachments, `${key}/${fileName}`, capture, "image/jpeg");
      await repository.insertWorkItemAttachment({
        workItemId: raised.id,
        fileName,
        contentRef,
        size: capture.byteLength,
        mimeType: "image/jpeg",
        uploadedBy: session.personId,
      });
    }
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "work_items:write",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { fromComment: comment.id, card: comment.card },
  });
  await Promise.all([
    notifyDashboard("work-item"),
    ...(assignee && assignee !== session.personId ? [notifyInbox(assignee, "work-item")] : []),
  ]);
  return key;
}

/**
 * `UC` of handoff v2 section 5.2's last line: marking the task done says so in the thread
 * it came from. Called by the work-item service after the status change is recorded, so a
 * refused move never produces a message about one.
 */
export async function noteTaskDone(workItemId: string, key: string, title: string, actedBy: string): Promise<void> {
  const comment = await repository.commentForWorkItem(workItemId);
  if (!comment) return;
  await repository.insertComment(comment.threadId, actedBy, `Marked task ${key} as done: ${title}`, null, []);
  await notifyDashboard("comment");
}

/** Whether this person may raise a task from a comment, which decides if the offer shows. */
export async function mayRaiseTasks(): Promise<boolean> {
  return can("work_items:write");
}
