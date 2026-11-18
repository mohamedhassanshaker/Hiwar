import * as agents from "@/features/agents/service";
import type { ConversationTurn } from "@/features/agents/types";
import { audit } from "@/lib/audit";
import { extractDocumentText } from "@/lib/documents";
import { getObject } from "@/lib/objects";
import { channels, publish } from "@/lib/valkey";
import { mirrorOutbound } from "@/features/engage/gateway";
import { logger } from "@/lib/logger";
import { notifyInbox } from "@/lib/live";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { MessageFeedbackInput, PostMessageInput } from "./schema";
import { mentionsIn, postRefusal, turnFor } from "./turns";
import { chooseAgent } from "./agent-choice";
import { RoomRejected } from "./errors";

/** What posting a message did, which is what the composer reports. */
export type PostOutcome = {
  /** The agents a run was started for. */
  started: string[];
  /** Why no agent answered, when none did and the room meant to say so. */
  note: string | null;
};

/** How many of a room's recent messages an agent run started on it carries in as history. */
const CONVERSATION_HISTORY_LIMIT = 20;

/**
 * What an agent run started on this room carries in as `conversation`: its recent messages,
 * each attachment's own text read in beside the message that announced it.
 *
 * Owner feedback this answers directly: a file reaching only the Files panel meant an agent
 * never actually read it, no matter how plainly a person asked about it afterwards. A file
 * that cannot be read (an unreadable format, a format `parsers` is not installed for) is
 * skipped rather than failing the run — the rest of the conversation still reaches the model.
 */
async function conversationContext(roomId: string): Promise<ConversationTurn[]> {
  const recent = await repository.recentMessagesForConversation(roomId, CONVERSATION_HISTORY_LIMIT);
  const turns: ConversationTurn[] = [];
  for (const entry of recent) {
    if (entry.text) turns.push({ role: entry.role, author: entry.author, text: entry.text });
    if (!entry.attachment) continue;
    try {
      const contentRef = await repository.roomAttachmentRef(roomId, entry.attachment);
      if (!contentRef) continue;
      const object = await getObject(contentRef);
      if (!object) continue;
      const bytes = Buffer.from(await new Response(object.body).arrayBuffer());
      const read = await extractDocumentText(entry.attachment, bytes.toString("base64"));
      if (read.ok) {
        turns.push({ role: "system", author: `attachment:${entry.attachment}`, text: read.text });
      }
    } catch (problem) {
      logger().warn({ room: roomId, attachment: entry.attachment, problem: String(problem) }, "a room attachment could not be read into an agent's context");
    }
  }
  return turns;
}

/**
 * `UC-23.1-01`, `-02`, `-07` … `-09`: post a message, and bring in whoever answers it.
 *
 * The rules are `./turns.ts`; this is what carries them out. Every refusal is written into
 * the room as a message of its own, because "the agents stopped" with nothing said is
 * indistinguishable from "the agents had nothing to say".
 */
export async function postMessage(input: PostMessageInput): Promise<PostOutcome> {
  const session = await requirePermission("rooms:write");

  const rules = await repository.readRoomRules(input.roomKey);
  if (!rules) throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");

  const participants = await repository.readParticipants(rules.id);
  const refusal = postRefusal(rules, participants, session.personId);
  if (refusal) throw new RoomRejected(refusal.message, refusal.messageAr);

  const posted = await repository.appendMessage({
    roomId: rules.id,
    senderType: "Person",
    senderId: session.personId,
    content: { kind: "text", en: input.text, ar: input.text },
    actedBy: session.personId,
  });
  await publish(channels.room(rules.id), { kind: "message", seq: posted.seq });

  // `UC-23.1-13`: a room that is mirrored to a channel sends the message back out as well.
  await mirrorOutbound(rules.id, input.text, session.nameEn);

  // `UC-23.1-06`: a mention of a person reaches their Inbox, and their own notification
  // preferences decide what else it reaches.
  const mentionedPeople = await repository.peopleByIds(
    mentionsIn(input.text, participants).filter((id) => participants.some((one) => one.id === id && !one.isAgent)),
  );
  await repository.notifyMentions(posted.id, mentionedPeople, session.personId);
  await Promise.all(mentionedPeople.map((personId) => notifyInbox(personId, "mention")));

  // D66: this is a person's message, so it is an address and it starts the mission. The
  // count comes off the transcript — the message just appended is the most recent one, so
  // a person's post resets it by being there rather than by a rule saying it does.
  const since = await repository.hopsSinceHuman(rules.id);
  const turn = turnFor(rules, participants, {
    text: input.text,
    fromAgent: false,
    hopsSinceHuman: since.hops,
  });

  if (turn.refusal) {
    await repository.appendMessage({
      roomId: rules.id,
      senderType: "System",
      senderId: null,
      content: { kind: "note", en: turn.refusal.message, ar: turn.refusal.messageAr },
      actedBy: session.personId,
    });
    await publish(channels.room(rules.id), { kind: "note" });
    return { started: [], note: turn.refusal.message };
  }

  const started: string[] = [];
  const conversation = turn.agents.length > 0 || turn.choose ? await conversationContext(rules.id) : [];
  // D289: an Autonomous room with several agents gives the message to the one it fits.
  const answering = turn.choose
    ? [
        await chooseAgent({
          text: input.text,
          candidates: turn.choose,
          conversation: conversation.filter((entry) => entry.role !== "system").map((entry) => `${entry.author ?? entry.role}: ${entry.text}`),
        }),
      ]
    : turn.agents;
  for (const agentCode of answering) {
    try {
      await agents.startRun({
        agentCode,
        prompt: input.text,
        surface: "Room",
        contextId: input.roomKey,
        conversation,
      });
      started.push(agentCode);
    } catch (problem) {
      // `UC-23.1-10`: a run that will not start is said so in the room, with the agent named.
      const reason = problem instanceof Error ? problem.message : String(problem);
      logger().warn({ room: input.roomKey, agent: agentCode, problem: reason }, "a room run did not start");
      await repository.appendMessage({
        roomId: rules.id,
        senderType: "System",
        senderId: null,
        content: { kind: "failure", agent: agentCode, en: `${agentCode} could not complete: ${reason}`, ar: `${agentCode} لم يُكمل: ${reason}` },
        actedBy: session.personId,
      });
    }
  }
  if (started.length > 0) await publish(channels.room(rules.id), { kind: "run" });
  return { started, note: null };
}

