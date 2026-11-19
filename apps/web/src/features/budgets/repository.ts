import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { queueAlertEmails } from "@/db/queries/mail";
import { enqueueMailJobs } from "@/lib/valkey";
import { outer } from "@/db/outer";
import type { Budget, BudgetCounts, BudgetDetail, BudgetPeriod } from "./types";

/** The only module in `budgets` that touches Drizzle. */

/** The period that contains today, which is what "spend this period" means. */
const currentSpend = sql<number>`(
  select coalesce(bp.estimated_spend_aed, 0) from gov.budget_period bp
  where bp.budget_id = ${s.agentBudget.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc limit 1
)::float8`;

/**
 * What the period is on course to cost: the spend so far, scaled by the share of the
 * period that has elapsed.
 */
const forecast = sql<number>`(
  select case
    when bp.period_start >= now() then 0
    else coalesce(bp.estimated_spend_aed, 0)
         * (extract(epoch from (bp.period_end - bp.period_start)) /
            greatest(extract(epoch from (now() - bp.period_start)), 86400))
  end
  from gov.budget_period bp
  where bp.budget_id = ${s.agentBudget.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc limit 1
)::float8`;

/** Data model section 18: a budget is planned, active or expired against today. */
const status = sql<string>`case
  when ${s.agentBudget.effectiveFrom} > now() then 'Planned'
  when ${s.agentBudget.effectiveTo} is not null and ${s.agentBudget.effectiveTo} < now() then 'Expired'
  else 'Active' end`;

/**
 * Every budget window with its agent's code, this period's estimated spend, the forecast, the
 * status against today and the cheaper route's alias, highest spend first.
 */
export async function listBudgets(): Promise<Budget[]> {
  const rows = await dbRo()
    .select({
      id: s.agentBudget.id,
      a: s.agent.code,
      lim: sql<number>`${s.agentBudget.limitAed}::float8`,
      per: s.agentBudget.period,
      from: s.agentBudget.effectiveFrom,
      to: s.agentBudget.effectiveTo,
      soft: s.agentBudget.warnAtPct,
      hard: s.agentBudget.actionAt100,
      spent: currentSpend,
      forecast,
      status,
      cheaperRoute: sql<string | null>`(
        select r.alias from ai.route r where r.id = ${s.agentBudget.cheaperRouteId}
      )`,
      v: s.agentBudget.version,
    })
    .from(s.agentBudget)
    .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
    .orderBy(desc(currentSpend));

  return rows.map((row) => ({
    id: row.id,
    a: row.a,
    lim: row.lim,
    per: row.per,
    from: row.from.toISOString().slice(0, 10),
    to: row.to?.toISOString().slice(0, 10) ?? null,
    soft: row.soft,
    hard: row.hard,
    // A budget whose first period has not started has no row to read, so the subquery is
    // null however it coalesces inside itself.
    spent: row.spent ?? 0,
    forecast: row.forecast ?? 0,
    status: row.status,
    cheaperRoute: row.cheaperRoute,
    v: row.v,
  }));
}

/**
 * The period history of the named budget windows, oldest first with the latest event each
 * period raised, and their change logs, newest first, keyed by window id. Read for the window
 * being viewed only (D349): a window's history grows every month and with every edit.
 */
export async function readDetails(budgetIds: string[]): Promise<Record<string, BudgetDetail>> {
  if (budgetIds.length === 0) return {};
  const budgets = await dbRo()
    .select({ id: s.agentBudget.id, limit: sql<number>`${s.agentBudget.limitAed}::float8` })
    .from(s.agentBudget)
    .where(inArray(s.agentBudget.id, budgetIds));
  const ids = budgets.map((budget) => budget.id);
  if (ids.length === 0) return {};

  const periods = await dbRo()
    .select({
      budgetId: s.budgetPeriod.budgetId,
      startsAt: s.budgetPeriod.periodStart,
      endsAt: s.budgetPeriod.periodEnd,
      spent: sql<number>`${s.budgetPeriod.estimatedSpendAed}::float8`,
      runs: s.budgetPeriod.runs,
      event: sql<string | null>`(select be.type from gov.budget_event be where be.period_id = ${outer(s.budgetPeriod.id)} order by be.at desc limit 1)`,
    })
    .from(s.budgetPeriod)
    .where(inArray(s.budgetPeriod.budgetId, ids))
    .orderBy(asc(s.budgetPeriod.periodStart));

  const changes = await dbRo()
    .select({
      budgetId: s.budgetChange.budgetId,
      at: s.budgetChange.at,
      by: s.budgetChange.changedBy,
      descriptionEn: s.budgetChange.descriptionEn,
      descriptionAr: s.budgetChange.descriptionAr,
    })
    .from(s.budgetChange)
    .where(inArray(s.budgetChange.budgetId, ids))
    .orderBy(desc(s.budgetChange.at));

  return Object.fromEntries(
    budgets.map((budget) => [
      budget.id,
      {
        periods: periods
          .filter((period) => period.budgetId === budget.id)
          .map<BudgetPeriod>((period) => ({
            startsAt: period.startsAt.toISOString(),
            endsAt: period.endsAt.toISOString(),
            limit: budget.limit,
            spent: period.spent,
            runs: period.runs,
            event: period.event,
          })),
        changes: changes
          .filter((change) => change.budgetId === budget.id)
          .map((change) => ({
            at: change.at.toISOString(),
            by: change.by ?? "",
            descriptionEn: change.descriptionEn ?? "",
            descriptionAr: change.descriptionAr ?? "",
          })),
      },
    ]),
  );
}

