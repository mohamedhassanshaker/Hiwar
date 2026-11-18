import * as repository from "./repository";

/** What accounting one run did to its agent's budget. */
export type SpendOutcome = {
  /** Null when the agent has no budget in force; nothing is recorded then. */
  budgetId: string | null;
  spent: number;
  limit: number;
  /** `UC-72.1-04`: the warning percentage was crossed by this run. */
  warned: boolean;
  /** `UC-72.1-05` and `-06`: the limit was reached, and what was done about it. */
  hardLimit: boolean;
  action: string | null;
};

/**
 * `UC-72.1-04` … `-07`: add one run to its agent's budget, and act on what that crosses.
 *
 * Called from the platform MCP tool a run finishes through, which is the one place a run's
 * cost becomes a fact. Nothing sweeps for crossings afterwards: a threshold is crossed by
 * a particular run, and that run is what pays for noticing.
 *
 * This runs on the platform's own behalf rather than a person's — the run already had its
 * permission checked when it started, and the agent's budget is not the asker's to permit.
 */
export async function recordRunSpend(input: {
  agentId: string;
  amountAed: number;
  at?: Date;
  actedBy: string;
}): Promise<SpendOutcome> {
  const at = input.at ?? new Date();
  const budget = await repository.budgetInForce(input.agentId, at);
  if (!budget) {
    return { budgetId: null, spent: 0, limit: 0, warned: false, hardLimit: false, action: null };
  }

  const { periodId, before, after } = await repository.addSpend(
    budget,
    input.amountAed,
    at,
    input.actedBy,
  );
  const warnAt = (budget.limit * budget.warnAtPct) / 100;

  const outcome: SpendOutcome = {
    budgetId: budget.id,
    spent: after,
    limit: budget.limit,
    warned: false,
    hardLimit: false,
    action: budget.actionAt100,
  };

  // Crossed by this run, not merely above the line: a budget already past its warning does
  // not warn again every run for the rest of the period.
  if (budget.limit > 0 && before < warnAt && after >= warnAt) {
    if (!(await repository.eventRaised(periodId, "WarningSent"))) {
      const eventId = await repository.raiseEvent(
        {
          budgetId: budget.id,
          periodId,
          type: "WarningSent",
          detailEn: `Estimated spend reached ${budget.warnAtPct}% of the limit.`,
          detailAr: `بلغ الإنفاق التقديري ${budget.warnAtPct}٪ من الحد.`,
        },
        input.actedBy,
      );
      await notifyOwner(input.agentId, eventId, input.actedBy);
      outcome.warned = true;
    }
  }

  if (budget.limit > 0 && before < budget.limit && after >= budget.limit) {
    if (!(await repository.eventRaised(periodId, "HardLimitReached"))) {
      const eventId = await repository.raiseEvent(
        {
          budgetId: budget.id,
          periodId,
          type: "HardLimitReached",
          detailEn: `Estimated spend reached the limit of AED ${budget.limit.toFixed(2)}.`,
          detailAr: `بلغ الإنفاق التقديري الحد ${budget.limit.toFixed(2)} د.إ.`,
        },
        input.actedBy,
      );
      // `UC-72.1-06`: notify-only is exactly that — the runs carry on.
      if (budget.actionAt100 === "PauseAgent") {
        await repository.pauseAgent(input.agentId, input.actedBy);
      }
      await notifyOwner(input.agentId, eventId, input.actedBy);
      outcome.hardLimit = true;
    }
  }
  return outcome;
}

/** Tell whoever the agent reports to. An agent reporting to an agent has nobody to tell. */
async function notifyOwner(agentId: string, eventId: string, actedBy: string): Promise<void> {
  const owner = await repository.ownerOfAgent(agentId);
  if (!owner) return;
  await repository.notifyBudget({ personId: owner, eventId }, actedBy);
}
