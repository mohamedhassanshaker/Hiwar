import { audit } from "@/lib/audit";
import { notifyDashboard } from "@/lib/live";
import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { can, requirePermission, requireProjectPermission, visibleProjectIds, type Session } from "@/lib/session";
import { RoomRejected } from "./errors";
import { mayManageRoom } from "./moderation-service";
import * as repository from "./repository";
import type { RoomListFilters } from "./repository";
import { ROOM_MESSAGE_WINDOW } from "./types";
import type { CreateRoomInput } from "./schema";
import { postRefusal } from "./turns";

/** Discussion rooms: S-22 the list, S-23 one room. */

/** The least-privileged read a room imposes on an agent acting in it; see `./read-floor.ts`. */
export { readFloorForRoom, readFloorForRun } from "./read-floor";
export { RoomRejected } from "./errors";
export {
  type PostOutcome,
  postMessage,
  noteAttachmentInRoom,
  noteApprovalInRoom,
  noteQuestionInRoom,
  noteVisitorInRoom,
  recordFeedback,
} from "./message-service";
export { postAsPrincipal, postAgentReply } from "./reply-service";
export { moderatedRoom, setTurnTaking, setParticipant, setRoomAdmin, closeRoom, deleteRoom } from "./moderation-service";
export {
  forkRoom,
  createWorkItemFromMessage,
  createRoomWithTranscript,
  createRoomFromRequest,
  createRoomFromWorkItem,
} from "./conversion-service";

export type { RoomListFilters } from "./repository";

/**
 * One page of the rooms the person may see that pass the filters, latest activity first, with
 * how many pass them, the counters over every room they may see, and whether they may
 * moderate. Requires `rooms:read`.
 */
export async function loadRooms(
  filters: RoomListFilters = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  const session = await requirePermission("rooms:read");
  // `UC-22.1-05`: a room of a project they cannot see, and that they are not in, is not listed.
  const visible = await visibleProjectIds("rooms:read");
  const [rooms, total, counts, mayModerate] = await Promise.all([
    repository.listRoomsVisibleTo(visible, session.personId, filters, page),
    repository.countRoomsVisibleTo(visible, session.personId, filters),
    repository.roomCounts(visible, session.personId),
    can("rooms:moderate"),
  ]);
  return { rooms, total, counts, mayModerate };
}

/** The four most recent rooms, which the dashboard shows as room activity. */
export async function loadRecentRooms(limit: number) {
  const session = await requirePermission("rooms:read");
  return repository.listRoomsVisibleTo(await visibleProjectIds("rooms:read"), session.personId, {}, { limit, offset: 0 });
}

/**
 * Whether the signed-in person may read the room with this row id: `rooms:read`, and the
 * room's project or their place in it (`UC-22.1-05`). A run working in the room streams its
 * reply to whoever may read the room (D161).
 */
export async function mayReadRoom(roomId: string): Promise<boolean> {
  const session = await requirePermission("rooms:read");
  const rules = await repository.readRoomRulesById(roomId);
  if (!rules) return false;
  const visible = await visibleProjectIds("rooms:read");
  return visible === null || visible.includes(rules.projectId) || (await repository.isParticipant(rules.id, session.personId));
}


/**
 * One room for its screen, with its latest `messageLimit` messages, the person's feedback on
 * them, why the composer refuses them (if it does) in both languages, whether they may
 * moderate, and whether they manage its participants and turn-taking (D392). Requires
 * `rooms:read`; null when the room does not exist or is outside their projects and they are
 * not in it.
 */
export async function loadRoom(key: string, messageLimit: number = ROOM_MESSAGE_WINDOW) {
  const session = await requirePermission("rooms:read");
  const detail = await repository.readRoom(key, session.personId, messageLimit);
  if (!detail) return null;

  const rules = await repository.readRoomRules(key);
  // `UC-22.1-05`: a room outside their projects is theirs only if they are in it.
  if (rules) {
    const visible = await visibleProjectIds("rooms:read");
    const inProject = visible === null || visible.includes(rules.projectId);
    if (!inProject && !(await repository.isParticipant(rules.id, session.personId))) return null;
  }

  const feedback = rules
    ? await repository.feedbackOf(
        detail.messages.map((message) => message.id),
        session.personId,
      )
    : {};
  const refusal = rules
    ? postRefusal(
        { ...rules, estimatedSpendAed: rules.estimatedSpendAed },
        await repository.readParticipants(rules.id),
        session.personId,
      )
    : null;
  return {
    ...detail,
    feedback,
    postRefusal: refusal ? { en: refusal.message, ar: refusal.messageAr } : null,
    mayModerate: await can("rooms:moderate"),
    mayManage: await mayManageRoom(detail.roomId, session.personId),
  };
}

/**
 * `UC-22.2-01`: creates a room with the picked participants, the creator as its Owner, audits it
 * as `rooms:write` and tells the dashboard. Requires `rooms:write` in the project. A participant
 * id that names nobody is dropped. Returns the room's key.
 */
export async function createRoom(input: CreateRoomInput): Promise<string> {
  const session = await requireRoomWrite(input.projectKey);

  const principals = await resolveAll(input.participants);

  const key = await repository.createRoom({
    projectKey: input.projectKey,
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    type: input.type,
    turnTaking: input.turnTaking,
    status: input.status,
    participants: principals,
    createdBy: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:write",
    objectType: "DiscussionRoom",
    objectLabel: key,
    detail: { titleEn: input.titleEn, project: input.projectKey, turnTaking: input.turnTaking },
  });
  await notifyDashboard("room");
  return key;
}

/**
 * `rooms:write` in the project a new room goes into (`UC-41.2-03`): a role assigned in one unit
 * makes rooms in that unit's projects only. Returns the session that holds it.
 */
export async function requireRoomWrite(projectKey: string): Promise<Session> {
  await requirePermission("rooms:write");
  const projectId = await repository.projectIdByKey(projectKey);
  if (!projectId) throw new RoomRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  return requireProjectPermission("rooms:write", projectId);
}

/** Turns the directory ids a form sends into the principals the database stores. */
async function resolveAll(codes: string[]): Promise<{ type: string; id: string }[]> {
  const resolved = await Promise.all(codes.map((code) => repository.resolvePrincipal(code)));
  return resolved.filter((principal): principal is { type: string; id: string } => principal !== null);
}
