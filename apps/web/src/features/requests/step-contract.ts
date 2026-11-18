import { actionsOf, type Rule } from "./routing";

/**
 * What a request step expects back from the agent that works it (D41).
 *
 * A mission has no objective definition of "done" of its own — a model says it has
 * finished when it has given up — so for a request step the platform uses the only one
 * that exists: the step's own contract, as the pinned published version declares it. A
 * step offers a named set of actions and nothing else moves a request on, so "did the
 * work" means "named one of them".
 *
 * Expressed as JSON Schema because that is what the agent service validates the mission's
 * final output against (`harness/activities/verify.py`, `step_contract`), and because it
 * is the standard at that edge. The shape is `request_step_action_create`'s own input minus
 * the request key: the tool and the contract cannot disagree about what acting on a step is.
 *
 * Derived rather than stored: the actions are already in the version's routing rules, and
 * a second column saying the same thing is a second thing to keep true.
 */

/**
 * Returning the request to its requester (`request_change_request_create`), which every step
 * offers beside its own actions, as the console's Request changes does.
 */
export const RETURN_ACTION = "Return";
/** Ending the request as Rejected (`request_rejection_create`), which every step offers (D218). */
export const REJECT_ACTION = "Reject";

export type StepContract = {
  /** The actions the step offers, in the designer's order. */
  actions: string[];
  /** The JSON Schema the mission's final output has to match to count as complete. */
  outputSchema: Record<string, unknown>;
};

/**
 * The contract for one step, or `null` when the step declares none.
 *
 * A step whose rules are all conditions — and a terminal step, which has no rules at all —
 * offers the agent no action to name, so there is nothing objective to check and the
 * mission is judged on the rest of D102 alone. Returning a contract nothing could satisfy
 * would fail every such mission.
 */
export function stepContract(rules: Rule[], stepName: string | null = null): StepContract | null {
  const actions = actionsOf(rules);
  if (actions.length === 0) return null;
  return {
    actions,
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: stepName ? `Result of the "${stepName}" step` : "Step result",
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: [...new Set([...actions, RETURN_ACTION, REJECT_ACTION])] },
        comment: { type: "string", maxLength: 2000 },
      },
    },
  };
}

/** A step agent's decision as its final output names it. */
export type StepDecision = { action: string; comment: string };

/**
 * The decision a step mission finished with, or `null` when its output is not a step result:
 * the contract's JSON object with a non-empty `action` (D385).
 */
export function stepDecisionOf(output: string): StepDecision | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { action, comment } = parsed as { action?: unknown; comment?: unknown };
  if (typeof action !== "string" || !action.trim()) return null;
  return { action: action.trim(), comment: typeof comment === "string" ? comment.trim() : "" };
}

/**
 * The mission prompt for a step with a contract: the agent works the step as the person it
 * waits on would, with its own instructions, skills and tools, and decides it (D215).
 *
 * The schema is stated to the agent so it produces the shape, and validated in code
 * afterwards so the shape is not taken on trust: telling a model what is expected and
 * checking what arrived are two different jobs, and only the second one is a control.
 */
export function stepMissionPrompt(requestKey: string, stepName: string | null, contract: StepContract): string {
  const actions = contract.actions.map((action) => `"${action}"`).join(", ");
  return (
    `Work the "${stepName ?? "current"}" step of request ${requestKey}, as the person this step ` +
    `waits on would, using your instructions, skills and tools.\n\n` +
    `1. Read the request with request_read, and anything attached to it.\n` +
    `2. Do what the step needs, from what you know and from the tools you call. Keep what you ` +
    `found and what each tool returned: it is the comment on the decision you take.\n` +
    `3. Decide, and say why in the comment:\n` +
    `- the step's approving action, with request_step_action_create, when the work is done and ` +
    `the request is complete and correct;\n` +
    `- "${RETURN_ACTION}", with request_change_request_create, when details are missing or ` +
    `incorrect, saying what the requester must add or correct;\n` +
    `- "${REJECT_ACTION}", with request_rejection_create, or the step's own rejecting action where it ` +
    `has one, when the request duplicates another (request_list finds them) or is the wrong request.\n` +
    `The step's actions are ${actions}. Then finish with the result as JSON matching this schema ` +
    `and nothing else:\n${JSON.stringify(contract.outputSchema)}`
  );
}
