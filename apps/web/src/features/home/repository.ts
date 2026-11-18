import { and, asc, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";

import { dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm, likeLiteral } from "@/db/search";
import { filterRecords } from "./filter";
import type { Bucket, BucketUnit, DashboardRun, RecordSetRows, SearchHit, SearchKind } from "./types";

/**
 * The read models behind the dashboard and its drill-downs. Everything here goes through
 * the replica (requirement 25): it is all reporting.
 */

const OPEN_STATUSES = ["Backlog", "ToDo", "InProgress", "InReview", "Blocked"] as const;

/** The organisation's name in both languages, or empty names when no organisation exists yet. */
export async function readOrganisation(): Promise<{ nameEn: string; nameAr: string }> {
  const [row] = await dbRo().select({ nameEn: s.organisation.nameEn, nameAr: s.organisation.nameAr }).from(s.organisation).limit(1);
  return row ?? { nameEn: "", nameAr: "" };
}

/**
 * The organisation's time zone, in which the dashboard counts its days (D365). The
 * installation has one organisation; before it exists, UTC.
 */
const ORG_ZONE = sql`coalesce((select time_zone from core.organisation limit 1), 'UTC')`;

/** The organisation's time zone, for the ranges the dashboard builds before it queries. */
export async function organisationZone(): Promise<string> {
  const [row] = await dbRo().select({ zone: s.organisation.timeZone }).from(s.organisation).limit(1);
  return row?.zone ?? "UTC";
}

/**
 * `UC-10.1-06`: whether the installation has anything in it yet.
 *
 * A quiet day and an empty platform both show zeros, and they need different screens: one
 * is nothing to do, the other is nothing set up. Work items and requests are what a person
 * puts in, so the absence of both is the second case.
 */
export async function installationIsEmpty(): Promise<boolean> {
  const { rows } = await dbRo().execute<{ empty: boolean }>(sql`
    select not exists (select 1 from work.work_item)
       and not exists (select 1 from work.request) as empty
  `);
  return rows[0]?.empty ?? true;
}

/** Open work items: the total, how many were created today, and the count per status in board order. */
export async function openWorkItems() {
  const byStatus = await dbRo()
    .select({ status: s.workItem.status, count: sql<number>`count(*)::int` })
    .from(s.workItem)
    .where(inArray(s.workItem.status, [...OPEN_STATUSES]))
    .groupBy(s.workItem.status);

  const [openedToday] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.workItem)
    .where(sql`${s.workItem.createdAt} >= date_trunc('day', now(), ${ORG_ZONE})`);

  const order = new Map(OPEN_STATUSES.map((status, index) => [status as string, index]));
  return {
    total: byStatus.reduce((sum, row) => sum + row.count, 0),
    openedToday: openedToday?.count ?? 0,
    byStatus: byStatus.sort((a, b) => (order.get(a.status) ?? 0) - (order.get(b.status) ?? 0)),
  };
}

/** How many steps a run has recorded, and how many of them have finished. */
const stepCount = sql<number>`(select count(*) from ai.run_step rs where rs.run_id = ${outer(s.run.id)})::int`;
const doneStepCount = sql<number>`(select count(*) from ai.run_step rs where rs.run_id = ${outer(s.run.id)} and rs.status = 'Succeeded')::int`;

/**
 * The newest `shown` runs that are Running, Waiting or Failed, each with its goal (the work item's
 * or room's title, else the run key) and its finished and total step counts, read for those rows
 * only (D349). `inProgress` counts the runs that are not Failed; `waitingOnPeople` the Waiting ones.
 */
