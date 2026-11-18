/** The inbox (S-12). */

export type InboxItem = {
  /** The inbox row id, which the detail pane selects on. */
  id: string;
  /** approval, question, mention, sla, review or update. */
  kind: string;
  risk: string | null;
  /** Who raised it: an agent code or a person id. */
  from: string;
  t: string;
  tAr: string;
  at: string;
  /** The tool an approval would call, and its redacted arguments. */
  tool: string | null;
  args: string | null;
  evidence: string[];
  runKey: string | null;
  workItemKey: string | null;
  /** How the approval is routed: Single, AnyOf or Sequential, with the approvers. */
  policy: string | null;
  resolved: boolean;
  /** `UC-12.3-02`: the room a mention is in, to open it at the message. */
  roomKey: string | null;
  /** `UC-12.2-03`: the answers the agent will accept, when it offered a choice. */
  options: string[];
  /**
   * Why no decision can be taken, or null when one can.
   *
   * `UC-12.1-08` expired, `UC-12.1-09` the run was cancelled, `UC-12.1-10` it is your own
   * request. The server refuses all three; this is what the pane says instead of offering
   * a button that will fail.
   */
  blocked: string | null;
  blockedAr: string | null;
  /** D393: a person's registration waiting for approval, which opens People on its Pending filter. */
  registration: boolean;
  /** D394: where an Update leads (the request or work item it reports), or null for any other kind. */
  link: string | null;
};

/** How many open items there are of each kind, and how many are resolved. */
export type InboxCounts = { open: Record<string, number>; resolved: number };

/**
 * What the shell's badge and peek show (handoff v2 sections 1.2 and 1.5): the counts, the two
 * most recent urgent items, and the ten most recent open ones.
 */
export type InboxSummary = { counts: InboxCounts; urgent: InboxItem[]; latest: InboxItem[] };
