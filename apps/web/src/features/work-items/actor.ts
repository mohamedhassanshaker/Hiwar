import type { Session } from "@/lib/session";

/**
 * Who a work item's activity names: the agent when one made the call, otherwise the person.
 *
 * An agent's call carries its run (the MCP server sets it from the run token); an
 * integration client acts as the person who owns it and carries none.
 */
export function activityActor(session: Session): { actorType: string; actorId: string } {
  return session.actingAgent?.runId
    ? { actorType: "Agent", actorId: session.actingAgent.id }
    : { actorType: "Person", actorId: session.personId };
}