export async function runsInProgress(shown: number): Promise<{ inProgress: number; waitingOnPeople: number; rows: DashboardRun[] }> {
  const [counted] = await dbRo()
    .select({
      inProgress: sql<number>`count(*)::int`,
      waitingOnPeople: sql<number>`(count(*) filter (where ${s.run.status} = 'Waiting'))::int`,
    })
    .from(s.run)
    .where(inArray(s.run.status, ["Running", "Waiting"]));
  const rows = await dbRo()
    .select({
      key: s.run.key,
      agent: s.agent.code,
      goalEn: sql<string>`coalesce(wi.title_en, dr.title_en, ${s.run.key})`,
      goalAr: sql<string>`coalesce(wi.title_ar, dr.title_ar, ${s.run.key})`,
      status: s.run.status,
      cost: sql<number>`${s.run.estimatedCostAed}::float8`,
      steps: stepCount,
      done: doneStepCount,
      startedAt: s.run.startedAt,
    })
    .from(s.run)
    .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
    .leftJoin(sql`work.work_item wi`, sql`wi.id = ${s.run.contextId} and ${s.run.contextType} = 'WorkItem'`)
    .leftJoin(sql`work.discussion_room dr`, sql`dr.id = ${s.run.contextId} and ${s.run.contextType} = 'Room'`)
    .where(inArray(s.run.status, ["Running", "Waiting", "Failed"]))
    .orderBy(desc(s.run.startedAt))
    .limit(shown);

  return {
    inProgress: counted?.inProgress ?? 0,
    waitingOnPeople: counted?.waitingOnPeople ?? 0,
    rows: rows.map((row) => ({
      key: row.key,
      agent: row.agent,
      goalEn: row.goalEn,
      goalAr: row.goalAr,
      step: row.done,
      steps: row.steps,
      cost: row.cost,
      waiting: row.status === "Waiting",
      failed: row.status === "Failed",
    })),
  };
}

/** How many approvals are Pending, and how many of those are High risk. */
export async function approvalsWaiting() {
  const [row] = await dbRo()
    .select({
      waiting: sql<number>`count(*)::int`,
      highRisk: sql<number>`count(*) filter (where ${s.approval.risk} = 'High')::int`,
    })
    .from(s.approval)
    .where(eq(s.approval.status, "Pending"));
  return { waiting: row?.waiting ?? 0, highRisk: row?.highRisk ?? 0 };
}

/** How many agents are in Error, and the first one by name with its active version as a label. */
export async function agentsInError() {
  const rows = await dbRo()
    .select({ nameEn: s.agent.nameEn, versionNumber: s.agentVersion.versionNumber })
    .from(s.agent)
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(eq(s.agent.status, "Error"))
    .orderBy(asc(s.agent.nameEn));
  return { count: rows.length, label: rows[0] ? `${rows[0].nameEn} v${rows[0].versionNumber}` : null };
}

/**
 * Estimated spend: today's from run rows, this month's from the budget periods, the sum of the
 * agent budgets in effect now as the limit, and the agent with the highest spend this month.
 */
export async function estimatedCost() {
  const [today] = await dbRo()
    .select({ total: sql<number>`coalesce(sum(${s.run.estimatedCostAed}), 0)::float8` })
    .from(s.run)
    .where(sql`${s.run.startedAt} >= date_trunc('day', now(), ${ORG_ZONE})`);

  const [month] = await dbRo()
    .select({ total: sql<number>`coalesce(sum(${s.budgetPeriod.estimatedSpendAed}), 0)::float8` })
    .from(s.budgetPeriod)
    .where(sql`${s.budgetPeriod.periodStart} = date_trunc('month', now())::date`);

  const [limit] = await dbRo()
    .select({ total: sql<number>`coalesce(sum(${s.agentBudget.limitAed}), 0)::float8` })
    .from(s.agentBudget)
    .where(
      and(
        lte(s.agentBudget.effectiveFrom, sql`now()`),
        sql`(${s.agentBudget.effectiveTo} is null or ${s.agentBudget.effectiveTo} >= now())`,
      ),
    );

  const [top] = await dbRo()
    .select({ nameEn: s.agent.nameEn, nameAr: s.agent.nameAr, spend: s.budgetPeriod.estimatedSpendAed })
    .from(s.budgetPeriod)
    .innerJoin(s.agentBudget, eq(s.agentBudget.id, s.budgetPeriod.budgetId))
    .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
    .where(sql`${s.budgetPeriod.periodStart} = date_trunc('month', now())::date`)
    .orderBy(desc(s.budgetPeriod.estimatedSpendAed))
    .limit(1);

  return {
    today: today?.total ?? 0,
    month: month?.total ?? 0,
    limit: limit?.total ?? 0,
    topAgentEn: top?.nameEn ?? null,
    topAgentAr: top?.nameAr ?? null,
  };
}