/**
 * The Budgets screen's figures: this period's spend over active budgets, agents with an active
 * budget out of all agents, active budgets over 90% of their limit, and windows ending within
 * 90 days. Today comes from the database's clock.
 */
export async function countBudgets(): Promise<BudgetCounts> {
  const budgets = await listBudgets();
  const [agents] = await dbRo().select({ count: sql<number>`count(*)::int` }).from(s.agent);
  const active = budgets.filter((budget) => budget.status === "Active");
  const [window] = await dbRo().execute<{ today: string; soon: string }>(
    sql`select to_char(now(), 'YYYY-MM-DD') as today, to_char(now() + interval '90 days', 'YYYY-MM-DD') as soon`,
  ).then((result) => result.rows);
  const today = window.today;
  const soon = window.soon;
  return {
    monthToDate: active.reduce((sum, budget) => sum + budget.spent, 0),
    withBudget: active.length,
    agents: agents?.count ?? 0,
    overNinety: active.filter((budget) => budget.lim > 0 && budget.spent / budget.lim > 0.9).length,
    endingSoon: budgets.filter((budget) => budget.to !== null && budget.to >= today && budget.to <= soon).length,
  };
}

/** `UC-71.1-07`: a window of the same agent that overlaps the one being saved. */
export async function overlappingBudget(input: {
  agentCode: string;
  from: Date;
  to: Date | null;
  exceptId?: string;
}): Promise<{ id: string; from: string; to: string | null } | null> {
  const rows = await dbRo()
    .select({
      id: s.agentBudget.id,
      from: s.agentBudget.effectiveFrom,
      to: s.agentBudget.effectiveTo,
    })
    .from(s.agentBudget)
    .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
    .where(
      and(
        eq(s.agent.code, input.agentCode),
        // Two half-open windows overlap unless one ends at or before the other starts.
        or(isNull(s.agentBudget.effectiveTo), gt(s.agentBudget.effectiveTo, input.from)),
        input.to ? lt(s.agentBudget.effectiveFrom, input.to) : sql`true`,
      ),
    );

  const clash = rows.find((row) => row.id !== input.exceptId);
  return clash
    ? {
        id: clash.id,
        from: clash.from.toISOString().slice(0, 10),
        to: clash.to?.toISOString().slice(0, 10) ?? null,
      }
    : null;
}

/** One budget window as an edit reads it, before the patch is applied. */
export async function readBudget(budgetId: string): Promise<{
  id: string;
  agentId: string;
  agentCode: string;
  limitAed: number;
  period: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  warnAtPct: number;
  actionAt100: string;
  cheaperRouteAlias: string | null;
  version: number;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.agentBudget.id,
      agentId: s.agentBudget.agentId,
      agentCode: s.agent.code,
      limitAed: sql<number>`${s.agentBudget.limitAed}::float8`,
      period: s.agentBudget.period,
      effectiveFrom: s.agentBudget.effectiveFrom,
      effectiveTo: s.agentBudget.effectiveTo,
      warnAtPct: s.agentBudget.warnAtPct,
      actionAt100: s.agentBudget.actionAt100,
      cheaperRouteAlias: sql<string | null>`(
        select r.alias from ai.route r where r.id = ${s.agentBudget.cheaperRouteId}
      )`,
      version: s.agentBudget.version,
    })
    .from(s.agentBudget)
    .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
    .where(eq(s.agentBudget.id, budgetId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
  };
}

/** The columns one budget window is written from, in the shape both writes take. */
type BudgetValues = {
  limitAed: number;
  period: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  warnAtPct: number;
  actionAt100: string;
  cheaperRouteId: string | null;
};

/**
 * The `agent_budget` columns one write sets. Dates are stored at UTC midnight, and the cheaper
 * route is kept only when the action at 100% is `SwitchToCheaperAlias`.
 */
