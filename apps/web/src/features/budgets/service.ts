import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

export { BudgetRejected } from "./errors";
export { saveBudget, createBudget, type BudgetDiff, updateBudget } from "./write-service";
export { type SpendOutcome, recordRunSpend } from "./spend-service";

/** S-71 the budget list, S-72 one budget with its history. */

/** A budget window id, checked before it reaches a uuid column. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadBudgets(open?: string) {
  await requirePermission("budgets:read");
  const [budgets, details, counts, routes] = await Promise.all([
    repository.listBudgets(),
    // The history of the window being viewed, a uuid, or of none.
    repository.readDetails(open && UUID.test(open) ? [open] : []),
    repository.countBudgets(),
    repository.routeAliases(),
  ]);
  return { budgets, details, counts, routes };
}

/**
 * `UC-71.1-08`: the budgets as a file, with every money column labelled an estimate.
 *
 * Every money value in this platform comes from token prices, not from an invoice. A file
 * that leaves the console without saying so is the one place that distinction gets lost,
 * because a spreadsheet keeps no context.
 */
export async function exportBudgets(): Promise<{ filename: string; csv: string }> {
  const session = await requirePermission("budgets:read");
  const budgets = await repository.listBudgets();

  const header = [
    "agent",
    "period",
    "effective_from",
    "effective_to",
    "status",
    "limit_aed_estimated",
    "spend_aed_estimated",
    "forecast_aed_estimated",
    "warn_at_pct",
    "action_at_100",
  ];
  const rows = budgets.map((budget) => [
    budget.a,
    budget.per,
    budget.from,
    budget.to ?? "",
    budget.status,
    budget.lim.toFixed(2),
    budget.spent.toFixed(2),
    budget.forecast.toFixed(2),
    String(budget.soft),
    budget.hard,
  ]);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "exports:create",
    objectType: "AgentBudget",
    objectLabel: "budgets",
    // The count, never the rows: a trail that copied what left would defeat controlling it.
    detail: { rows: rows.length },
  });

  return {
    filename: "budgets-estimated.csv",
    csv: [header, ...rows].map((row) => row.map(csvCell).join(",")).join(String.fromCharCode(10)),
  };
}

/** A CSV cell: quoted when it has to be, so a comma in a value cannot shift a column. */
function csvCell(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
