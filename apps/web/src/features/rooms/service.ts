import type { Principal } from "@/authz/evaluate";
import { Rejected } from "@/lib/rejection";
import type { Session } from "@/lib/session";

/**
 * TAWP's discussion rooms, which the AI module hands conversations and channel messages to.
 * Hiwar has no rooms: a visitor who needs a person is handed over in Hiwar's own inbox
 * (INB-002), so these refuse with a reason instead of writing somewhere nobody reads.
 */

const NO_ROOMS = new Rejected("Hiwar has no discussion rooms. Hand the conversation to staff in Conversations.", "لا توجد غرف نقاش في حوار. سلّم المحادثة للفريق في المحادثات.");

export async function createRoomWithTranscript(_input: { projectKey: string; actingPersonId: string; titleEn: string; transcript: string[] }): Promise<string> {
  throw NO_ROOMS;
}

export async function noteVisitorInRoom(_roomId: string, _text: string): Promise<void> {
  throw NO_ROOMS;
}

export async function postAsPrincipal(_input: { roomKey: string; principalType: string; principalId: string; text: string }): Promise<void> {
  throw NO_ROOMS;
}

export async function moderatedRoom(_roomKey: string): Promise<{ session: Session; rules: { projectId: string; status: string } }> {
  throw NO_ROOMS;
}

/** No run reads inside a room, so no read floor ever applies. */
export async function readFloorForRun(_runId: string): Promise<Principal[]> {
  return [];
}

/* A run in Hiwar never has a room as its context, so the module's room notices have nothing to do. */

export async function noteApprovalInRoom(_roomId: string, _approvalKey: string, _toolName: string, _personId: string): Promise<void> {}

export async function noteQuestionInRoom(_roomId: string, _questionId: string, _personId: string): Promise<void> {}

export async function postAgentReply(_input: Record<string, unknown>): Promise<void> {}

export async function mayReadRoom(_roomId: string): Promise<boolean> {
  return false;
}
