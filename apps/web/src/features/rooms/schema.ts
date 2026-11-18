import { z } from "zod";

import { MESSAGE_FEEDBACK_VALUES, ROOM_STATUSES, ROOM_TYPES, TURN_TAKINGS } from "@/db/schema/enums";

/** Requirement 32: the discussion-room action inputs. */

export const createRoomInput = z.object({
  projectKey: z.string().min(1),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  type: z.enum(ROOM_TYPES),
  turnTaking: z.enum(TURN_TAKINGS),
  status: z.enum(ROOM_STATUSES),
  /** The others to bring in; the person creating the room is always its Owner (D167, D345). */
  participants: z.array(z.string().min(1)),
});

export const postMessageInput = z.object({
  roomKey: z.string().min(1),
  text: z.string().trim().min(1).max(8000),
});

export const setTurnTakingInput = z.object({
  roomKey: z.string().min(1),
  turnTaking: z.enum(TURN_TAKINGS),
  version: z.number().int().positive(),
});

export const roomKeyInput = z.object({ roomKey: z.string().min(1) });

/** Converting a request or a work item into a discussion room. */
export const createRoomFromRequestInput = z.object({ requestKey: z.string().trim().min(1) });
export const createRoomFromWorkItemInput = z.object({ workItemKey: z.string().trim().min(1) });

export type CreateRoomInput = z.infer<typeof createRoomInput>;
export type PostMessageInput = z.infer<typeof postMessageInput>;
export type SetTurnTakingInput = z.infer<typeof setTurnTakingInput>;

/** `UC-23.1-05`: one person's verdict on an agent message. */
export const messageFeedbackInput = z.object({
  messageId: z.uuid(),
  value: z.enum(MESSAGE_FEEDBACK_VALUES),
});

/** `UC-23.3-04`: a participant joining or leaving. */
export const participantInput = z.object({
  roomKey: z.string().min(1),
  /** A person id or an agent code, as the directory names them. */
  principal: z.string().trim().min(1),
  action: z.enum(["Add", "Remove"]),
});

/** D392: an admin of the room makes a person in it an admin, or takes that back. */
export const roomAdminInput = z.object({
  roomKey: z.string().min(1),
  /** A person id; agents are never admins. */
  principal: z.string().trim().min(1),
  admin: z.boolean(),
});

/** `UC-23.3-06`: closing a room writes the handoff that is its final state. */
export const closeRoomInput = z.object({
  roomKey: z.string().min(1),
  goal: z.string().trim().max(2000).default(""),
  decisions: z.string().trim().max(4000).default(""),
  openQuestions: z.string().trim().max(2000).default(""),
  nextStep: z.string().trim().max(2000).default(""),
});

/** `UC-23.3-05`: a fork carries over what the person says should change. */
export const forkRoomInput = z.object({
  roomKey: z.string().min(1),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  whatShouldChange: z.string().trim().min(1).max(2000),
});

/** `UC-23.4-03`: a work item raised from a message keeps that message as its origin. */
export const createWorkItemFromMessageInput = z.object({
  roomKey: z.string().min(1),
  messageId: z.uuid(),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().max(4000).optional(),
});

export type MessageFeedbackInput = z.infer<typeof messageFeedbackInput>;
export type ParticipantInput = z.infer<typeof participantInput>;
export type RoomAdminInput = z.infer<typeof roomAdminInput>;
export type CloseRoomInput = z.infer<typeof closeRoomInput>;
export type ForkRoomInput = z.infer<typeof forkRoomInput>;
export type CreateWorkItemFromMessageInput = z.infer<typeof createWorkItemFromMessageInput>;