function columnsOf(values: BudgetValues, personId: string) {
  return {
    limitAed: values.limitAed,
    period: values.period,
    effectiveFrom: new Date(`${values.effectiveFrom}T00:00:00Z`),
    effectiveTo: values.effectiveTo ? new Date(`${values.effectiveTo}T00:00:00Z`) : null,
    warnAtPct: values.warnAtPct,
    actionAt100: values.actionAt100,
    cheaperRouteId: values.actionAt100 === "SwitchToCheaperAlias" ? values.cheaperRouteId : null,
    updatedAt: new Date(),
    updatedBy: personId,
  };
}

/** The line the budget's own history shows for one write. */
function changeRow(budgetId: string, values: BudgetValues, personId: string) {
  return {
    budgetId,
    at: new Date(),
    changedBy: personId,
    descriptionEn: `Limit set to AED ${values.limitAed.toFixed(2)} per ${values.period.toLowerCase()}.`,
    descriptionAr: `تم تعيين الحد إلى ${values.limitAed.toFixed(2)} د.إ لكل ${values.period}.`,
    createdBy: personId,
    updatedBy: personId,
  };
}

/**
 * Creates a budget window for an agent, and the change line that says what moved. Returns its
 * id.
 */
export async function insertBudget(
  input: BudgetValues & { agentCode: string },
  personId: string,
): Promise<string> {
  return db().transaction(async (tx) => {
    const [agent] = await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, input.agentCode)).limit(1);
    if (!agent) throw new Error(`No agent ${input.agentCode}.`);
    const [created] = await tx
      .insert(s.agentBudget)
      .values({ ...columnsOf(input, personId), agentId: agent.id, createdBy: personId })
      .returning({ id: s.agentBudget.id });
    await tx.insert(s.budgetChange).values(changeRow(created.id, input, personId));
    return created.id;
  });
}

/**
 * Rewrites one budget window, with the version in the `WHERE`.
 *
 * Returns false when no row is at `expectedVersion`, which is a concurrent save: two
 * admins moving the same limit must not silently lose one of the changes.
 */
export async function updateBudget(
  budgetId: string,
  expectedVersion: number,
  values: BudgetValues,
  personId: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.agentBudget)
      .set(columnsOf(values, personId))
      .where(and(eq(s.agentBudget.id, budgetId), eq(s.agentBudget.version, expectedVersion)))
      .returning({ id: s.agentBudget.id });
    if (rows.length === 0) return false;
    await tx.insert(s.budgetChange).values(changeRow(budgetId, values, personId));
    return true;
  });
}

/** The route a "switch to a cheaper alias" budget falls to. */
export async function routeIdByAlias(alias: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.route.id }).from(s.route).where(eq(s.route.alias, alias)).limit(1);
  return row?.id ?? null;
}

/** The aliases the budget form offers, which are every route an agent could fall to. */
export async function routeAliases(): Promise<string[]> {
  const rows = await dbRo().select({ alias: s.route.alias }).from(s.route).orderBy(asc(s.route.alias));
  return rows.map((row) => row.alias);
}


/* --------------------------------------------- accounting a run against its budget (S-72) */

/** The window of the period that contains `at`, for a budget of this length. */
export function periodWindow(period: string, at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start);
  switch (period) {
    case "Daily":
      end.setUTCDate(start.getUTCDate() + 1);
      return { start, end };
    case "Weekly": {
      // Weeks start on Monday, which is what the console shows and what a weekly limit
      // means to the person who set it.
      const weekday = (start.getUTCDay() + 6) % 7;
      start.setUTCDate(start.getUTCDate() - weekday);
      const weekEnd = new Date(start);
      weekEnd.setUTCDate(start.getUTCDate() + 7);
      return { start, end: weekEnd };
    }
    case "Quarterly": {
      const quarter = Math.floor(at.getUTCMonth() / 3) * 3;
      const quarterStart = new Date(Date.UTC(at.getUTCFullYear(), quarter, 1));
      const quarterEnd = new Date(Date.UTC(at.getUTCFullYear(), quarter + 3, 1));
      return { start: quarterStart, end: quarterEnd };
    }
    default: {
      const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
      return { start: monthStart, end: monthEnd };
    }
  }
}

