import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as repository from "./repository";

/** How long a room waits for the choice before its lead agent answers instead. */
const CHOOSE_TIMEOUT_MS = 15_000;

/**
 * D289: which of an Autonomous room's agents answers a message that names none.
 *
 * The agent service asks the Decision route `agent-choice` (D290), whose answer may only be one
 * of `candidates`. The lead, `candidates[0]`, answers when the route is unavailable or gives no
 * valid choice, so a message is never left unanswered for want of a classification.
 */
export async function chooseAgent(input: { text: string; candidates: string[]; conversation: string[] }): Promise<string> {
  const [lead] = input.candidates;
  const url = env().AGENT_SERVICE_URL;
  if (!url) return lead;
  try {
    const agents = await repository.agentPurposes(input.candidates);
    const response = await fetch(`${url}/classify/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(CHOOSE_TIMEOUT_MS),
      body: JSON.stringify({ text: input.text, agents, conversation: input.conversation }),
    });
    if (!response.ok) throw new Error(`the classification route answered ${response.status}`);
    const chosen = ((await response.json()) as { agent_code?: string }).agent_code ?? "";
    if (!input.candidates.includes(chosen)) throw new Error(`the classification route chose ${chosen || "nobody"}`);
    logger().info({ chosen, candidates: input.candidates }, "a room agent was chosen for a message");
    return chosen;
  } catch (problem) {
    logger().warn({ lead, problem: String(problem) }, "no room agent was chosen; the lead agent answers");
    return lead;
  }
}
