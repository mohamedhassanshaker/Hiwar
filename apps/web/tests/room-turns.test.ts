import { describe, expect, it } from "vitest";

import { agentReplyRefusal, mentionsIn, postRefusal, turnFor, type Participant, type RoomRules } from "@/features/rooms/turns";

/**
 * S-23: who answers in a room, and when the room stops answering.
 *
 * These are the rules that bound a room: without them a room of agents talks to itself
 * until somebody notices the bill.
 */

const people: Participant[] = [
  { id: "u1", isAgent: false, role: "Owner" },
  { id: "u2", isAgent: false, role: "Member" },
  { id: "u3", isAgent: false, role: "Observer" },
];
const agents: Participant[] = [
  { id: "sup", isAgent: true, role: "LeadAgent" },
  { id: "kb", isAgent: true, role: "MemberAgent" },
];
const everyone = [...people, ...agents];

const room = (over: Partial<RoomRules> = {}): RoomRules => ({
  status: "Active",
  turnTaking: "MentionOnly",
  agentHopLimit: 6,
  costCapAed: null,
  estimatedSpendAed: 0,
  ...over,
});

describe("who may post in a room", () => {
  it("UC-23.1-11 an observer reads the room and does not post in it", () => {
    expect(postRefusal(room(), everyone, "u3")?.reason).toBe("Observer");
    expect(postRefusal(room(), everyone, "u2")).toBeNull();
  });

  it("UC-23.3-06 a closed room takes no more messages", () => {
    expect(postRefusal(room({ status: "Closed" }), everyone, "u1")?.reason).toBe("RoomClosed");
    // `UC-22.1-05`: somebody who is not in the room cannot post into it either.
    expect(postRefusal(room(), everyone, "stranger")?.reason).toBe("NotParticipant");
  });
});