/** Work items and requests due within four hours and not finished (`UC-01.1-06`). */
const SLA_WINDOW = sql`now() + interval '4 hours'`;

/** How many open work items and unfinished requests are due within `SLA_WINDOW` (`UC-01.1-06`). */
export async function countSlaAtRisk(): Promise<number> {
  const [items, requests] = await Promise.all([
    dbRo()
      .select({ count: sql<number>`count(*)::int` })
      .from(s.workItem)
      .where(and(inArray(s.workItem.status, [...OPEN_STATUSES]), sql`${s.workItem.dueAt} is not null and ${s.workItem.dueAt} <= ${SLA_WINDOW}`)),
    dbRo()
      .select({ count: sql<number>`count(*)::int` })
      .from(s.request)
      .where(and(sql`${s.request.status} not in ('Completed', 'Rejected')`, sql`${s.request.dueAt} is not null and ${s.request.dueAt} <= ${SLA_WINDOW}`)),
  ]);
  return (items[0]?.count ?? 0) + (requests[0]?.count ?? 0);
}

/**
 * What a drill-down list is filtered by (D349): `term` in the key or title, a project by key,
 * a status; `limit` rows from `offset`, or every row when `limit` is not given (an export).
 */
export type RecordQuery = { term?: string; project?: string; status?: string; limit?: number; offset?: number };

/** The run statuses the "Runs in progress" list shows. */
const RUN_LIST_STATUSES = ["Running", "Waiting", "Failed"];

/** The request statuses that are not finished, for the SLA list's status filter. */
const OPEN_REQUEST_STATUSES = ["Triage", "Submitted", "InReview", "Approved"];

/** The `limit … offset …` of a query, or nothing for every row. */
function pageClause(query: RecordQuery): SQL {
  return query.limit === undefined ? sql`` : sql`limit ${query.limit} offset ${query.offset ?? 0}`;
}

/** A filter value that names something, or undefined for "any". */
const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

/** `column` is the project with `key`; no key is every project. */
const inProject = (column: SQL, key: string | undefined) =>
  key === undefined ? sql`true` : sql`${column} = (select p.id from work.project p where p.key = ${key})`;

/** A raw query's timestamp, which the driver may hand back as a string, as ISO 8601. */
function toIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** A list bounded by the number of agents, filtered and paged after it is read. */
function pagedInMemory(query: RecordQuery, set: Omit<RecordSetRows, "total" | "statuses">): RecordSetRows {
  const rows = filterRecords({ ...set, total: set.rows.length, statuses: [] }, query);
  const statuses = set.cols.includes("status") ? [...new Set(set.rows.map((row) => String(row[3])))] : [];
  const from = query.offset ?? 0;
  return { ...set, rows: query.limit === undefined ? rows : rows.slice(from, from + query.limit), total: rows.length, statuses };
}

/**
 * S-11: the six drill-down lists, each built from the same rows the KPI counted, filtered and
 * paged in the database (D349), with how many rows match and the statuses the filter offers.
 * The two lists bounded by the number of agents are filtered after they are read.
 */
