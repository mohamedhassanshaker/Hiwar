import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sensitiveFieldsIn } from "./privileges";
import { createBudgetInput, updateBudgetInput } from "./schema";
import * as service from "./service";

/**
 * S-71 and S-72 as tools: what the Budgets screens do, offered to an agent working on
 * someone's behalf.
 *
 * A budget is a limit on an agent, so most of what an edit can touch is a decision for a
 * person: the limit itself, when it is in force, and what reaching it does. Those fields
 * escalate on the payload (D58), so an agent asking to raise its own ceiling waits for a
 * person to agree to exactly that change rather than being refused outright or allowed
 * through on a tier the tool claimed for itself.
 */
export const BUDGET_TOOLS: PlatformTool[] = [
  action({
    subject: "budget",
    operation: "list",
    description:
      "Every budget window, with its agent, limit, period, dates, warning percentage, " +
      "what happens at 100%, the estimated spend so far and what the period is on course " +
      "to cost. Also each window's closed periods and change history, and the routes a " +
      "budget may fall to. Every money value is an estimate from token prices, not an " +
      "invoice. Call this first: the id is how an edit names a window, and the version is " +
      "what it has to name back.",
    input: z.object({}),
    permission: "budgets:read",
    run: () => service.loadBudgets(),
  }),

  action({
    subject: "budget",
    operation: "create",
    description:
      "Create a budget window for an agent: its limit in AED, its period, the dates it is " +
      "in force, the percentage to warn at and what to do at 100% — notify, fall to a " +
      "cheaper route, or pause the agent. Windows for one agent may not overlap, and the " +
      "refusal names the one that clashes. Returns the window's id.",
    input: createBudgetInput,
    permission: "budgets:write",
    run: async (input) => ({ budgetId: await service.createBudget(input) }),
  }),

  action({
    subject: "budget",
    operation: "edit",
    description:
      "Change a budget window: its limit, period, dates, warning percentage, what happens " +
      "at 100% and the route it falls to. Name only the fields to change; anything " +
      "omitted is left alone, and an explicit null on the end date makes the window " +
      "open-ended. The agent is not editable — create a window on the other agent " +
      "instead. `expectedVersion` is the version last read; a window somebody has saved " +
      "since is refused, so read it again and retry. Returns what changed, before and " +
      "after, and says whether the agent is left with no limit in force and whether the " +
      "stop at 100% was removed.",
    input: updateBudgetInput,
    permission: "budgets:write",
    // T1 to move a warning threshold, a decision when it raises the limit, shifts the
    // window off today or takes away the stop: the server reads the payload and
    // escalates (D58) rather than the tool claiming one tier for all three.
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateBudget(input),
  }),
];
