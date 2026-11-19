/** Budgets and estimated costs (S-71, S-72). */

export type Budget = {
  /** The budget window's own id: an agent may have more than one, over time. */
  id: string;
  /** The agent's code. */
  a: string;
  lim: number;
  /** Daily, Weekly, Monthly or Quarterly. */
  per: string;
  /** Effective from and to, `yyyy-mm-dd`. */
  from: string;
  to: string | null;
  soft: number;
  /** NotifyOnly, SwitchToCheaperAlias or PauseAgent. */
  hard: string;
  /** Estimated spend in the current period. */
  spent: number;
  /** Active, Planned or Expired, decided against the database clock. */
  status: string;
  /**
   * What the current period is on course to cost: the spend so far, scaled by how much of
   * the period is left. Computed against the database clock, so the screen stays pure.
   */
  forecast: number;
  /** `UC-71.1-05`: the alias this budget falls to at 100%, when that is the action. */
  cheaperRoute: string | null;
  /** The row version an edit has to name back, so a concurrent save is refused. */
  v: number;
};

/** One closed or current period of a budget. */
export type BudgetPeriod = {
  startsAt: string;
  endsAt: string;
  limit: number;
  spent: number;
  runs: number;
  /** WarningSent, HardLimitReached or ActionApplied, if anything happened. */
  event: string | null;
};

export type BudgetChange = { at: string; by: string; descriptionEn: string; descriptionAr: string };

export type BudgetDetail = { periods: BudgetPeriod[]; changes: BudgetChange[] };

export type BudgetCounts = { monthToDate: number; withBudget: number; agents: number; overNinety: number; endingSoon: number };
