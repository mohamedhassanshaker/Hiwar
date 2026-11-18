"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  closeRoomInput,
  createRoomFromRequestInput,
  createRoomFromWorkItemInput,
  createRoomInput,
  createWorkItemFromMessageInput,
  forkRoomInput,
  messageFeedbackInput,
  participantInput,
  postMessageInput,
  roomAdminInput,
  roomKeyInput,
  setTurnTakingInput,
} from "./schema";
import * as service from "./service";

/** S-22 and S-23 mutations. */

/**
 * The input as `schema` reads it, or the refusal to return. A value the person typed that the schema refuses
 * is an ordinary refusal: thrown, it reaches the browser with its message removed (`lib/outcome.ts`).
 */
const read = <T>(schema: { parse(input: unknown): T }, input: unknown) => attempt(async () => schema.parse(input));

export async function createRoom(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createRoom(createRoomInput.parse(input)));
  revalidatePath("/discussion-rooms");
  revalidatePath("/dashboard");
  return outcome;
}

/** Converts a request into a discussion room, carrying its own detail as the opening post. */
export async function createRoomFromRequest(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createRoomFromRequest(createRoomFromRequestInput.parse(input).requestKey));
  revalidatePath("/discussion-rooms");
  return outcome;
}

/** Converts a work item into a discussion room, carrying its own detail as the opening post. */
export async function createRoomFromWorkItem(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createRoomFromWorkItem(createRoomFromWorkItemInput.parse(input).workItemKey));
  revalidatePath("/discussion-rooms");
  revalidatePath("/work-items");
  return outcome;
}

/** `UC-23.1-01`: post into the room, and bring in whoever answers it. */
export async function postMessage(input: unknown): Promise<Outcome<service.PostOutcome>> {
  const parsed = await read(postMessageInput, input);
  if (!parsed.ok) return parsed;
  const outcome = await attempt(() => service.postMessage(parsed.value));
  revalidatePath(`/discussion-rooms/${parsed.value.roomKey}`);
  return outcome;
}

/**
 * Sets the room's turn-taking policy through `service.setTurnTaking` and refreshes the room;
 * returns the outcome or the refusal.
 */
export async function setTurnTaking(input: unknown): Promise<Outcome<void>> {
  const parsed = setTurnTakingInput.parse(input);
  const outcome = await attempt(() => service.setTurnTaking(parsed));
  revalidatePath(`/discussion-rooms/${parsed.roomKey}`);
  return outcome;
}

/** `UC-23.1-05`: mark an agent message helpful or not. */
export async function recordFeedback(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.recordFeedback(messageFeedbackInput.parse(input)));
  return outcome;
}

/** `UC-23.3-04`: add or remove a participant. */
export async function setParticipant(input: unknown): Promise<Outcome<void>> {
  const parsed = participantInput.parse(input);
  const outcome = await attempt(() => service.setParticipant(parsed));
  revalidatePath(`/discussion-rooms/${parsed.roomKey}`);
  return outcome;
}

/** D392: make a person in the room an admin, or take that back. */
export async function setRoomAdmin(input: unknown): Promise<Outcome<void>> {
  const parsed = await read(roomAdminInput, input);
  if (!parsed.ok) return parsed;
  const outcome = await attempt(() => service.setRoomAdmin(parsed.value));
  revalidatePath(`/discussion-rooms/${parsed.value.roomKey}`);
  return outcome;
}

/** `UC-23.3-06`: close the room and write its final handoff. */
export async function closeRoom(input: unknown): Promise<Outcome<void>> {
  const parsed = await read(closeRoomInput, input);
  if (!parsed.ok) return parsed;
  const outcome = await attempt(() => service.closeRoom(parsed.value));
  revalidatePath(`/discussion-rooms/${parsed.value.roomKey}`);
  revalidatePath("/discussion-rooms");
  return outcome;
}

/** `UC-23.3-05`: fork the room, carrying over what should change. */
export async function forkRoom(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.forkRoom(forkRoomInput.parse(input)));
  revalidatePath("/discussion-rooms");
  return outcome;
}

/**
 * Deletes a room through `service.deleteRoom`, refreshing the room list when it is gone; returns
 * the outcome or the refusal naming what still uses the room.
 */
export async function deleteRoom(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteRoom(roomKeyInput.parse(input).roomKey));
  if (outcome.ok) revalidatePath("/discussion-rooms");
  return outcome;
}

/** `UC-23.4-03`: raise a work item from a message. */
export async function createWorkItemFromMessage(input: unknown): Promise<Outcome<string>> {
  const parsed = await read(createWorkItemFromMessageInput, input);
  if (!parsed.ok) return parsed;
  const outcome = await attempt(() => service.createWorkItemFromMessage(parsed.value));
  revalidatePath(`/discussion-rooms/${parsed.value.roomKey}`);
  return outcome;
}
