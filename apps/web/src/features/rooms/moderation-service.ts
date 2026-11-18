import { audit } from "@/lib/audit";
import { channels, publish } from "@/lib/valkey";
import { notifyDashboard } from "@/lib/live";
import { can, requirePermission, requireProjectPermission, type Session } from "@/lib/session";
import * as repository from "./repository";
import type { CloseRoomInput, ParticipantInput, RoomAdminInput, SetTurnTakingInput } from "./schema";
import { RoomRejected } from "./errors";

/** D392: the roles that manage a room's participants and turn-taking. */
const ROOM_ADMIN_ROLES = ["Owner", "Admin"];

/**
 * D392: whether this person manages the room's participants and turn-taking: its Owner or one
 * of its Admins, or a holder of `rooms:moderate`, who moderates every room they can see.
 */
export async function mayManageRoom(roomId: string, personId: string): Promise<boolean> {
  const role = await repository.roomRoleOf(roomId, personId);
  if (role !== null && ROOM_ADMIN_ROLES.includes(role)) return true;
  return can("rooms:moderate");
}

/**
 * The room a participant or turn-taking change is on, and the person making it: an admin of
 * the room (D392), or otherwise a holder of `rooms:moderate` in its project.
 */
async function managedRoom(roomKey: string): Promise<{ session: Session; rules: repository.RoomRulesRow }> {
  const session = await requirePermission("rooms:read");
  const rules = await repository.readRoomRules(roomKey);
  if (!rules) throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");
  const role = await repository.roomRoleOf(rules.id, session.personId);
  if (role !== null && ROOM_ADMIN_ROLES.includes(role)) return { session, rules };
  return moderatedRoom(roomKey);
}

/**
 * The room a moderation act is on, and the person acting, who needs `rooms:moderate` in the
 * room's project (`UC-41.2-03`): a role assigned in one unit moderates that unit's rooms only.
 */
export async function moderatedRoom(roomKey: string): Promise<{ session: Session; rules: repository.RoomRulesRow }> {
  await requirePermission("rooms:moderate");
  const rules = await repository.readRoomRules(roomKey);
  if (!rules) throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");
  return { session: await requireProjectPermission("rooms:moderate", rules.projectId), rules };
}

/**
 * Sets the room's turn-taking policy at the version the screen holds and audits it as
 * `rooms:moderate`. Requires an admin of the room (D392) or `rooms:moderate` in its project;
 * a stale version is refused.
 */
export async function setTurnTaking(input: SetTurnTakingInput): Promise<void> {
  const { session } = await managedRoom(input.roomKey);
  await repository.setTurnTaking(input.roomKey, input.turnTaking, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:moderate",
    objectType: "DiscussionRoom",
    objectLabel: input.roomKey,
    detail: { turnTaking: input.turnTaking },
  });
}

/**
 * `UC-23.3-04`: somebody joins the room, or loses access to it at once.
 *
 * Any agent may be removed, the built-in Platform Assistant included: D65 protects it from
 * being deleted from the platform, which is not the same as being in this room. A removed
 * agent is addressable by nobody and its in-flight replies do not land (`postAgentReply`).
 * Which agent leads is kept by the repository as agents join and leave.
 *
 * Requires an admin of the room (D392) or `rooms:moderate` in its project. The room's Owner
 * stays in it: nobody removes them.
 */
export async function setParticipant(input: ParticipantInput): Promise<void> {
  const { session, rules } = await managedRoom(input.roomKey);

  const principal = await repository.resolvePrincipal(input.principal);
  if (!principal) throw new RoomRejected("No such person or agent.", "لا يوجد شخص أو وكيل بهذا المعرّف.");

  if (input.action === "Remove" && (await repository.roomRoleOf(rules.id, principal.id)) === "Owner") {
    throw new RoomRejected("The owner of a room cannot be removed from it.", "لا يمكن إزالة مالك الاجتماع منه.");
  }
  if (input.action === "Add") {
    const joining = principal.type === "Person" && (await repository.roomRoleOf(rules.id, principal.id)) === null;
    await repository.addParticipant(rules.id, principal);
    if (joining) await repository.tellJoined(input.roomKey, [principal.id], session.personId);
  } else {
    await repository.removeParticipant(rules.id, principal.id);
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:moderate",
    objectType: "DiscussionRoom",
    objectLabel: input.roomKey,
    detail: { participant: input.principal, action: input.action },
  });
  await publish(channels.room(rules.id), { kind: "participants" });
}