/** The budget in force for one agent right now, or none. */
export async function budgetInForce(agentId: string, at: Date): Promise<{
  id: string;
  limit: number;
  period: string;
  warnAtPct: number;
  actionAt100: string;
  cheaperRouteId: string | null;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.agentBudget.id,
      limit: sql<number>`${s.agentBudget.limitAed}::float8`,
      period: s.agentBudget.period,
      warnAtPct: s.agentBudget.warnAtPct,
      actionAt100: s.agentBudget.actionAt100,
      cheaperRouteId: s.agentBudget.cheaperRouteId,
    })
    .from(s.agentBudget)
    .where(
      and(
        eq(s.agentBudget.agentId, agentId),
        lte(s.agentBudget.effectiveFrom, at),
        or(isNull(s.agentBudget.effectiveTo), gt(s.agentBudget.effectiveTo, at)),
      ),
    )
    .orderBy(desc(s.agentBudget.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-72.1-07`: add one run to the period that contains it, creating the period if this is
 * the first run of it — which is what makes spend reset when a new period starts and the
 * previous one move to history without anything having to sweep.
 *
 * @returns the period's spend before and after, so the caller can see a threshold crossed.
 */
export async function addSpend(
  budget: { id: string; period: string },
  amount: number,
  at: Date,
  personId: string,
): Promise<{ periodId: string; before: number; after: number }> {
  const { start, end } = periodWindow(budget.period, at);
  const [row] = await db()
    .insert(s.budgetPeriod)
    .values({
      budgetId: budget.id,
      periodStart: start,
      periodEnd: end,
      estimatedSpendAed: amount,
      runs: 1,
      createdBy: personId,
      updatedBy: personId,
    })
    .onConflictDoUpdate({
      target: [s.budgetPeriod.budgetId, s.budgetPeriod.periodStart],
      set: {
        estimatedSpendAed: sql`${s.budgetPeriod.estimatedSpendAed} + ${amount}`,
        runs: sql`${s.budgetPeriod.runs} + 1`,
        updatedAt: new Date(),
        updatedBy: personId,
      },
    })
    .returning({
      periodId: s.budgetPeriod.id,
      after: sql<number>`${s.budgetPeriod.estimatedSpendAed}::float8`,
    });
  return { periodId: row.periodId, before: row.after - amount, after: row.after };
}

/** Whether an event of this type was already raised for this period. */
export async function eventRaised(periodId: string, type: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.budgetEvent.id })
    .from(s.budgetEvent)
    .where(and(eq(s.budgetEvent.periodId, periodId), eq(s.budgetEvent.type, type)))
    .limit(1);
  return !!row;
}

/** `UC-72.1-04` and `-05`: what the period history shows happened. Returns the event's own id, so the inbox item it may raise can be keyed to this one crossing rather than the budget as a whole. */
export async function raiseEvent(
  input: { budgetId: string; periodId: string; type: string; detailEn: string; detailAr: string },
  personId: string,
): Promise<string> {
  const [row] = await db()
    .insert(s.budgetEvent)
    .values({
      budgetId: input.budgetId,
      periodId: input.periodId,
      type: input.type,
      detailEn: input.detailEn,
      detailAr: input.detailAr,
      createdBy: personId,
      updatedBy: personId,
    })
    .returning({ id: s.budgetEvent.id });
  return row.id;
}

/**
 * Who to tell when a budget crosses a line.
 *
 * An agent has no owner column; it reports to someone, the way a person does. When it
 * reports to another agent there is nobody to notify, and the event in the period history
 * is the record instead.
 */
export async function ownerOfAgent(agentId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ type: s.agent.reportsToType, id: s.agent.reportsToId })
    .from(s.agent)
    .where(eq(s.agent.id, agentId))
    .limit(1);
  return row?.type === "Person" ? (row.id ?? null) : null;
}

/**
 * `UC-72.1-05`: the hard limit pauses the agent, which every screen then shows.
 *
 * An agent already in Error keeps that status: "it is over budget" is less useful to an
 * operator than "it is broken", and the budget event records what happened either way.
 */
export async function pauseAgent(agentId: string, personId: string): Promise<void> {
  await db()
    .update(s.agent)
    .set({ status: "Paused", updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.agent.id, agentId), sql`${s.agent.status} <> 'Error'`));
}

/**
 * `UC-72.1-04`: the owner is told, in the one place the console puts what needs a person.
 *
 * Keyed to the budget event, not the budget itself: a budget can raise a warning and, in
 * the same run, also reach its hard limit, and later cross both lines again next period.
 * Keying to the budget would make the second of those an `inbox_item_key` collision.
 */
export async function notifyBudget(
  input: { personId: string; eventId: string },
  personId: string,
): Promise<void> {
  const items = await db()
    .insert(s.inboxItem)
    .values({
      personId: input.personId,
      // Not an approval and not a question: nothing is waiting on a decision, the owner is
      // being told. The Inbox calls that an SLA warning.
      kind: "SlaWarning",
      sourceType: "Budget",
      sourceId: input.eventId,
      status: "Open",
      createdBy: personId,
      updatedBy: personId,
    })
    .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
  await enqueueMailJobs(
    await queueAlertEmails(db(), {
      items,
      kind: "SlaWarning",
      titleEn: "An agent budget needs your attention",
      titleAr: "ميزانية وكيل تحتاج إلى انتباهك",
      path: "/budgets",
      actorId: personId,
    }),
  );
}
