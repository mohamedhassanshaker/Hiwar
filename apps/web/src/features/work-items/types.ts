import type { ScreenId } from "@/lib/routes";

/** Work items and their detail view (S-24, S-25). */

export type Task = {
  k: string;
  p: string;
  t: string;
  tAr: string;
  /** `work.work_item.type`: Task, SubItem or Bug. */
  type: string;
  /** `work.work_item.status`: Backlog, ToDo, InProgress, InReview, Blocked, Done, Cancelled. */
  st: string;
  who: string | null;
  pri: string;
  dueAt: string | null;
  sub: number;
  done: number;
  /** `COM-10`: the version the board read, so a move names what it saw. */
  version: number;
  /**
   * Specification section 7.4: "hot" work is open work that is high priority, blocked, or
   * due within two days. The rule is evaluated against the database clock.
   */
  hot: boolean;
  /** Handoff v2 section 7: raised from a comment on a dashboard card. */
  fromComment: boolean;
};

/** `[key, english, arabic, assignee, done?]` */
export type SubItem = [string, string, string, string, number?];

export type WorkItemDetail = {
  /** The request type the item was raised under, if any. */
  rt: [string, string];
  /** Where the item came from, and the screen that shows it. */
  org: [string, ScreenId] | null;
  rev: string;
  sch: string;
  /** The description the item was written with, or null when it has none. */
  desc: string | null;
  parent?: string;
  at: [string, string][];
  subs: SubItem[];
  act: [string, string, string][];
  /** Name, size, and whether it is a file attached to the item or an artifact linked to it, which are read from different places. */
  attachments: [string, string, "attachment" | "artifact"][];
  /**
   * The comment this item was raised from (handoff v2 section 7), when it was: what was
   * said, the picture that was pointed at, and which card the conversation is on.
   */
  comment: { card: string; text: string; captureUrl: string | null } | null;
};

/** The board columns, in order (S-24). */
export const COLUMNS: [token: string, en: string, ar: string][] = [
  ["Backlog", "Backlog", "قائمة الانتظار"],
  ["ToDo", "To do", "للتنفيذ"],
  ["InProgress", "In progress", "قيد التنفيذ"],
  ["InReview", "In review", "قيد المراجعة"],
  ["Blocked", "Blocked", "معطّل"],
  ["Done", "Done", "منجز"],
];

/** `UC-24.2-02`: a name for one set of advanced-search criteria. */
export type SavedView = { name: string; filter: Record<string, unknown> };

/** The work item screen's scopes (S-24): hot items, items raised from comments, or all of them. */
export type WorkItemScope = "hot" | "comments" | "all";

/** The work item list's filters (S-24), each optional; `key` names one item. */
export type WorkItemFilters = {
  key?: string;
  scope?: WorkItemScope;
  q?: string;
  projectKey?: string;
  type?: string;
  status?: string;
  priority?: string;
  /** `none` for unassigned, a person's id, or an agent's code. */
  assignee?: string;
  /** Only items still open: not Done or Cancelled. */
  open?: boolean;
  dueFrom?: Date;
  dueBefore?: Date;
};

/** D388: what a work item's report adds to its card and drawer. People are ids, agents codes. */
export type WorkItemReportFacts = {
  descriptionAr: string | null;
  projectEn: string;
  projectAr: string;
  requestKey: string | null;
  reviewer: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  blockedEn: string | null;
  blockedAr: string | null;
  /** Oldest first, with when each happened. */
  history: { at: string; who: string; detailEn: string; detailAr: string }[];
  /** The items below this one at every depth, parents before children. */
  subItems: { key: string; parentKey: string; titleEn: string; titleAr: string; status: string; priority: string; assignee: string; dueAt: string | null }[];
};

/** D388: the Work items report's filters: the list's, and what the list has no control for. */
export type WorkItemInquiry = WorkItemFilters & {
  /** A person's id or an agent's code. */
  reviewer?: string;
  requestKey?: string;
  createdFrom?: Date;
  createdBefore?: Date;
  /** Past its due date and not finished. */
  overdue?: boolean;
  /** `top` for items with no parent, `sub` for sub-items; both when absent. */
  level?: "top" | "sub";
};

/** D388: one work item a Work items report lists. People are ids, agents codes. */
export type WorkItemInquiryRow = {
  key: string;
  parentKey: string | null;
  titleEn: string;
  titleAr: string;
  projectKey: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  reviewer: string;
  requestKey: string | null;
  dueAt: string | null;
  createdAt: string;
};
