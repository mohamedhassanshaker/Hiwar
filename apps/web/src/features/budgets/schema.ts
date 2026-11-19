import { z } from "zod";

import { BUDGET_ACTIONS_AT_100, BUDGET_PERIODS } from "@/db/schema/enums";

/** Requirement 32: the budget action inputs. */

export const saveBudgetInput = z.object({
  /** Present when an existing window is being edited rather than a new one added. */
  budgetId: z.uuid().optional(),
  agentCode: z.string().min(1),
  // `UC-71.1-06`: a limit of zero or less is not a budget.
  limitAed: z.number().positive().max(1_000_000),
  period: z.enum(BUDGET_PERIODS),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable(),
  // 100 would warn at the same moment the limit is reached, which is not a warning.
  warnAtPct: z.number().int().min(1).max(99),
  actionAt100: z.enum(BUDGET_ACTIONS_AT_100),
  /** `UC-71.1-05`: the route to fall to, which only that action uses. */
  cheaperRouteAlias: z.string().trim().min(1).max(60).nullish(),
});

export type SaveBudgetInput = z.infer<typeof saveBudgetInput>;

/** `UC-71.1-03`: a new budget window. The agent it is for is fixed when it is created. */
export const createBudgetInput = saveBudgetInput.omit({ budgetId: true });

export type CreateBudgetInput = z.infer<typeof createBudgetInput>;

/**
 * `UC-71.1-04`: one budget window as a patch — the one write path for a budget.
 *
 * Name the fields to change and nothing else: an omitted field is left alone, and an
 * explicit null on the end date makes the window open-ended. The agent is not in the
 * patch: a window belongs to the agent it was created for, and moving it to another
 * agent would be two edits pretending to be one. `expectedVersion` is the version last
 * read and goes in the SQL `WHERE`, so a window somebody has saved since is refused.
 */
export const updateBudgetInput = z
  .object({
    budgetId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    /** Sensitive: this is how much the agent may spend. */
    limitAed: z.number().positive().max(1_000_000).optional(),
    period: z.enum(BUDGET_PERIODS).optional(),
    /** Sensitive: a window moved off today leaves the agent with no limit in force. */
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    warnAtPct: z.number().int().min(1).max(99).optional(),
    /** Sensitive: it is what happens at 100%, including whether the agent stops. */
    actionAt100: z.enum(BUDGET_ACTIONS_AT_100).optional(),
    cheaperRouteAlias: z.string().trim().min(1).max(60).nullish(),
  })
  .strict()
  .refine(
    (patch) =>
      [
        "limitAed",
        "period",
        "effectiveFrom",
        "effectiveTo",
        "warnAtPct",
        "actionAt100",
        "cheaperRouteAlias",
      ].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  );

export type UpdateBudgetInput = z.infer<typeof updateBudgetInput>;

/** Which budget window an action is about. */
export const budgetIdInput = z.object({ budgetId: z.uuid() });
