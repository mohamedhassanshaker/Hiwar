/** Agents, their runs and run steps (S-50 to S-52). */

import type { NotApplied } from "@/lib/skill-package";

/** One earlier turn in the room, widget or work item a run continues — the harness's own
 * `ConversationMessage`, compacted automatically once it grows past the model's budget. */
export type ConversationTurn = { role: "user" | "assistant" | "system"; author?: string; text: string };

export type Run = {
  id: string;
  /** `ai.run.status`: Queued, Running, Waiting, Succeeded, Failed, Cancelled, BudgetExceeded. */
  st: string;
  /**
   * What a `Waiting` run is blocked on, or `null` when it is not waiting. `Unknown` is a
   * run marked waiting with neither a pending approval nor an unanswered question behind
   * it — said as it is rather than reported as an approval nobody can find.
   */
  waitingOn: "Approval" | "Question" | "Unknown" | null;
  /** The room the run belongs to, where a decision on it is taken. */
  roomKey: string | null;
  /** The work item the run belongs to, for the same reason. */
  workItemKey: string | null;
  goal: string;
  goalAr: string;
  /** When the run started, ISO-8601. */
  at: string;
  /** How long it ran, in milliseconds; null while it is still going. */
  durationMs: number | null;
  cost: number;
  /** The work item or room the run belongs to. */
  by: string;
  agent: string;
  /** When the run ended, ISO-8601; null while it is still going. */
  endedAt: string | null;
  /** `ai.run.context_type`: Room, WorkItem, Request, Deployment, Setup or Console. */
  contextType: string;
  /** The work item, room or request the run is about, by key; null for any other context. */
  contextKey: string | null;
  /** The run that delegated this one (D46), by key. */
  parentRunKey: string | null;
};

export type RunStep = {
  seq: number;
  /** `ai.run_step.type`: Start, Model, Tool, Skill, Approval, Question, Verify, Handoff. */
  k: string;
  t: string;
  d: string;
  ms: number | null;
  cost: number;
  hooks: string[];
  status: string;
};

/** One slice of the context the harness assembled, in the fixed order of specification 5.3. */
export type ContextSlice = { en: string; ar: string; share: number; colour: string };

export type RunDetail = {
  run: Run;
  /** `ai.run.id`, the AG-UI stream's own key (`run.id` above is the display key, `RUN-…`) —
   * carried only so the viewer can subscribe to `/api/sse/runs/{runId}`. */
  runId: string;
  steps: RunStep[];
  context: ContextSlice[];
  tokensIn: number;
  tokensOut: number;
  cacheHitPct: number | null;
  toolCallCount: number;
  waitingSeconds: number;
  budgetSoft: number | null;
  budgetHard: number | null;
  approvalsWaiting: number;
  /** `UC-52.1-07`: the Phoenix trace of this run, when one was recorded. */
  traceId: string | null;
  /** `UC-52.1-06`: the run this one replays, when it is a replay. */
  replayOfRunKey: string | null;
};

export type AgentVersionRow = { v: string; publishedAt: string | null; by: string; evalScore: number | null; isActive: boolean };

export type AgentDetail = {
  code: string;
  /** `UC-50.2-05`: why the agent is in error, from its last failed step. */
  lastFailure: string | null;
  profile: string;
  model: string;
  fallbackModel: string | null;
  reportsTo: string | null;
  trust: string;
  /** The active version's lock, sent back with a change to trust or to the run budget. */
  versionLock: number;
  memoryEnabled: boolean;
  budgetSoft: number | null;
  budgetHard: number | null;
  instructions: string;
  /** The unpublished revision the configuration tabs show and edit, e.g. `v2`; null when
   * there is none and they show the active version. */
  draft: string | null;
  skills: {
    id: string;
    name: string;
    enabled: boolean;
    /** Why this pinned version does not reach a run, which the skills tab says; null when it does. */
    notApplied: NotApplied | null;
    /** `UC-51.2-05`: connectors the skill needs that this agent holds no tool of. */
    missingConnectors: string[];
  }[];
  tools: { id: string; ref: string; tier: string; mode: string }[];
  /** `UC-51.2-02`: published skills not attached yet, which the Add skill picker offers. */
  skillShelf: { id: string; name: string; versionLabel: string; missingConnectors: string[] }[];
  /** Connector tools of enabled connectors this agent is not granted yet, for the Add picker. */
  toolShelf: { id: string; ref: string; tier: string }[];
  knowledge: { id: string; name: string; status: string; granted: boolean }[];
  /** `UC-55.1`: the memory scopes this version may read, or read and write. */
  memory: { id: string; kind: string; name: string; granted: boolean; writable: boolean }[];
  versions: AgentVersionRow[];
  stats: { runs: number; successRatePct: number; cost: number; evalScore: number | null };
};

