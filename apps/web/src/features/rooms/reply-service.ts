import { channels, publish } from "@/lib/valkey";
import { logger } from "@/lib/logger";
import * as repository from "./repository";
import { agentReplyRefusal } from "./turns";
import { RoomRejected } from "./errors";

/**
 * `UC-23.1-13`: a message that arrived on a mirrored channel, posted as the principal the
 * gateway identified.
 *
 * There is no session: the webhook's signature is what established who sent it. The room's
 * own rules still decide whether it may be posted into, which is why they are read here
 * rather than trusted to the caller.
 */
export async function postAsPrincipal(input: {
  roomKey: string;
  principalType: string;
  principalId: string;
  text: string;
}): Promise<void> {
  const rules = await repository.readRoomRules(input.roomKey);
  if (!rules) throw new RoomRejected("That room no longer exists.", "لم تعد هذه الغرفة موجودة.");
  if (rules.status !== "Active") throw new RoomRejected("That room is closed.", "هذه الغرفة مغلقة.");

  const posted = await repository.appendMessage({
    roomId: rules.id,
    senderType: input.principalType,
    senderId: input.principalId,
    content: { kind: "text", en: input.text, ar: input.text },
    actedBy: input.principalId,
  });
  await publish(channels.room(rules.id), { kind: "message", seq: posted.seq });
}

/** How a run that did not succeed is described in the room, by `ai.run.status`. */
const OUTCOME: Record<string, [string, string]> = {
  Failed: ["failed", "فشل"],
  Cancelled: ["was cancelled", "أُلغي"],
  BudgetExceeded: ["stopped at its effort limit", "توقف عند حد الجهد"],
  Blocked: ["is blocked and needs a person", "متوقف ويحتاج إلى شخص"],
};

/**
 * `UC-23.1-07`: a run's own reply, posted back into the room it answered.
 *
 * Finishing a run is what calls this, under the agent that ran rather than a person, so it
 * takes the room by id — a run's context already resolved it — and does not re-check whether
 * the room is still `Active`: the run already happened and spent what it spent, and its
 * output belongs in the room's history whatever the room's state is by the time it lands.
 *
 * Only a `Succeeded` run posts as the agent. Any other outcome is a System failure naming
 * the agent, like a run that would not start (`UC-23.1-10`), so a run that failed, was
 * cancelled, ran out of effort or is blocked never reads as the agent's answer (D102).
 */
export async function postAgentReply(input: {
  roomId: string;
  agentId: string;
  agentCode: string;
  /** The run's outcome, an `ai.run.status`. */
  status: string;
  text: string;
  runId: string;
  toolCalls: number;
  estimatedCostAed: number;
  actedBy: string;
  /** The name of an artifact this run produced and linked to the room, if it did. */
  artifactName?: string;
}): Promise<void> {
  // D66 and decision (g): an agent that has been removed from the room is out of it, and
  // a reply from a run that was in flight at the time does not put it back in.
  if (!(await repository.isAgentParticipant(input.roomId, input.agentId))) {
    logger().info({ room: input.roomId, agent: input.agentId, run: input.runId }, "a reply was not posted: the agent is no longer in the room");
    return;
  }

  if (input.status !== "Succeeded") {
    const [en, ar] = OUTCOME[input.status] ?? [`did not finish (${input.status})`, `لم يُكمل (${input.status})`];
    const posted = await repository.appendMessage({
      roomId: input.roomId,
      senderType: "System",
      senderId: null,
      content: {
        kind: "failure",
        agent: input.agentCode,
        en: input.text ? `${input.agentCode} ${en}: ${input.text}` : `${input.agentCode} ${en}.`,
        ar: input.text ? `${input.agentCode} ${ar}: ${input.text}` : `${input.agentCode} ${ar}.`,
      },
      runId: input.runId,
      actedBy: input.actedBy,
    });
    await publish(channels.room(input.roomId), { kind: "message", seq: posted.seq });
    return;
  }

  // D66 and D73: the room's limit is effort — how many agent messages one human message
  // may produce. One message can start several missions and a mission that delegates
  // finishes more than once, so the count is held here, where the messages land. The note
  // is written once, on the message that reaches the limit, so a room does not fill with
  // the same sentence.
  const rules = await repository.readRoomRulesById(input.roomId);
  if (!rules) return;
  const since = await repository.hopsSinceHuman(input.roomId);
  const refusal = agentReplyRefusal(rules, since.hops);
  if (refusal) {
    // Written once, by the first reply the limit turns away — after that the room's last
    // message is the note itself, and repeating it would be the runaway in another form.
    if (since.lastSenderType === "Agent") {
      await repository.appendMessage({
        roomId: input.roomId,
        senderType: "System",
        senderId: null,
        content: { kind: "note", en: refusal.message, ar: refusal.messageAr },
        actedBy: input.actedBy,
      });
      await publish(channels.room(input.roomId), { kind: "note" });
    }
    return;
  }

  const posted = await repository.appendMessage({
    roomId: input.roomId,
    senderType: "Agent",
    senderId: input.agentId,
    content: {
      kind: "text",
      en: input.text,
      ar: input.text,
      toolCalls: input.toolCalls,
      estimatedCostAed: input.estimatedCostAed,
      ...(input.artifactName
        ? {
            artifact: input.artifactName,
            artifactNoteEn: "Produced by this run.",
            artifactNoteAr: "من إنتاج هذه العملية.",
          }
        : {}),
    },
    runId: input.runId,
    actedBy: input.actedBy,
  });
  await publish(channels.room(input.roomId), { kind: "message", seq: posted.seq });
}