describe("who answers in a room", () => {
  it("UC-23.1-02 UC-22.2-02 Mention only brings in exactly the agent that was named", () => {
    const turn = turnFor(room(), everyone, {
      text: "@sup can you draft the follow-up?",
      fromAgent: false,
      hopsSinceHuman: 0,
    });
    expect(turn.agents).toEqual(["sup"]);

    // Nothing is named, so nothing answers.
    expect(turnFor(room(), everyone, { text: "thanks all", fromAgent: false, hopsSinceHuman: 0 }).agents).toEqual([]);

    // A mention of somebody who is not in the room reaches nobody.
    expect(mentionsIn("@nobody hello", everyone)).toEqual([]);
    expect(mentionsIn("@u2 and @kb", everyone)).toEqual(["u2", "kb"]);
  });

  it("UC-23.3-02 D289 Autonomous answers a message that names nobody, choosing among several agents", () => {
    const autonomous = room({ turnTaking: "Autonomous" });
    const ask = { text: "what is the status?", fromAgent: false, hopsSinceHuman: 0 };
    // Several agents: the platform chooses one, the lead first as the fallback.
    expect(turnFor(autonomous, everyone, ask)).toEqual({ agents: [], refusal: null, choose: ["sup", "kb"] });
    const leaderless = [...people, ...agents.map((agent) => ({ ...agent, role: "MemberAgent" }))];
    expect(turnFor(autonomous, leaderless, ask).choose).toEqual(["sup", "kb"]);
    // One agent answers without a choice.
    expect(turnFor(autonomous, [...people, agents[1]], ask)).toEqual({ agents: ["kb"], refusal: null });
    // A mention still reaches the agent it names, with no choice made.
    expect(turnFor(autonomous, everyone, { ...ask, text: "@kb what do the docs say?" })).toEqual({ agents: ["kb"], refusal: null });
  });

  it("D66 an agent's own post never starts another agent, whatever the policy", () => {
    // The room is wide open — Autonomous, nothing spent, no turn used — and it still
    // answers nothing, because the message came from an agent. Agent-to-agent work is
    // delegation inside a mission, where the budget and the approval gate hold.
    for (const turnTaking of ["MentionOnly", "Autonomous"]) {
      const turn = turnFor(room({ turnTaking }), everyone, {
        text: "@sup @kb over to you both",
        fromAgent: true,
        hopsSinceHuman: 0,
      });
      expect(turn.agents).toEqual([]);
      expect(turn.refusal?.reason).toBe("AgentPost");
    }
  });

  it("UC-23.1-08 D73 a human message buys a bounded number of agent messages", () => {
    const lead = room({ turnTaking: "Autonomous", agentHopLimit: 6 });
    const atLimit = turnFor(lead, everyone, { text: "carry on", fromAgent: false, hopsSinceHuman: 6 });
    expect(atLimit.agents).toEqual([]);
    expect(atLimit.refusal?.reason).toBe("HopLimit");
    expect(atLimit.refusal?.message).toMatch(/hop limit/i);

    // Under the limit the same message is answered.
    expect(turnFor(lead, everyone, { text: "@sup carry on", fromAgent: false, hopsSinceHuman: 5 }).agents).toEqual(["sup"]);

    // One turn left still answers, with one agent.
    const tight = room({ turnTaking: "Autonomous", agentHopLimit: 1 });
    expect(turnFor(tight, everyone, { text: "everyone please", fromAgent: false, hopsSinceHuman: 0 }).choose).toEqual(["sup", "kb"]);

    // The same limit bounds the replies that land, not only the missions that start.
    expect(agentReplyRefusal(lead, 5)).toBeNull();
    expect(agentReplyRefusal(lead, 6)?.reason).toBe("HopLimit");
  });

  it("UC-23.1-09 a room at its cost cap stops answering, whatever the policy says", () => {
    const capped = room({ turnTaking: "Autonomous", costCapAed: 25, estimatedSpendAed: 25 });
    const turn = turnFor(capped, everyone, { text: "@sup one more", fromAgent: false, hopsSinceHuman: 0 });
    expect(turn.agents).toEqual([]);
    expect(turn.refusal?.reason).toBe("CostCap");

    // Under the cap it answers.
    const under = room({ turnTaking: "Autonomous", costCapAed: 25, estimatedSpendAed: 24.99 });
    expect(turnFor(under, everyone, { text: "@sup go", fromAgent: false, hopsSinceHuman: 0 }).agents).toEqual(["sup"]);
  });

  it("UC-22.2-06 a room that is not active runs no agent at all", () => {
    const paused = room({ status: "Paused", turnTaking: "Autonomous" });
    const turn = turnFor(paused, everyone, { text: "@sup hello", fromAgent: false, hopsSinceHuman: 0 });
    expect(turn.agents).toEqual([]);
    expect(turn.refusal?.reason).toBe("RoomPaused");
  });

  it("a person's message gets a note only when it names somebody not in the room", () => {
    const ask = { text: "generate excel file with tahseel features", fromAgent: false, hopsSinceHuman: 0 };

    // D213: a room of people only is a conversation; it gets no note.
    expect(turnFor(room({ turnTaking: "Autonomous" }), people, ask)).toEqual({ agents: [], refusal: null });

    // D214: Mention only, no agent named: the message is between people.
    expect(turnFor(room(), everyone, ask)).toEqual({ agents: [], refusal: null });

    // A message to a person in the room is addressed, so the room adds nothing.
    expect(turnFor(room(), everyone, { ...ask, text: "@u2 can you check?" })).toEqual({ agents: [], refusal: null });
  });

  it("D163 a message that names a person is theirs: the agents stay out, and a stranger gets a note", () => {
    const named: Participant[] = [
      { id: "11111111-1111-4111-8111-111111111111", isAgent: false, role: "Member", handle: "noura" },
      { id: "sup", isAgent: true, role: "LeadAgent", handle: "sup" },
    ];
    const autonomous = room({ turnTaking: "Autonomous" });
    const say = (text: string) => turnFor(autonomous, named, { text, fromAgent: false, hopsSinceHuman: 0 });

    // Named by handle or by id, the person is addressed and no agent answers.
    expect(say("@noura send me the details")).toEqual({ agents: [], refusal: null });
    expect(say("@11111111-1111-4111-8111-111111111111 send me the details")).toEqual({ agents: [], refusal: null });
    expect(mentionsIn("thanks @noura.", named)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    // Somebody who is not in the room: no agent's to answer, and the room says why.
    const stranger = say("@khalid send me a report");
    expect(stranger.agents).toEqual([]);
    expect(stranger.refusal).toMatchObject({ reason: "NotInRoom" });
    expect(stranger.refusal?.message).toContain("@khalid is not in this room");
    // Naming nobody goes to the room's one agent.
    expect(say("what is the status?").agents).toEqual(["sup"]);
    // An email address names nobody: its @ is inside a word (owner, 2026-11-03).
    expect(say("create the user with email mhassan@gmail.com")).toEqual({ agents: ["sup"], refusal: null });
    expect(mentionsIn("mail noura@example.com or ask @noura", named)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(say("(@noura) please check")).toEqual({ agents: [], refusal: null });
  });

  it("D213 one agent acts on a message, however many agents the room has", () => {
    const say = (rules: RoomRules, text: string) => turnFor(rules, everyone, { text, fromAgent: false, hopsSinceHuman: 0 }).agents;
    const autonomous = room({ turnTaking: "Autonomous" });

    // A mention names who acts; of several named, the first.
    expect(say(autonomous, "@kb only you")).toEqual(["kb"]);
    expect(say(autonomous, "@kb and @sup compare")).toEqual(["kb"]);
    expect(say(room(), "@sup @kb draft it")).toEqual(["sup"]);
  });
});
