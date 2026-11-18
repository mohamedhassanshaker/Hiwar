/** Comment threads on the dashboard cards (handoff v2 section 5). */

/** The cards a thread can hang on, in the order the Inbox lists them. */
export const COMMENT_CARDS = ["runs", "tasks", "attention", "live"] as const;
export type CommentCard = (typeof COMMENT_CARDS)[number];

/**
 * What each of those cards is called, in both languages.
 *
 * A thread is named by the card it is about wherever it is shown — the popover's header,
 * the Inbox row, the reply toast, the work item it raised — so the words live here rather
 * than in whichever of them was written first.
 */
export const CARD_LABEL: Record<string, [string, string]> = {
  runs: ["Agent runs", "عمليات الوكلاء"],
  tasks: ["Tasks finished", "المهام المنجزة"],
  attention: ["Needs attention", "يحتاج إلى متابعة"],
  live: ["Runs in progress", "عمليات قيد التشغيل"],
};

/** Someone a comment can name. The composer's `@` list and the "will notify" chips. */
export type Mentionable = { id: string; name: string; nameAr: string; ini: string; role: string; roleAr: string };

/** One comment as the thread draws it. */
export type Comment = {
  id: string;
  authorId: string;
  bodyText: string;
  /** Where to fetch the captured area of the card, or `null` when there is none. */
  captureUrl: string | null;
  /** ISO-8601 throughout, so the browser formats in the reader's own language. */
  at: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Whom the comment named, so the thread can mark them without re-reading the text. */
  mentions: string[];
  /** The work item "Make it a task" raised from this comment, while it exists. */
  task: { key: string; status: string } | null;
};

/** One card's conversation. */
export type CommentThread = {
  card: CommentCard;
  comments: Comment[];
  /** Whether somebody else has written since this person last read it. */
  unread: boolean;
  /** How many of those there are, which is the "N new" the Inbox shows. */
  unreadCount: number;
  lastMessageAt: string | null;
};