export async function readRecordSet(kind: string, query: RecordQuery = {}): Promise<RecordSetRows> {
  const term = query.term?.trim() || undefined;
  const project = chosen(query.project);
  const status = chosen(query.status);
  const text = (target: SQL) => (term ? containsTerm(target, term) : sql`true`);
  const statusIs = (column: SQL) => (status === undefined ? sql`true` : sql`${column} = ${status}`);

  switch (kind) {
    case "open": {
      const where = sql`wi.status = any(${sql.param([...OPEN_STATUSES])}::text[])
        and ${text(sql`wi.search_key`)} and ${inProject(sql`wi.project_id`, project)} and ${statusIs(sql`wi.status`)}`;
      const [{ rows }, { rows: counted }] = await Promise.all([
        dbRo().execute<{ key: string; title_en: string; project: string; status: string; who: string | null; due_at: Date | null }>(sql`
          select wi.key, wi.title_en, p.key as project, wi.status, coalesce(a.code, pe.id::text) as who, wi.due_at
          from work.work_item wi
          join work.project p on p.id = wi.project_id
          left join ai.agent a on a.id = wi.assignee_id
          left join core.person pe on pe.id = wi.assignee_id
          where ${where}
          order by wi.key ${pageClause(query)}`),
        dbRo().execute<{ n: number }>(sql`select count(*)::int as n from work.work_item wi where ${where}`),
      ]);
      return {
        kind,
        title: ["Open work items", "بنود العمل المفتوحة"],
        sub: ["All work that is not done, across projects.", "كل العمل غير المنجز عبر المشاريع."],
        cols: ["key", "title", "project", "status", "who", "due"],
        rows: rows.map((row) => [row.key, row.title_en, row.project, row.status, row.who, toIso(row.due_at)]),
        total: counted[0]?.n ?? 0,
        statuses: [...OPEN_STATUSES],
      };
    }
    case "runs": {
      const from = sql`from ai.run r
        join ai.agent a on a.id = r.agent_id
        left join work.work_item wi on wi.id = r.context_id and r.context_type = 'WorkItem'
        left join work.discussion_room dr on dr.id = r.context_id and r.context_type = 'Room'`;
      const where = sql`r.status = any(${sql.param(RUN_LIST_STATUSES)}::text[]) and ${statusIs(sql`r.status`)}
        and ${
          term
            ? sql`(r.key ilike ${`%${likeLiteral(term)}%`} or ${containsTerm(sql`wi.search_key`, term)} or ${containsTerm(sql`dr.search_key`, term)})`
            : sql`true`
        }`;
      const [{ rows }, { rows: counted }] = await Promise.all([
        dbRo().execute<{ key: string; goal: string; agent: string; status: string }>(sql`
          select r.key, coalesce(wi.title_en, dr.title_en, r.key) as goal, a.code as agent, r.status
          ${from} where ${where}
          order by r.started_at desc, r.id desc ${pageClause(query)}`),
        dbRo().execute<{ n: number }>(sql`select count(*)::int as n ${from} where ${where}`),
      ]);
      return {
        kind,
        title: ["Runs in progress", "عمليات قيد التشغيل"],
        sub: ["Agent runs that are running or waiting on a person.", "عمليات الوكلاء الجارية أو المنتظرة لشخص."],
        cols: ["key", "title", "agent", "status", "started"],
        rows: rows.map((row) => [row.key, row.goal, row.agent, row.status, null]),
        total: counted[0]?.n ?? 0,
        statuses: RUN_LIST_STATUSES,
      };
    }
    case "approvals": {
      const like = term ? `%${likeLiteral(term)}%` : null;
      const where = sql`ap.status = 'Pending' and ${like === null ? sql`true` : sql`(ap.key ilike ${like} or ap.evidence ilike ${like})`}`;
      const [{ rows }, { rows: counted }] = await Promise.all([
        dbRo().execute<{ key: string; evidence: string; agent: string | null; risk: string; created_at: Date }>(sql`
          select ap.key, ap.evidence, a.code as agent, ap.risk, ap.created_at
          from ai.approval ap left join ai.agent a on a.id = ap.requested_by_id
          where ${where}
          order by ap.created_at, ap.id ${pageClause(query)}`),
        dbRo().execute<{ n: number }>(sql`select count(*)::int as n from ai.approval ap where ${where}`),
      ]);
      return {
        kind,
        title: ["Approvals waiting", "اعتمادات بالانتظار"],
        sub: ["Decisions waiting for you or your groups.", "قرارات بانتظارك أو بانتظار مجموعاتك."],
        cols: ["key", "title", "agent", "risk", "started"],
        rows: rows.map((row) => [row.key, row.evidence, row.agent, row.risk, toIso(row.created_at)]),
        total: counted[0]?.n ?? 0,
        statuses: [],
      };
    }
    case "agentsErr": {
      const rows = await dbRo()
        .select({ code: s.agent.code, nameEn: s.agent.nameEn, versionNumber: s.agentVersion.versionNumber, updatedAt: s.agent.updatedAt })
        .from(s.agent)
        .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
        .where(eq(s.agent.status, "Error"));
      return pagedInMemory(query, {
        kind,
        title: ["Agents in error", "وكلاء في حالة خطأ"],
        sub: ["Agents whose last run failed or whose connector is down.", "وكلاء فشلت آخر عملياتهم أو تعطل موصلهم."],
        cols: ["key", "title", "agent", "status", "started"],
        rows: rows.map((row) => [row.code.toUpperCase(), `${row.nameEn} v${row.versionNumber}`, row.code, "Error", row.updatedAt.toISOString()]),
      });
    }
    case "cost": {
      const rows = await dbRo()
        .select({ code: s.agent.code, nameEn: s.agent.nameEn, versionNumber: s.agentVersion.versionNumber, spend: sql<number>`${s.budgetPeriod.estimatedSpendAed}::float8` })
        .from(s.budgetPeriod)
        .innerJoin(s.agentBudget, eq(s.agentBudget.id, s.budgetPeriod.budgetId))
        .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
        .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
        .where(sql`${s.budgetPeriod.periodStart} = date_trunc('month', now())::date`)
        .orderBy(desc(s.budgetPeriod.estimatedSpendAed));
      return pagedInMemory(query, {
        kind,
        title: ["Estimated cost today", "التكلفة التقديرية اليوم"],
        sub: ["Estimated spend by agent since midnight.", "الإنفاق التقديري حسب الوكيل منذ منتصف الليل."],
        cols: ["key", "title", "agent", "amount"],
        rows: rows.map((row) => [`v${row.versionNumber}`, row.nameEn, row.code, row.spend]),
      });
    }
    default: {
      // Open work items and unfinished requests due within `SLA_WINDOW`, soonest first.
      const atRisk = sql`(
          select wi.key, wi.title_en, wi.project_id, wi.status, coalesce(a.code, pe.id::text) as who, wi.due_at, wi.search_key
          from work.work_item wi
          left join ai.agent a on a.id = wi.assignee_id
          left join core.person pe on pe.id = wi.assignee_id
          where wi.status = any(${sql.param([...OPEN_STATUSES])}::text[]) and wi.due_at is not null and wi.due_at <= ${SLA_WINDOW}
        union all
          select rq.key, rq.title_en, rq.project_id, rq.status, null, rq.due_at, rq.search_key
          from work.request rq
          where rq.status not in ('Completed', 'Rejected') and rq.due_at is not null and rq.due_at <= ${SLA_WINDOW}
        ) as at_risk`;
      const where = sql`${text(sql`at_risk.search_key`)} and ${inProject(sql`at_risk.project_id`, project)} and ${statusIs(sql`at_risk.status`)}`;
      const [{ rows }, { rows: counted }] = await Promise.all([
        dbRo().execute<{ key: string; title_en: string; project: string; status: string; who: string | null; due_at: Date | null }>(sql`
          select at_risk.key, at_risk.title_en, p.key as project, at_risk.status, at_risk.who, at_risk.due_at
          from ${atRisk} join work.project p on p.id = at_risk.project_id
          where ${where}
          order by at_risk.due_at, at_risk.key ${pageClause(query)}`),
        dbRo().execute<{ n: number }>(sql`select count(*)::int as n from ${atRisk} where ${where}`),
      ]);
      return {
        kind: "sla",
        title: ["SLA at risk", "اتفاقيات خدمة معرضة للخطر"],
        sub: ["Work items and requests due within 4 hours.", "بنود العمل والطلبات المستحقة خلال 4 ساعات."],
        cols: ["key", "title", "project", "status", "who", "left"],
        rows: rows.map((row) => [row.key, row.title_en, row.project, row.status, row.who, toIso(row.due_at)]),
        total: counted[0]?.n ?? 0,
        statuses: [...new Set<string>([...OPEN_STATUSES, ...OPEN_REQUEST_STATUSES])],
      };
    }
  }
}

