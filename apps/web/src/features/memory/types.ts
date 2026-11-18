/** Memory scopes and their entries (S-55). */

/** A branch of the memory explorer: a scope with the memories under it. */
export type MemoryGroup = {
  id: string;
  n: [string, string];
  /** The icon the explorer draws, for a scope that is not an agent. */
  ic?: string;
  /** The agent whose memory this is, when the scope is an agent. */
  agent?: string;
  /** D68: this scope is private to the reader — this agent's memory of them. */
  mine: boolean;
  /** The id of each memory is its full path, which is what every action names it by. */
  kids: { id: string; n: [string, string] }[];
};

/** One entry inside a memory version: a heading, a body and where it came from. */
export type MemoryItem = { heading: string; body: string; source: string };

export type MemoryEntry = {
  /** The memory's full path. Two people's private memory share a slug but never a path. */
  id: string;
  /** D68: this memory sits in a scope private to the reader, so it is theirs to clear. */
  mine: boolean;
  title: [string, string];
  /** The scope the memory hangs off, as the detail header writes it. */
  scopeLabel: [string, string];
  /** How the path reads on screen, which `access_json` may override. Display only — every action names `id`. */
  path: [string, string];
  /** Organisation, BusinessUnit, Agent or Session. */
  scope: string;
  /** Active, PendingReview, NeedsAttention, Rejected or Archived. */
  st: string;
  /** The content version the screen shows. */
  v: number;
  /** The row's lock, which a save sends back (D59). A review moves it as well as a save. */
  version: number;
  owner: [string, string];
  /** When it was last reviewed, ISO-8601. */
  reviewedAt: string | null;
  reviewDueAt: string | null;
  access: [string, string];
  requiresReview: boolean;
  /** `true` when the review is past its due date, decided against the database clock. */
  reviewOverdue: boolean;
  /** Who proposed the newest version: `Person` or `Agent`, and their id. */
  proposedByType: string | null;
  proposedById: string | null;
  /** `UC-55.2-04`: whether the reader may decide this one, rather than only write memories. */
  mayReview: boolean;
  items: MemoryItem[];
};

export type MemoryVersion = { v: number; at: string; by: string; note: string };

export type MemoryCounts = { total: number; pendingReview: number; agents: number; needsAttention: number; mine: number };
