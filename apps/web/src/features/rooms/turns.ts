/**
 * Who answers in a discussion room, and when the room stops answering (S-23, D66).
 *
 * A room is the one place where several agents and several people talk at once, so the
 * rules that bound it are the rules that stop it running away: a person's message is the
 * only thing that starts an agent, the turn limit bounds how much one message may produce,
 * and the room's own state stops it entirely.
 *
 * D73 removed money ceilings, so the room's limit is stated as effort — agent messages per
 * human message — rather than as a sum. `costCapAed` is still read where a room has one
 * configured, because a room that already stops at a figure must not start spending more
 * than it did yesterday; nothing sets a new one.
 *
 * Kept apart from the database so each rule can be stated and tested on its own.
 */

/** The room, as these rules need it. */
export type RoomRules = {
  status: string;
  turnTaking: string;
  /**
   * How many agent messages one human message may produce (D66, D73). The next human
   * message resets the count, which is why it is counted off the transcript rather than
   * stored: there is no counter to forget to clear.
   */
  agentHopLimit: number;
  /** `null` is "no cap", which is what a room with nothing configured has. */
  costCapAed: number | null;
  estimatedSpendAed: number;
};

/** One participant, as these rules need them. */
export type Participant = {
  /** A person id or an agent code, as the room screen names them. */
  id: string;
  isAgent: boolean;
  role: string;
  /**
   * What a person writes after `@` to name them: a person's e-mail name, as a comment's
   * mention uses it, or an agent's code (D163). An id still names them too.
   */
  handle?: string;
};

/** Why nobody may post, or `null` when they may. */
export type PostRefusal = {
  reason: "Observer" | "RoomClosed" | "NotParticipant";
  message: string;
  messageAr: string;
};

/**
 * Whether one person may post into a room (`UC-23.1-11`).
 *
 * An observer reads. A closed or archived room takes no more messages, because its context
 * handoff has been written and a message after it would not be in it.
 */
export function postRefusal(room: RoomRules, participants: Participant[], personId: string): PostRefusal | null {
  if (room.status === "Closed" || room.status === "Archived") {
    return { reason: "RoomClosed", message: "This room is closed.", messageAr: "هذه الغرفة مغلقة." };
  }
  const mine = participants.find((participant) => !participant.isAgent && participant.id === personId);
  if (!mine) {
    return { reason: "NotParticipant", message: "You are not a participant of this room.", messageAr: "لست مشاركاً في هذه الغرفة." };
  }
  if (mine.role === "Observer") {
    return {
      reason: "Observer",
      message: "Observers read this room; they do not post in it.",
      messageAr: "المراقبون يقرؤون هذه الغرفة ولا يكتبون فيها.",
    };
  }
  return null;
}

/** The ids `@name` refers to, resolved against the room's own participants. */
export function mentionsIn(text: string, participants: Participant[]): string[] {
  const mentioned = new Set<string>();
  for (const handle of handlesIn(text)) {
    for (const participant of participants) {
      if (participant.id.toLowerCase() === handle || participant.handle?.toLowerCase() === handle) {
        mentioned.add(participant.id);
      }
    }
  }
  return [...mentioned];
}

/**
 * Every `@name` in a message, lower-cased, whoever it names. The `@` starts a word: in an email
 * address it does not, and `x@gmail.com` was read as a mention of `@gmail.com`.
 */
function handlesIn(text: string): string[] {
  return [...text.matchAll(/(?<![A-Za-z0-9._%+-])@([A-Za-z0-9._-]+)/g)].map((match) =>
    match[1].toLowerCase().replace(/\.+$/, ""),
  );
}

/** Why no agent answers this message, or `null` when one does. */
export type TurnRefusal =
  | { reason: "AgentPost"; message: string; messageAr: string }
  | { reason: "HopLimit"; message: string; messageAr: string }
  | { reason: "CostCap"; message: string; messageAr: string }
  | { reason: "RoomPaused"; message: string; messageAr: string }
  | { reason: "NotInRoom"; message: string; messageAr: string };

export type Turn = {
  agents: string[];
  refusal: TurnRefusal | null;
  /**
   * Autonomous, several agents, nobody named: the platform chooses one of these, the lead
   * first (D289). The caller asks the typed classifier, and the lead answers when it cannot.
   */
  choose?: string[];
};

const AGENT_POST: TurnRefusal = {
  reason: "AgentPost",
  message: "An agent's message does not start another agent.",
  messageAr: "رسالة الوكيل لا تُشغّل وكيلاً آخر.",
};