/**
 * S-02, requirement 40: the search behind the palette.
 *
 * Matching runs against the generated `search_key` columns of the data model, which are
 * built with `public.awp_normalise()` — Arabic letter-form folding, diacritic removal,
 * unaccent, lowercase — so `ادارة` and `إدارة` are the same term. The term is normalised
 * the same way before it is compared, which is why `UC-02.1-04` holds.
 *
 * Each kind returns at most five rows, and a record whose key or code matches is ordered
 * above one that only matches on its name.
 */
const PER_KIND = 5;

/** `null` projects means every project; an empty array means none, and matches nothing. */
type Projects = string[] | null;

function projectFilter(column: SQL, projects: Projects): SQL {
  if (projects === null) return sql`true`;
  if (projects.length === 0) return sql`false`;
  return sql`${column} = any(${sql.param(projects)}::uuid[])`;
}

/** Discussion rooms matching `term` within `projects`, key matches first. */
export async function searchRooms(term: string, projects: Projects): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select r.key as "code", r.title_en as "nameEn", r.title_ar as "nameAr"
    from work.discussion_room r
    where ${containsTerm(sql`r.search_key`, term)}
      and ${projectFilter(sql`r.project_id`, projects)}
    order by case when ${containsTerm(sql`public.awp_normalise(r.key)`, term)} then 0 else 1 end, r.key
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "room" as SearchKind, screen: "session", params: { key: row.code } }));
}

