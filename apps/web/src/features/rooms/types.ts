/** Discussion rooms (S-22, S-23). */

import type { Action } from "@/features/assistant/components/assistant-activity";

export type Session = {
  key: string;
  /** `COM-10`: what a moderation change is written against, so a stale one is refused. */
  version: number;
  p: string;
  t: string;
  tAr: string;
  type: string;
  src: string;
  st: string;
  who: string[];
  msgs: number;
  /** When the room last saw a message, ISO-8601. The list shows it as "2m ago". */
  lastActivityAt: string;
  cost: number;
  kind: string;
};

/** The counters above the Discussion Rooms list. */
export type RoomCounts = {
  total: number;
  active: number;
  archived: number;
  messages: number;
};

/** One message in a room, as the room screen draws it (S-23). */
export type RoomMessage = {
  id: string;
  seq: number;
  sender: string;
  at: string;
  en: string;
  ar: string;
  artifact: { name: string; noteEn: string; noteAr: string } | null;
  /** A file a person attached, wrapped as a normal entry in the thread rather than only in
   * the room's Files panel. */
  attachment: { name: string } | null;
  approval: RoomApproval | null;
  /** `UC-12.2-01`: the question a run in this room waits on, answered here or in the Inbox. */
  question: RoomQuestion | null;
  agentMeta: { version: string; runKey: string | null } | null;
  /** D352: the tool calls the agent's run made for this reply, in order; empty for any other message. */
  steps: Action[];
};

/** The question card an agent posts into a room when its run asks the person it acts for. */
export type RoomQuestion = {
  id: string;
  question: string;
  /** `UC-12.2-03`: the answers the agent will accept, when it offers a choice. */
  options: string[];
  answer: string | null;
  answeredBy: string | null;
  /** Who it was asked of: the person the run acts for. */
  askedTo: string | null;
  /** Whether this person is the one it was asked of, and it is still open on a live run. */
  mayAnswer: boolean;
};

/** The approval card an agent posts into a room when a T2 tool call pauses its run. */
export type RoomApproval = {
  key: string;
  action: string;
  risk: string;
  changesEn: string;
  changesAr: string;
  approvers: string;
  status: string;
  /**
   * `UC-23.2-05`: the inbox item this person would decide it through, so a decision taken
   * here and one taken in the Inbox are the same act on the same row.
   */
  inboxItemId: string | null;
  /**
   * D19: the person who started the mission, and the only one this card offers a decision
   * to. Every other member reads "awaiting approval" from them.
   */
  requester: string | null;
  /** `UC-23.2-04`: whether this person is the one who decides it. */
  mayDecide: boolean;
};

/** How many of a room's latest messages its screen reads at a time, and the most it reads at once. */
export const ROOM_MESSAGE_WINDOW = 200;
export const ROOM_MESSAGE_MAX = 2000;

/** Everything S-23 needs for one room. */
export type RoomDetail = {
  room: Session;
  /** The room's own row id, which the live channel is named after. */
  roomId: string;
  projectNameEn: string;
  projectNameAr: string;
  /** `runId` is the run still working for an agent in this room, which its reply streams from. */
  participants: { id: string; role: string; isAgent: boolean; working: boolean; runId: string | null }[];
  turnTaking: string;
  messages: RoomMessage[];
  /** `UC-12.2-01`: open questions of runs in this room that no message announces, answered here as well. */
  waitingQuestions: RoomQuestion[];
  /** Whether the room has messages before the first one in `messages`. */
  earlier: boolean;
  linkedWorkItems: { key: string; titleEn: string; titleAr: string }[];
  /** `UC-23.1-07`: the room's board — what was uploaded to it and what an agent generated and
   * saved against it, newest first. */
  files: RoomFile[];
  /** How much of its model's context window the lead agent's last reply took; null with no lead agent. */
  contextUsage: RoomContextUsage | null;
};

/**
 * The lead agent's context window, and what its last finished reply in the room read from it.
 *
 * `window` is the smallest window recorded on the route's chain, because any step of it may be
 * the one that answers; null when none is recorded. `lastTokensIn` is every input token of the
 * last run that read any, across all its model calls; null before one has.
 */
export type RoomContextUsage = {
  agent: string;
  route: string | null;
  window: number | null;
  lastTokensIn: number | null;
};

/** One entry on a room's files board (S-23). */
export type RoomFile = {
  name: string;
  kind: "attachment" | "artifact";
  mimeType: string | null;
  size: number | null;
  /** The person or agent id behind it, resolved to a display name by the directory. */
  by: string | null;
  at: string;
};
