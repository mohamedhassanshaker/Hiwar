import * as requests from "@/features/requests/service";
import * as workItems from "@/features/work-items/service";
import { audit } from "@/lib/audit";
import { channels, publish } from "@/lib/valkey";
import { requirePermission, requireProjectPermission } from "@/lib/session";
import * as repository from "./repository";
import { mayReadRoom, requireRoomWrite } from "./service";
import type { CreateWorkItemFromMessageInput, ForkRoomInput } from "./schema";
import { RoomRejected } from "./errors";

/**
 * `UC-23.3-05`: a new room linked to this one, carrying over what was selected. The source room
 * has to be one the person may read, and the fork is in its project, so it needs `rooms:write`
 * there.
 */
export async function forkRoom(input: ForkRoomInput): Promise<string> {
  await requirePermission("rooms:write");

  const rules = await repository.readRoomRules(input.roomKey);
  // A room the person may not read is one that does not exist, as far as they can tell.
  if (!rules || !(await mayReadRoom(rules.id))) {
    throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");
  }
  const session = await requireProjectPermission("rooms:write", rules.projectId);

  const transcript = await repository.transcriptOf(rules.id);
  const carried = [
    `Forked from ${input.roomKey}. What should change: ${input.whatShouldChange}`,
    ...transcript.slice(-5).map((entry) => `${entry.sender}: ${entry.text}`),
  ].join("\n");

  const key = await repository.forkRoom({
    fromRoomId: rules.id,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    carryOver: carried,
    personId: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:write",
    objectType: "DiscussionRoom",
    objectLabel: key,
    detail: { forkedFrom: input.roomKey },
  });
  return key;
}

/** `UC-23.4-03`: a work item raised from a message, which keeps the message as its origin. */
export async function createWorkItemFromMessage(input: CreateWorkItemFromMessageInput): Promise<string> {
  await requirePermission("rooms:read");

  const rules = await repository.readRoomRules(input.roomKey);
  if (!rules) throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");

  const key = await workItems.createWorkItem({
    projectKey: rules.projectKey,
    type: "Task",
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    descriptionEn: input.descriptionEn,
    priority: "Medium",
  });
  await repository.linkWorkItemToMessage(rules.id, input.messageId, key);
  await publish(channels.room(rules.id), { kind: "work-item" });
  return key;
}

/**
 * `UC-65.1-08`: a handoff room in the queue's project, carrying the conversation so far.
 *
 * Created on behalf of the project's owner, who is the person answerable for the queue.
 */
export async function createRoomWithTranscript(input: {
  projectKey: string;
  actingPersonId: string;
  titleEn: string;
  transcript: string[];
}): Promise<string> {
  const key = await repository.createRoom({
    projectKey: input.projectKey,
    titleEn: input.titleEn,
    titleAr: input.titleEn,
    type: "Chat",
    turnTaking: "MentionOnly",
    status: "Active",
    participants: [{ type: "Person", id: input.actingPersonId }],
    createdBy: input.actingPersonId,
  });
  const rules = await repository.readRoomRules(key);
  if (rules) {
    await repository.appendMessage({
      roomId: rules.id,
      senderType: "System",
      senderId: null,
      content: { kind: "note", en: input.transcript.join("\n"), ar: input.transcript.join("\n") },
      actedBy: input.actingPersonId,
    });
  }
  return key;
}

/**
 * A request's own detail, as the opening post of the room it is converted into. The request has
 * to be one the person may see, and the room is in its project, so it needs `rooms:write` there.
 */
export async function createRoomFromRequest(requestKey: string): Promise<string> {
  await requirePermission("rooms:write");
  const detail = await requests.loadRequestForRoom(requestKey);
  if (!detail) throw new RoomRejected("That request no longer exists.", "لم يعد هذا الطلب موجوداً.");
  const session = await requireRoomWrite(detail.projectKey);
  return createRoomWithTranscript({
    projectKey: detail.projectKey,
    actingPersonId: session.personId,
    titleEn: `${requestKey}: ${detail.titleEn}`,
    transcript: [
      `Request ${requestKey} — ${detail.titleEn}`,
      `Type: ${detail.typeNameEn}`,
      `Status: ${detail.status}`,
      `Description: ${detail.descEn ?? "—"}`,
    ],
  });
}

/** A work item's own detail, as the opening post of the room it is converted into. The
 * room is also linked back to it, the same link a request raised from a room already has
 * in reverse. The room is in the work item's project, so it needs `rooms:write` there. */
export async function createRoomFromWorkItem(workItemKey: string): Promise<string> {
  await requirePermission("rooms:write");
  const detail = await workItems.loadWorkItemForRoom(workItemKey);
  if (!detail) throw new RoomRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  const session = await requireRoomWrite(detail.projectKey);
  const key = await createRoomWithTranscript({
    projectKey: detail.projectKey,
    actingPersonId: session.personId,
    titleEn: `${workItemKey}: ${detail.titleEn}`,
    transcript: [
      `Work item ${workItemKey} — ${detail.titleEn}`,
      `Status: ${detail.status}`,
      `Priority: ${detail.priority}`,
      `Description: ${detail.descEn ?? "—"}`,
    ],
  });
  await repository.linkWorkItem(key, detail.id);
  return key;
}