/** Work items matching `term` within `projects`, key matches first. */
export async function searchWorkItems(term: string, projects: Projects): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select w.key as "code", w.title_en as "nameEn", w.title_ar as "nameAr"
    from work.work_item w
    where ${containsTerm(sql`w.search_key`, term)}
      and ${projectFilter(sql`w.project_id`, projects)}
    order by case when ${containsTerm(sql`public.awp_normalise(w.key)`, term)} then 0 else 1 end, w.key
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "workItem" as SearchKind, screen: "tasks" }));
}

/** Requests matching `term` within `projects`, key matches first. */
export async function searchRequests(term: string, projects: Projects): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select q.key as "code", q.title_en as "nameEn", q.title_ar as "nameAr"
    from work.request q
    where ${containsTerm(sql`q.search_key`, term)}
      and ${projectFilter(sql`q.project_id`, projects)}
    order by case when ${containsTerm(sql`public.awp_normalise(q.key)`, term)} then 0 else 1 end, q.key
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "request" as SearchKind, screen: "requests" }));
}

/**
 * Artifacts matching `term` within `projects`, ordered by English name. The hit's code is the
 * artifact's project key.
 */
export async function searchArtifacts(term: string, projects: Projects): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select p.key as "code", a.name_en as "nameEn", a.name_ar as "nameAr"
    from work.artifact a
    join work.project p on p.id = a.project_id
    where ${containsTerm(sql`a.search_key`, term)}
      and ${projectFilter(sql`a.project_id`, projects)}
    order by a.name_en
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "artifact" as SearchKind, screen: "artifacts" }));
}

/** Agents matching `term`, code matches first. Not limited by project. */
export async function searchAgents(term: string): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select a.code as "code", a.name_en as "nameEn", a.name_ar as "nameAr"
    from ai.agent a
    where ${containsTerm(sql`a.search_key`, term)}
    order by case when ${containsTerm(sql`public.awp_normalise(a.code)`, term)} then 0 else 1 end, a.code
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "agent" as SearchKind, screen: "agents" }));
}

/** Skills matching `term`, skill-name matches first. Not limited by project. */
export async function searchSkills(term: string): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select k.skill_name as "code", k.title_en as "nameEn", k.title_ar as "nameAr"
    from ai.skill k
    where ${containsTerm(sql`k.search_key`, term)}
    order by case when ${containsTerm(sql`public.awp_normalise(k.skill_name)`, term)} then 0 else 1 end, k.skill_name
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "skill" as SearchKind, screen: "skills" }));
}

/** Connectors matching `term`, code matches first. Not limited by project. */
export async function searchConnectors(term: string): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select c.code as "code", c.name_en as "nameEn", c.name_ar as "nameAr"
    from ai.connector c
    where ${containsTerm(sql`c.search_key`, term)}
    order by case when ${containsTerm(sql`public.awp_normalise(c.code)`, term)} then 0 else 1 end, c.code
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({ ...row, kind: "connector" as SearchKind, screen: "connectors" }));
}