/**
 * D392: makes a person in the room an Admin, or a Member again. Requires an admin of the room
 * or `rooms:moderate`. Only a plain Member can be made an Admin: the Owner already is one,
 * an Observer reads and does not manage, and an agent never is.
 */
export async function setRoomAdmin(input: RoomAdminInput): Promise<void> {
  const { session, rules } = await managedRoom(input.roomKey);

  const principal = await repository.resolvePrincipal(input.principal);
  const role = principal?.type === "Person" ? await repository.roomRoleOf(rules.id, principal.id) : null;
  if (!principal || role === null) {
    throw new RoomRejected("That person is not in this room.", "هذا الشخص ليس في هذا الاجتماع.");
  }
  if (role === "Owner") {
    throw new RoomRejected("The owner of a room is always its admin.", "مالك الاجتماع هو دائماً مسؤوله.");
  }
  if (input.admin && role !== "Member" && role !== "Admin") {
    throw new RoomRejected("Only a member can be made an admin.", "لا يمكن تعيين مسؤول إلا من الأعضاء.");
  }
  // Taking admin back from an Observer would turn them into a Member.
  if (!input.admin && role !== "Admin") {
    throw new RoomRejected("That person is not an admin of this room.", "هذا الشخص ليس مسؤولاً في هذا الاجتماع.");
  }

  await repository.setPersonRole(rules.id, principal.id, input.admin ? "Admin" : "Member");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:moderate",
    objectType: "DiscussionRoom",
    objectLabel: input.roomKey,
    detail: { participant: input.principal, admin: input.admin },
  });
  await publish(channels.room(rules.id), { kind: "participants" });
}

/**
 * `UC-23.3-06`: close the room, writing the handoff that is its final state.
 *
 * The handoff is built from what the room actually said, so a room closed without one would
 * be a room whose conclusion nobody recorded.
 */
export async function closeRoom(input: CloseRoomInput): Promise<void> {
  const { session, rules } = await moderatedRoom(input.roomKey);

  const transcript = await repository.transcriptOf(rules.id);
  const lines = transcript.map((entry) => `${entry.sender}: ${entry.text}`);
  await repository.closeRoom(
    rules.id,
    {
      goal: input.goal || (lines[0] ?? ""),
      decisions: input.decisions || lines.slice(-5).join("\n"),
      openQuestions: input.openQuestions,
      nextStep: input.nextStep,
    },
    session.personId,
  );
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:moderate",
    objectType: "DiscussionRoom",
    objectLabel: input.roomKey,
    detail: { closed: true, messages: transcript.length },
  });
  await publish(channels.room(rules.id), { kind: "closed" });
  await notifyDashboard("room");
}

/**
 * Removes a room — its messages, participants, work-item links and close handoff go with
 * it. Refused while another room still carries it as the one it was forked from, a request
 * was raised from it, or a deployment conversation is mirrored into it.
 */
export async function deleteRoom(roomKey: string): Promise<void> {
  const { session, rules } = await moderatedRoom(roomKey);

  const blockers = await repository.roomDeleteBlockers(rules.id);
  const inUse = [
    blockers.forkedRooms && `${blockers.forkedRooms} rooms forked from it`,
    blockers.requests && `${blockers.requests} requests raised from it`,
    blockers.deploymentConversations && `${blockers.deploymentConversations} deployment conversations`,
  ].filter(Boolean);
  const inUseAr = [
    blockers.forkedRooms && `${blockers.forkedRooms} غرف مُتفرّعة منها`,
    blockers.requests && `${blockers.requests} طلبات أُنشئت منها`,
    blockers.deploymentConversations && `${blockers.deploymentConversations} محادثات نشر`,
  ].filter(Boolean);
  if (inUse.length) {
    throw new RoomRejected(
      `This room cannot be deleted: it still has ${inUse.join(", ")}.`,
      `لا يمكن حذف هذه الغرفة: لا يزال لديها ${inUseAr.join("، ")}.`,
    );
  }

  await repository.deleteRoom(rules.id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:delete",
    objectType: "DiscussionRoom",
    objectLabel: roomKey,
  });
  await notifyDashboard("room");
}
