import { Rejected } from "@/lib/rejection";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { ConversationActionInput, SendToVisitorInput } from "./schema";

/**
 * A person taking a visitor conversation over from its agent (D342): taking over, writing to
 * the visitor, handing back and ending, each needing `conversations:answer` (D343). The reads
 * the Conversations screen makes are in `./service`.
 */

/** Thrown when a takeover action cannot apply to the conversation as it now stands. */
export class ConversationRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ConversationRejected";
  }
}

const notice = (en: string, ar: string): repository.TranscriptLine => ({ role: "System", kind: "Message", textEn: en, textAr: ar, payload: { level: "info" } });

async function openConversation(id: string) {
  const summary = await repository.readConversationSummary(id);
  if (!summary) throw new ConversationRejected("This conversation no longer exists.", "لم تعد هذه المحادثة موجودة.");
  if (summary.outcome !== null) throw new ConversationRejected("This conversation has ended.", "انتهت هذه المحادثة.");
  return summary;
}

/** The agent stops answering, and the visitor is told a person has joined. */
export async function takeOver(input: ConversationActionInput): Promise<void> {
  const session = await requirePermission("conversations:answer");
  await openConversation(input.id);
  if (!(await repository.setAgentPaused(input.id, session.personId))) {
    throw new ConversationRejected("Somebody has already taken this conversation over.", "تولّى شخص آخر هذه المحادثة بالفعل.");
  }
  await repository.appendConversationMessages(input.id, [
    notice(`${session.nameEn} from our team has joined the conversation.`, `انضم ${session.nameAr || session.nameEn} من فريقنا إلى المحادثة.`),
  ]);
  await audit({ actor: { type: "Person", id: session.personId, label: session.nameEn }, action: "conversations:takeover", objectType: "Conversation", objectId: input.id });
}

/** The agent answers again from where the script stands. */
export async function resumeAgent(input: ConversationActionInput): Promise<void> {
  const session = await requirePermission("conversations:answer");
  await openConversation(input.id);
  if (!(await repository.setAgentPaused(input.id, null))) {
    throw new ConversationRejected("The agent is already answering this conversation.", "الوكيل يجيب في هذه المحادثة بالفعل.");
  }
  await repository.appendConversationMessages(input.id, [notice("You are back with the assistant.", "عدت إلى المساعد.")]);
  await audit({ actor: { type: "Person", id: session.personId, label: session.nameEn }, action: "conversations:resume", objectType: "Conversation", objectId: input.id });
}

/** A person's message to the visitor, only while the conversation is taken over. */
export async function sendToVisitor(input: SendToVisitorInput): Promise<void> {
  const session = await requirePermission("conversations:answer");
  const summary = await openConversation(input.id);
  if (summary.status !== "AgentPaused") {
    throw new ConversationRejected("Take the conversation over before writing to the visitor.", "تولَّ المحادثة قبل الكتابة إلى الزائر.");
  }
  await repository.appendConversationMessages(input.id, [
    { role: "HumanAgent", kind: "Message", textEn: input.text, textAr: input.text, payload: { author: session.nameEn, personId: session.personId } },
  ]);
}

/** The conversation ends as Completed, and the visitor is told who ended it. */
export async function endByPerson(input: ConversationActionInput): Promise<void> {
  const session = await requirePermission("conversations:answer");
  await openConversation(input.id);
  await repository.appendConversationMessages(input.id, [
    notice("Our team has ended this conversation.", "أنهى فريقنا هذه المحادثة."),
    { role: "System", kind: "Ended", textEn: null, textAr: null, payload: { outcome: "Completed" } },
  ]);
  if (!(await repository.endConversation(input.id, "Completed"))) {
    throw new ConversationRejected("This conversation has ended.", "انتهت هذه المحادثة.");
  }
  await audit({ actor: { type: "Person", id: session.personId, label: session.nameEn }, action: "conversations:end", objectType: "Conversation", objectId: input.id });
}