/**
 * Knowledge is one kind on the palette but two tables: the collection, and the documents
 * indexed into it. A person looking for "Travel & Expense Policy" is looking for the
 * document, so both are matched and the collections are listed first.
 */
export async function searchKnowledge(term: string): Promise<SearchHit[]> {
  const { rows } = await dbRo().execute<{ code: string; nameEn: string; nameAr: string }>(sql`
    select n.collection_id as "code", n.name_en as "nameEn", n.name_ar as "nameAr", 0 as rank, n.collection_id as sort
    from ai.knowledge_collection n
    where ${containsTerm(sql`n.search_key`, term)}
    union all
    select c.collection_id as "code", d.title as "nameEn", d.title as "nameAr", 1 as rank, d.title as sort
    from ai.knowledge_document d
    join ai.knowledge_source s on s.id = d.source_id
    join ai.knowledge_collection c on c.id = s.collection_id
    where ${containsTerm(sql`d.search_key`, term)}
    order by rank, sort
    limit ${PER_KIND}
  `);
  return rows.map((row) => ({
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    kind: "knowledge" as SearchKind,
    screen: "knowledge",
  }));
}

/* ------------------------------------------------- Dashboard 3 (handoff v2 section 2) */

/**
 * The bucket width a span is drawn at (handoff v2 section 2.3): days up to a fortnight,
 * weeks up to fourteen of them, months up to a year, quarters beyond that.
 */
export function bucketUnit(from: Date, to: Date): BucketUnit {
  // `to` is the last millisecond of its day, so the whole days between them floor exactly.
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days <= 14) return "day";
  if (days <= 98) return "week";
  if (days <= 366) return "month";
  return "quarter";
}

/**
 * One `generate_series` of buckets, so a period with nothing in it is a zero rather than a gap
 * in the chart. They are cut on the organisation's local calendar (D365): the series runs over
 * local times, truncated at both ends so the join lines up when the range does not start on a
 * Monday or the first of the month, and each bucket's start and end are turned back into
 * instants, which keeps a day that crosses a daylight-saving change whole.
 */
const bucketStarts = (unit: BucketUnit, from: Date, to: Date) => sql`
  select local at time zone ${ORG_ZONE} as bucket,
         (local + ${`1 ${unit}`}::interval) at time zone ${ORG_ZONE} as bucket_end
    from generate_series(
           date_trunc(${unit}, ${from.toISOString()}::timestamptz at time zone ${ORG_ZONE}),
           date_trunc(${unit}, ${to.toISOString()}::timestamptz at time zone ${ORG_ZONE}),
           ${`1 ${unit}`}::interval
         ) as local
`;

/** Agent runs started in each bucket of the range. */
export async function runsPerBucket(unit: BucketUnit, from: Date, to: Date): Promise<Bucket[]> {
  const { rows } = await dbRo().execute<{ start: Date | string; count: number }>(sql`
    with buckets as (${bucketStarts(unit, from, to)})
    select b.bucket as "start",
           (select count(*) from ai.run r
             where r.started_at >= b.bucket
               and r.started_at < b.bucket_end
               and r.started_at >= ${from.toISOString()}::timestamptz
               and r.started_at <= ${to.toISOString()}::timestamptz)::int as "count"
      from buckets b
     order by b.bucket
  `);
  return rows.map((row) => ({ start: new Date(row.start).toISOString(), count: row.count }));
}

/** Work items finished in each bucket of the range. */
export async function finishedPerBucket(unit: BucketUnit, from: Date, to: Date): Promise<Bucket[]> {
  const { rows } = await dbRo().execute<{ start: Date | string; count: number }>(sql`
    with buckets as (${bucketStarts(unit, from, to)})
    select b.bucket as "start",
           (select count(*) from work.work_item w
             where w.completed_at >= b.bucket
               and w.completed_at < b.bucket_end
               and w.completed_at >= ${from.toISOString()}::timestamptz
               and w.completed_at <= ${to.toISOString()}::timestamptz)::int as "count"
      from buckets b
     order by b.bucket
  `);
  return rows.map((row) => ({ start: new Date(row.start).toISOString(), count: row.count }));
}