const HOP_LIMIT: TurnRefusal = {
  reason: "HopLimit",
  message: "Agent hop limit reached; the next message from a person starts it again.",
  messageAr: "بلغ عدد تنقلات الوكلاء حده؛ رسالة الشخص التالية تبدأ من جديد.",
};

/**
 * Which agents answer a message, under the room's turn-taking policy.
 *
 * D66, and the one rule above every policy: only a person's message starts a mission. An
 * agent's own post answers nothing, whatever the policy says and however far below the
 * limit the room is — agent-to-agent work happens through delegation inside a mission,
 * where the budget and the approval gate still hold, not by posting in a room where they
 * do not. Each address therefore starts a mission whose requester is the person who wrote
 * the message.
 *
 * Who a person's message addresses (D289):
 * - `MentionOnly`: exactly the agents the message named (`UC-22.2-02`).
 * - `Autonomous`: the agent the message named; otherwise the room's one agent, or, with
 *   several, the one the platform chooses for the message (`choose`).
 *
 * One agent acts on a message, however many it would reach (D213): several agents answering
 * one request duplicate the work and contradict each other. Of several mentioned, the first
 * named acts. `UC-23.1-08`: the room answers at most `agentHopLimit` times per human message.
 * `UC-23.1-09`: a room over a configured cap stops answering whatever the policy says.
 * `UC-22.2-06`: a paused room runs no agent at all.
 *
 * A person's message that reaches no agent gets a note only when it names somebody who is
 * not in the room. A room of people, or a message naming no agent in a Mention only room, is
 * a conversation (D213, D214).
 */
export function turnFor(
  room: RoomRules,
  participants: Participant[],
  input: { text: string; fromAgent: boolean; hopsSinceHuman: number },
): Turn {
  if (room.status !== "Active") {
    return {
      agents: [],
      refusal: {
        reason: "RoomPaused",
        message: "This room is not active, so no agent runs.",
        messageAr: "هذه الغرفة غير نشطة، فلا يعمل أي وكيل.",
      },
    };
  }
  if (input.fromAgent) return { agents: [], refusal: AGENT_POST };
  if (room.costCapAed !== null && room.estimatedSpendAed >= room.costCapAed) {
    return {
      agents: [],
      refusal: { reason: "CostCap", message: "Room cost cap reached.", messageAr: "بلغت الغرفة حد التكلفة." },
    };
  }
  const remaining = room.agentHopLimit - input.hopsSinceHuman;
  if (remaining <= 0) return { agents: [], refusal: HOP_LIMIT };

  const agents = participants.filter((participant) => participant.isAgent);
  const named = mentionsIn(input.text, participants);
  const mentioned = named.filter((id) => agents.some((agent) => agent.id === id));
  if (mentioned.length > 0) return { agents: mentioned.slice(0, 1), refusal: null };
  // A person in the room was named: the message is theirs, and the room adds nothing (D163).
  if (named.length > 0) return { agents: [], refusal: null };
  // Somebody named who is not in the room: say so, rather than hand it to another agent.
  const strangers = handlesIn(input.text);
  if (strangers.length > 0) {
    const who = strangers.map((handle) => `@${handle}`).join(", ");
    return {
      agents: [],
      refusal: {
        reason: "NotInRoom",
        message: `No agent answered: ${who} is not in this room. A moderator adds participants.`,
        messageAr: `لم يُجب أي وكيل: ${who} ليس في هذه الغرفة. يضيف المشرف المشاركين.`,
      },
    };
  }
  if (room.turnTaking !== "Autonomous" || agents.length === 0) return { agents: [], refusal: null };
  if (agents.length === 1) return { agents: [agents[0].id], refusal: null };
  const lead = agents.find((agent) => agent.role === "LeadAgent") ?? agents[0];
  return { agents: [], refusal: null, choose: [lead.id, ...agents.filter((agent) => agent !== lead).map((agent) => agent.id)] };
}

/**
 * Whether an agent's reply may still be posted into the room, or why it may not.
 *
 * The same effort limit as `turnFor`, enforced where the messages actually arrive: one
 * human message can start several missions, and a mission that delegates finishes several
 * times, so the count of agent messages is bounded here rather than only at the point a
 * mission starts. The run itself is unaffected — its output is on the run row either way.
 */
export function agentReplyRefusal(room: RoomRules, agentMessagesSinceHuman: number): TurnRefusal | null {
  return agentMessagesSinceHuman >= room.agentHopLimit ? HOP_LIMIT : null;
}
