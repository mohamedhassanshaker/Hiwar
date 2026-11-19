import { fieldRulesTable, type FieldRule } from "@/lib/field-rules";

import type { UpdateBudgetInput } from "./schema";

/**
 * The field rules of a budget window: what each editable field needs, and whether an
 * agent may set it without a person agreeing first.
 *
 * The **privilege** applies to whoever asks, the console included; **sensitivity** is only
 * about an agent acting unattended.
 *
 * A budget is a limit on the agent itself, so most of this table is sensitive: the limit
 * is how much it may spend, the window is when that limit is in force at all, and the
 * action at 100% is whether reaching it stops anything. An agent that could set them
 * unattended could lift its own ceiling, which is the one thing a ceiling is for.
 */
export const BUDGET_FIELD_RULES: Record<BudgetField, FieldRule> = {
  limitAed: {
    privilege: "budgets:write",
    sensitive: true,
    reason: "The limit is how much the agent may spend in a period.",
  },
  period: { privilege: "budgets:write", sensitive: false },
  effectiveFrom: {
    privilege: "budgets:write",
    sensitive: true,
    reason: "A window that starts later leaves the agent with no limit in force until it does.",
  },
  effectiveTo: {
    privilege: "budgets:write",
    sensitive: true,
    reason: "Ending the window leaves the agent with no limit in force, which is no limit at all.",
  },
  warnAtPct: { privilege: "budgets:write", sensitive: false },
  actionAt100: {
    privilege: "budgets:write",
    sensitive: true,
    reason: "This is what reaching the limit does, including whether the agent is paused.",
  },
  cheaperRouteAlias: { privilege: "budgets:write", sensitive: false },
};

export type BudgetField =
  | "limitAed"
  | "period"
  | "effectiveFrom"
  | "effectiveTo"
  | "warnAtPct"
  | "actionAt100"
  | "cheaperRouteAlias";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateBudgetInput): BudgetField[] {
  return (Object.keys(BUDGET_FIELD_RULES) as BudgetField[]).filter((field) => field in patch);
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateBudgetInput): BudgetField[] {
  return fieldsIn(patch).filter((field) => BUDGET_FIELD_RULES[field].sensitive);
}

/** The module's field rules as a table, for review. */
export function budgetFieldRulesTable(): string {
  return fieldRulesTable("budget", BUDGET_FIELD_RULES);
}