/** How many work items were finished in a window — the previous-period comparison. */
export async function finishedBetween(from: Date, to: Date): Promise<number> {
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.workItem)
    .where(sql`${s.workItem.completedAt} >= ${from.toISOString()}::timestamptz and ${s.workItem.completedAt} <= ${to.toISOString()}::timestamptz`);
  return row?.count ?? 0;
}

/**
 * What the runs of a period came to (handoff v2 section 2.2, card 6).
 *
 * `BudgetExceeded` counts as failed: the run did not produce what it was asked for, and a
 * fourth bubble for it would say nothing a person could act on differently.
 */
export async function runOutcomes(from: Date, to: Date): Promise<{ completed: number; waiting: number; failed: number }> {
  const [row] = await dbRo()
    .select({
      completed: sql<number>`count(*) filter (where ${s.run.status} = 'Succeeded')::int`,
      waiting: sql<number>`count(*) filter (where ${s.run.status} = 'Waiting')::int`,
      failed: sql<number>`count(*) filter (where ${s.run.status} in ('Failed', 'BudgetExceeded'))::int`,
    })
    .from(s.run)
    .where(sql`${s.run.startedAt} >= ${from.toISOString()}::timestamptz and ${s.run.startedAt} <= ${to.toISOString()}::timestamptz`);
  return { completed: row?.completed ?? 0, waiting: row?.waiting ?? 0, failed: row?.failed ?? 0 };
}

/**
 * The automation rate: the share of finished runs that needed nobody (`UC-10.1` card 1).
 *
 * "Needed nobody" is a run that ended successfully and recorded no approval or question
 * step — those are exactly the two step types that stop a run and wait for a person. The
 * trend is the same ratio over the eight periods ending with this one, which is what the
 * sparkline draws and what the "+N pts" chip is the difference across.
 */
export async function automationRate(unit: BucketUnit, to: Date, periods = 8): Promise<number[]> {
  const { rows } = await dbRo().execute<{ rate: number }>(sql`
    with buckets as (
      select local at time zone ${ORG_ZONE} as bucket,
             (local + ${`1 ${unit}`}::interval) at time zone ${ORG_ZONE} as bucket_end
        from generate_series(
               date_trunc(${unit}, ${to.toISOString()}::timestamptz at time zone ${ORG_ZONE}) - ${`${periods - 1} ${unit}`}::interval,
               date_trunc(${unit}, ${to.toISOString()}::timestamptz at time zone ${ORG_ZONE}),
               ${`1 ${unit}`}::interval
             ) as local
    )
    select coalesce(
             round(
               100.0 * count(*) filter (
                 where r.status = 'Succeeded'
                   and not exists (
                     select 1 from ai.run_step st
                      where st.run_id = r.id and st.type in ('Approval', 'Question')
                   )
               )
               / nullif(count(r.id), 0)
             ), 0)::int as "rate"
      from buckets b
      left join ai.run r
        on r.ended_at >= b.bucket
       and r.ended_at < b.bucket_end
       and r.status in ('Succeeded', 'Failed', 'Cancelled', 'BudgetExceeded')
     group by b.bucket
     order by b.bucket
  `);
  return rows.map((row) => row.rate);
}

/**
 * This month's estimated cost split between the models and everything else
 * (handoff v2 section 2.2, card 3).
 *
 * Read from the run steps rather than from the run total, because the split is the whole
 * point: a `Model` step is the model's own cost, and `Tool` and `Skill` steps are what the
 * connectors and skills cost. The two are returned in AED; the card turns them into shares.
 */
export async function monthCostSplit(): Promise<{ models: number; tools: number }> {
  const [row] = await dbRo().execute<{ models: number; tools: number }>(sql`
    select coalesce(sum(st.estimated_cost_aed) filter (where st.type = 'Model'), 0)::float8 as "models",
           coalesce(sum(st.estimated_cost_aed) filter (where st.type <> 'Model'), 0)::float8 as "tools"
      from ai.run_step st
     where st.started_at >= date_trunc('month', now())
  `).then((result) => result.rows);
  return { models: row?.models ?? 0, tools: row?.tools ?? 0 };
}