/**
 * Announces an attachment as a message in the room's own thread, called from `files.attachFile`
 * once the upload itself succeeds. Before this, an uploaded file reached only the room's Files
 * panel — silent in the transcript itself, and so invisible to anything that reads the thread to
 * decide what the room is about, including an agent summarising the discussion.
 *
 * Best-effort: the upload has already succeeded by the time this runs, so a room that
 * disappeared between the two calls does not turn an accepted upload into a failure.
 */
export async function noteAttachmentInRoom(roomKey: string, fileName: string, personId: string): Promise<void> {
  const rules = await repository.readRoomRules(roomKey);
  if (!rules) return;
  const posted = await repository.appendMessage({
    roomId: rules.id,
    senderType: "Person",
    senderId: personId,
    content: { kind: "attachment", en: `Attached ${fileName}.`, ar: `أُرفق ${fileName}.`, attachment: fileName },
    actedBy: personId,
  });
  await publish(channels.room(rules.id), { kind: "message", seq: posted.seq });
}

/**
 * A widget visitor's message after their conversation was handed over into this room, so
 * the person answering reads it where they reply (widget specification 12).
 */
export async function noteVisitorInRoom(roomId: string, text: string): Promise<void> {
  const posted = await repository.appendMessage({
    roomId,
    senderType: "System",
    senderId: null,
    content: { kind: "visitor", en: `Visitor: ${text}`, ar: `الزائر: ${text}` },
    actedBy: null,
  });
  await publish(channels.room(roomId), { kind: "message", seq: posted.seq });
}

/**
 * `UC-12.1-01`: posts the approval a paused run is waiting on into the room it is running
 * in, so it is decided where the work is rather than only in the Inbox.
 *
 * Called by `requestApproval` once the approval row exists. Best-effort: the approval is
 * already recorded and decidable from the Inbox, so a room that has gone does not turn a
 * created approval into a failed tool call.
 */
export async function noteApprovalInRoom(roomId: string, approvalKey: string, toolName: string, actedBy: string): Promise<void> {
  try {
    const posted = await repository.appendMessage({
      roomId,
      senderType: "Agent",
      senderId: null,
      content: {
        kind: "approval",
        approval: approvalKey,
        en: `This run needs approval to call ${toolName} before it can continue.`,
        ar: `تحتاج هذه العملية اعتماداً لاستدعاء ${toolName} قبل أن تتابع.`,
      },
      actedBy,
    });
    await publish(channels.room(roomId), { kind: "message", seq: posted.seq });
  } catch (problem) {
    logger().warn({ room: roomId, approval: approvalKey, problem: String(problem) }, "an approval was not announced in its room");
  }
}

/**
 * `UC-12.2-01` in a room: a run waiting on an answer says so where the work is, with the question as a card the
 * person it was asked of answers in place (the same answer the Inbox and the assistant panel record). Like
 * `noteApprovalInRoom`, a room that cannot take the note does not stop the question being asked.
 */
export async function noteQuestionInRoom(roomId: string, questionId: string, actedBy: string): Promise<void> {
  try {
    const posted = await repository.appendMessage({
      roomId,
      senderType: "Agent",
      senderId: null,
      content: {
        kind: "question",
        question: questionId,
        en: "This run is waiting for an answer before it can continue.",
        ar: "تنتظر هذه العملية إجابة قبل أن تتابع.",
      },
      actedBy,
    });
    await publish(channels.room(roomId), { kind: "message", seq: posted.seq });
  } catch (problem) {
    logger().warn({ room: roomId, question: questionId, problem: String(problem) }, "a question was not announced in its room");
  }
}

/** `UC-23.1-05`: one person's verdict on an agent message, which feeds its evaluation. */
export async function recordFeedback(input: MessageFeedbackInput): Promise<void> {
  const session = await requirePermission("rooms:read");
  await repository.saveFeedback(input.messageId, session.personId, input.value);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "rooms:feedback",
    objectType: "RoomMessage",
    objectId: input.messageId,
    detail: { value: input.value },
  });
}
