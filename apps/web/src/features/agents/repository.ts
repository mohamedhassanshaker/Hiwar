import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { queueAlertEmails } from "@/db/queries/mail";
import { enqueueMailJobs } from "@/lib/valkey";
import { outer } from "@/db/outer";
import { containsTerm, likeLiteral } from "@/db/search";
import { CHAT_ROUTE_KINDS, CONTEXT_HANDOFF_OWNERS } from "@/db/schema/enums";
import { assertWritten } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import { whyNotApplied, type NotApplied } from "@/lib/skill-package";
import { DEFAULT_RUN_SORT, type RunSort } from "./run-sort";
import type { AgentDetail, ContextSlice, Run, RunDetail, RunStep } from "./types";
import {
  DEFAULT_TOOL_GRANT,
  type RunKnowledge,
  type RunMemory,
  type RunPayload,
  type RunTool,
} from "./run-payload";

/** The only module in `agents` that touches Drizzle. */

/** What `whyNotApplied` reads, from a query joined to the skill, its version and its scan. */
const skillApplication = {
  sourceType: s.skill.sourceType,
  status: s.skillVersion.status,
  scannedVersionId: s.skillScanResult.skillVersionId,
  embeddedSecrets: s.skillScanResult.embeddedSecrets,
  promptInjectionPatterns: s.skillScanResult.promptInjectionPatterns,
};

/** Why a pinned skill version does not reach a run, from the columns above. */
function skillNotApplied(row: {
  sourceType: string;
  status: string;
  scannedVersionId: string | null;
  embeddedSecrets: number | null;
  promptInjectionPatterns: number | null;
}): NotApplied | null {
  return whyNotApplied({
    sourceType: row.sourceType,
    status: row.status,
    scan:
      row.scannedVersionId === null
        ? null
        : { embeddedSecrets: row.embeddedSecrets ?? 0, promptInjectionPatterns: row.promptInjectionPatterns ?? 0 },
  });
}

/** The agent statuses that do not start a run. */
export const NOT_RUNNABLE = ["Paused", "Error", "Retired"];

const runGoalEn = sql<string>`coalesce(
  (select wi.title_en from work.work_item wi where wi.id = ${outer(s.run.contextId)}),
  (select dr.title_en from work.discussion_room dr where dr.id = ${outer(s.run.contextId)}),
  ${s.run.key})`;

const runGoalAr = sql<string>`coalesce(
  (select wi.title_ar from work.work_item wi where wi.id = ${outer(s.run.contextId)}),
  (select dr.title_ar from work.discussion_room dr where dr.id = ${outer(s.run.contextId)}),
  ${s.run.key})`;

const runContextKey = sql<string>`coalesce(
  (select wi.key from work.work_item wi where wi.id = ${outer(s.run.contextId)}),
  (select dr.key from work.discussion_room dr where dr.id = ${outer(s.run.contextId)}),
  ${s.run.contextType})`;

/**
 * What a `Waiting` run is actually blocked on.
 *
 * `Waiting` is set both when a T2 call pauses for an approval and when the run asks a
 * person a question, so the list cannot read "approval" off the status: it said so for a
 * run waiting on an answer, which is a different thing and a different place to go.
 */
const runWaitingOn = sql<string | null>`case
  when ${s.run.status} <> 'Waiting' then null
  when exists (select 1 from ai.approval a where a.run_id = ${outer(s.run.id)} and a.status = 'Pending') then 'Approval'
  when exists (select 1 from ai.agent_question q where q.run_id = ${outer(s.run.id)} and q.answered_at is null) then 'Question'
  else 'Unknown' end`;

/** The record a run is about by key — its work item, room or request — or null for none. */
const runContextRecordKey = sql<string | null>`case ${s.run.contextType}
  when 'WorkItem' then (select wi.key from work.work_item wi where wi.id = ${outer(s.run.contextId)})
  when 'Room' then (select dr.key from work.discussion_room dr where dr.id = ${outer(s.run.contextId)})
  when 'Request' then (select rq.key from work.request rq where rq.id = ${outer(s.run.contextId)})
  end`;

/** The run that delegated this one (D46), by key. */
const runParentKey = sql<string | null>`(select p.key from ai.run p where p.id = ${outer(s.run.parentRunId)})`;

/** The room a run belongs to, so a decision can be taken where the work is. */
const runRoomKey = sql<string | null>`(select dr.key from work.discussion_room dr where dr.id = ${outer(s.run.contextId)})`;

/** The work item a run belongs to, for the same reason. */
const runWorkItemKey = sql<string | null>`(select wi.key from work.work_item wi where wi.id = ${outer(s.run.contextId)})`;

const runColumns = {
  id: s.run.key,
  st: s.run.status,
  waitingOn: runWaitingOn,
  roomKey: runRoomKey,
  workItemKey: runWorkItemKey,
  goal: runGoalEn,
  goalAr: runGoalAr,
  at: s.run.startedAt,
  endedAt: s.run.endedAt,
  cost: sql<number>`${s.run.estimatedCostAed}::float8`,
  by: runContextKey,
  agent: s.agent.code,
  contextType: s.run.contextType,
  contextKey: runContextRecordKey,
  parentRunKey: runParentKey,
};

/**
 * A run list row as the screens read it. A run with no start time reads as starting now, and
 * its duration is null until it has both a start and an end.
 */
function toRun(row: {
  id: string;
  st: string;
  waitingOn: string | null;
  roomKey: string | null;
  workItemKey: string | null;
  goal: string;
  goalAr: string;
  at: Date | null;
  endedAt: Date | null;
  cost: number;
  by: string;
  agent: string;
  contextType: string;
  contextKey: string | null;
  parentRunKey: string | null;
}): Run {
  return {
    id: row.id,
    st: row.st,
    waitingOn: (row.waitingOn as Run["waitingOn"]) ?? null,
    roomKey: row.roomKey,
    workItemKey: row.workItemKey,
    goal: row.goal,
    goalAr: row.goalAr,
    at: (row.at ?? new Date()).toISOString(),
    durationMs: row.at && row.endedAt ? row.endedAt.getTime() - row.at.getTime() : null,
    cost: row.cost,
    by: row.by,
    agent: row.agent,
    endedAt: row.endedAt?.toISOString() ?? null,
    contextType: row.contextType,
    contextKey: row.contextKey,
    parentRunKey: row.parentRunKey,
  };
}

/**
 * Which runs `listRuns` returns: one agent's, in one status, started within the last
 * `sinceHours`, whose key or work item or room title contains `text`; `limit` (50 unless
 * given, at most 200) from `offset`.
 */
export type RunFilter = {
  agentCode?: string;
  status?: string;
  sinceHours?: number;
  text?: string;
  limit?: number;
  offset?: number;
  /** D383: the order of the page; newest first when absent. */
  sort?: RunSort;
};

/** What each sortable column orders by. A run still going has no duration and sorts after those that ended. */
const RUN_SORT_KEYS: Record<RunSort["column"], SQL> = {
  started: sql`${s.run.startedAt}`,
  agent: sql`${s.agent.code}`,
  status: sql`${s.run.status}`,
  duration: sql`(${s.run.endedAt} - ${s.run.startedAt})`,
  cost: sql`${s.run.estimatedCostAed}`,
};

/** The ORDER BY of a run page: the column asked for, then newest first so a page boundary is stable. */
function runOrder(sort: RunSort = DEFAULT_RUN_SORT) {
  const key = sql`${RUN_SORT_KEYS[sort.column]} ${sql.raw(sort.dir === "asc" ? "asc" : "desc")} nulls last`;
  return [key, desc(s.run.startedAt), desc(s.run.id)];
}

/** The most `listRuns` returns at once (D349). */
const RUN_PAGE_MAX = 200;

/** The WHERE clause of a run filter. The agent is matched by id, so its runs are read from `(agent_id, started_at)`. */
function runWhere(filter: RunFilter) {
  const text = filter.text?.trim();
  return and(
    filter.agentCode === undefined ? undefined : sql`${s.run.agentId} = (select a.id from ai.agent a where a.code = ${filter.agentCode})`,
    filter.status === undefined ? undefined : eq(s.run.status, filter.status),
    filter.sinceHours ? sql`${s.run.startedAt} >= now() - make_interval(hours => ${filter.sinceHours}::int)` : undefined,
    text
      ? sql`(${s.run.key} ilike ${`%${likeLiteral(text)}%`}
          or exists (select 1 from work.work_item wi where wi.id = ${outer(s.run.contextId)} and ${containsTerm(sql`wi.search_key`, text)})
          or exists (select 1 from work.discussion_room dr where dr.id = ${outer(s.run.contextId)} and ${containsTerm(sql`dr.search_key`, text)}))`
      : undefined,
  );
}

/**
 * The runs matching the filter, newest first unless it names a sort (D383), one page of them. The per-row columns are
 * computed for the rows returned only, after the sort and the limit.
 */
export async function listRuns(filter: RunFilter = {}): Promise<Run[]> {
  const rows = await dbRo()
    .select(runColumns)
    .from(s.run)
    .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
    .where(runWhere(filter))
    .orderBy(...runOrder(filter.sort))
    .limit(Math.min(filter.limit ?? 50, RUN_PAGE_MAX))
    .offset(filter.offset ?? 0);
  return rows.map(toRun);
}

/** How many runs match the filter, ignoring its page. */
export async function countRuns(filter: RunFilter): Promise<number> {
  const [row] = await dbRo()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.run)
    .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
    .where(runWhere(filter));
  return row?.n ?? 0;
}

/** The context composition the harness recorded on the run's first step (specification 5.3). */
const CONTEXT_COLOURS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
];

/**
 * The context slices in a Start step's JSON result, each given a chart colour in turn. Empty
 * when there is no result or it is not valid JSON.
 */
function parseContext(result: string | null): ContextSlice[] {
  if (!result) return [];
  try {
    const parsed = JSON.parse(result) as { composition?: { en: string; ar: string; share: number }[] };
    return (parsed.composition ?? []).map((slice, index) => ({ ...slice, colour: CONTEXT_COLOURS[index % CONTEXT_COLOURS.length] }));
  } catch {
    return [];
  }
}

/**
 * One run for the run viewer: its row, token and tool counters, the budget of the version it
 * ran, its steps in order, the context composition from its Start step, and how many of its
 * approvals are pending. Null when no run has that key. A Start step's result is the context
 * JSON, so its text is not shown as the step's detail.
 */
export async function readRun(key: string): Promise<RunDetail | null> {
  const [row] = await dbRo()
    .select({
      ...runColumns,
      tokensIn: s.run.tokensIn,
      tokensOut: s.run.tokensOut,
      cacheHitPct: sql<number | null>`${s.run.cacheHitPct}::float8`,
      toolCallCount: s.run.toolCallCount,
      waitingSeconds: s.run.waitingSeconds,
      budgetSoft: sql<number | null>`${s.agentVersion.runBudgetSoftAed}::float8`,
      budgetHard: sql<number | null>`${s.agentVersion.runBudgetHardAed}::float8`,
      traceId: s.run.traceId,
      replayOfRunKey: sql<string | null>`(select r2.key from ai.run r2 where r2.id = ${outer(s.run.replayOfRunId)})`,
      runId: s.run.id,
    })
    .from(s.run)
    .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.run.agentVersionId))
    .where(eq(s.run.key, key))
    .limit(1);
  if (!row) return null;

  const stepRows = await dbRo()
    .select({
      seq: s.runStep.seq,
      k: s.runStep.type,
      t: s.runStep.name,
      d: s.runStep.result,
      startedAt: s.runStep.startedAt,
      endedAt: s.runStep.endedAt,
      cost: sql<number>`${s.runStep.estimatedCostAed}::float8`,
      hooks: s.runStep.hooksApplied,
      status: s.runStep.status,
    })
    .from(s.runStep)
    .where(eq(s.runStep.runId, row.runId))
    .orderBy(asc(s.runStep.seq));

  const [approvals] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.approval)
    .where(and(eq(s.approval.runId, row.runId), eq(s.approval.status, "Pending")));

  const steps: RunStep[] = stepRows.map((step) => ({
    seq: step.seq,
    k: step.k,
    t: step.t,
    d: step.k === "Start" ? "" : (step.d ?? ""),
    ms: step.endedAt && step.startedAt ? step.endedAt.getTime() - step.startedAt.getTime() : null,
    cost: step.cost,
    hooks: step.hooks,
    status: step.status,
  }));

  return {
    run: toRun(row),
    runId: row.runId,
    steps,
    context: parseContext(stepRows.find((step) => step.k === "Start")?.d ?? null),
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    cacheHitPct: row.cacheHitPct,
    toolCallCount: row.toolCallCount,
    waitingSeconds: row.waitingSeconds,
    budgetSoft: row.budgetSoft,
    budgetHard: row.budgetHard,
    approvalsWaiting: approvals?.count ?? 0,
    traceId: row.traceId,
    replayOfRunKey: row.replayOfRunKey,
  };
}

/**
 * The revision a configuration edit lands on: the open draft `draftVersionId` would
 * return, or the active version when there is none. Read-only — it never creates a draft.
 */
export async function editingVersionOf(
  agentId: string,
  activeVersionId: string,
): Promise<{ id: string; instructions: string | null; draftNumber: number | null }> {
  const [draft] = await dbRo()
    .select({ id: s.agentVersion.id, instructions: s.agentVersion.instructions, versionNumber: s.agentVersion.versionNumber })
    .from(s.agentVersion)
    .where(and(eq(s.agentVersion.agentId, agentId), isNull(s.agentVersion.publishedAt)))
    .orderBy(desc(s.agentVersion.versionNumber))
    .limit(1);
  return draft
    ? { id: draft.id, instructions: draft.instructions, draftNumber: draft.versionNumber }
    : { id: activeVersionId, instructions: null, draftNumber: null };
}

/**
 * One agent's detail screen, or null when no agent has that code.
 *
 * Trust, budgets, model and statistics come from the active version; skills, tools,
 * knowledge, memory and instructions from the revision an edit lands on (`editingVersionOf`).
 * Also returns the shelves of skills and connector tools not yet attached, the connectors each
 * skill declares a tool of and the agent is granted none of, the result of its last failed
 * step and its versions. Its runs are read a page at a time (`listRuns`). The run count
 * prefers this month's budget counter.
 */
export async function readAgent(code: string): Promise<AgentDetail | null> {
  const [row] = await dbRo()
    .select({
      id: s.agent.id,
      code: s.agent.code,
      versionId: s.agentVersion.id,
      // The active version's own lock, which a change to trust or to the budget carries.
      versionLock: s.agentVersion.version,
      profile: s.agentVersion.executionProfile,
      trust: s.agentVersion.trust,
      memoryEnabled: s.agentVersion.memoryEnabled,
      budgetSoft: sql<number | null>`${s.agentVersion.runBudgetSoftAed}::float8`,
      budgetHard: sql<number | null>`${s.agentVersion.runBudgetHardAed}::float8`,
      instructions: s.agentVersion.instructions,
      evalScore: sql<number | null>`${s.agentVersion.evalScore}::float8`,
      reportsToType: s.agent.reportsToType,
      reportsToId: s.agent.reportsToId,
      model: sql<string | null>`(select rs.model_name from ai.route_step rs where rs.route_id = ${outer(s.agentVersion.primaryRouteId)} order by rs.sort_order limit 1)`,
      fallbackModel: sql<string | null>`(select rs.model_name from ai.route_step rs where rs.route_id = ${outer(s.agentVersion.fallbackRouteId)} order by rs.sort_order limit 1)`,
    })
    .from(s.agent)
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(eq(s.agent.code, code))
    .limit(1);
  if (!row) return null;

  // The configuration tabs show the revision an edit lands on, so a change is visible the
  // moment it is saved; runs keep using the active version until the draft is published.
  const editing = await editingVersionOf(row.id, row.versionId);
  const [skills, tools, versions, stats, reportsTo, knowledge, memoryScopes, skillShelf, toolShelf] = await Promise.all([
    dbRo()
      .select({
        id: s.agentSkill.skillVersionId,
        name: s.skill.skillName,
        declaredTools: s.skillVersion.declaredTools,
        ...skillApplication,
      })
      .from(s.agentSkill)
      .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.agentSkill.skillVersionId))
      .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
      .leftJoin(s.skillScanResult, eq(s.skillScanResult.skillVersionId, s.skillVersion.id))
      .where(eq(s.agentSkill.agentVersionId, editing.id))
      .orderBy(asc(s.skill.skillName)),
    dbRo()
      .select({
        id: s.connectorTool.id,
        connector: s.connector.code,
        tool: s.connectorTool.name,
        tier: s.connectorTool.tier,
        mode: s.agentToolMode.mode,
      })
      .from(s.agentToolMode)
      .innerJoin(s.connectorTool, eq(s.connectorTool.id, s.agentToolMode.connectorToolId))
      .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
      .where(eq(s.agentToolMode.agentVersionId, editing.id))
      .orderBy(asc(s.connector.code), asc(s.connectorTool.name)),
    dbRo()
      .select({
        versionNumber: s.agentVersion.versionNumber,
        publishedAt: s.agentVersion.publishedAt,
        publishedBy: s.agentVersion.publishedBy,
        evalScore: sql<number | null>`${s.agentVersion.evalScore}::float8`,
        isActive: s.agentVersion.isActive,
      })
      .from(s.agentVersion)
      .where(eq(s.agentVersion.agentId, row.id))
      .orderBy(desc(s.agentVersion.versionNumber)),
    dbRo()
      .select({
        runs: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${s.run.status} = 'Succeeded')::int`,
        cost: sql<number>`coalesce(sum(${s.run.estimatedCostAed}), 0)::float8`,
      })
      .from(s.run)
      .where(eq(s.run.agentId, row.id)),
    row.reportsToId
      ? dbRo()
          .select({ name: sql<string>`coalesce(p.name_en, a.name_en)` })
          .from(sql`(select 1) as one`)
          .leftJoin(sql`core.person p`, sql`p.id = ${row.reportsToId}`)
          .leftJoin(sql`ai.agent a`, sql`a.id = ${row.reportsToId}`)
      : Promise.resolve([]),
    dbRo()
      .select({
        id: s.knowledgeCollection.id,
        name: s.knowledgeCollection.nameEn,
        status: s.knowledgeCollection.status,
        granted: sql<boolean>`${s.agentKnowledgeAccess.agentVersionId} is not null`,
      })
      .from(s.knowledgeCollection)
      .leftJoin(
        s.agentKnowledgeAccess,
        and(eq(s.agentKnowledgeAccess.collectionId, s.knowledgeCollection.id), eq(s.agentKnowledgeAccess.agentVersionId, editing.id)),
      )
      .orderBy(asc(s.knowledgeCollection.nameEn)),
    // `UC-55.1`: the scopes this version may be granted — every scope but Session, which is
    // per-conversation and not something a designer configures ahead of time.
    dbRo()
      .select({
        id: s.memoryScope.id,
        kind: s.memoryScope.kind,
        name: sql<string>`coalesce(ou.name_en, a.name_en, 'Organisation')`,
        granted: sql<boolean>`${s.agentMemoryAccess.agentVersionId} is not null`,
        writable: sql<boolean>`${s.agentMemoryAccess.access} = 'ReadWrite'`,
      })
      .from(s.memoryScope)
      .leftJoin(sql`core.org_unit ou`, sql`ou.id = ${s.memoryScope.refId} and ${s.memoryScope.kind} = 'BusinessUnit'`)
      .leftJoin(sql`ai.agent a`, sql`a.id = ${s.memoryScope.refId} and ${s.memoryScope.kind} = 'Agent'`)
      .leftJoin(
        s.agentMemoryAccess,
        and(eq(s.agentMemoryAccess.memoryScopeId, s.memoryScope.id), eq(s.agentMemoryAccess.agentVersionId, editing.id)),
      )
      .where(sql`${s.memoryScope.kind} <> 'Session'`)
      .orderBy(asc(s.memoryScope.path)),
    // `UC-51.2-02`: the published skill versions this draft could take on. Attaching a
    // skill is a choice from what the platform has, so the shelf is read with the detail
    // rather than left for the designer to find somewhere else.
    dbRo()
      .select({
        id: s.skillVersion.id,
        name: s.skill.skillName,
        versionLabel: s.skillVersion.versionLabel,
        declaredTools: s.skillVersion.declaredTools,
      })
      .from(s.skillVersion)
      .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
      .where(eq(s.skillVersion.status, "Published"))
      .orderBy(asc(s.skill.skillName), asc(s.skillVersion.versionLabel)),
    // Every available connector tool. Which of them this agent may reach is decided below,
    // against the same allow-list `UC-51.2-05` uses for skills.
    dbRo()
      .select({
        id: s.connectorTool.id,
        connector: s.connector.code,
        tool: s.connectorTool.name,
        tier: s.connectorTool.tier,
      })
      .from(s.connectorTool)
      .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
      .where(eq(s.connectorTool.isAvailable, true))
      .orderBy(asc(s.connector.code), asc(s.connectorTool.name)),
  ]);

  const [counters] = await dbRo()
    .select({ runs: sql<number>`coalesce(bp.runs, 0)::int` })
    .from(sql`gov.agent_budget ab`)
    .innerJoin(sql`gov.budget_period bp`, sql`bp.budget_id = ab.id and bp.period_start = date_trunc('month', now())::date`)
    .where(sql`ab.agent_id = ${row.id}`);

  // `UC-51.2-05`: the connectors this agent is granted a tool of, so a skill that needs one
  // it has none of is caught when the skill is attached rather than when a run fails.
  const grantedConnectors = new Set(tools.map((tool) => tool.connector));
  const missingFor = (declaredTools: string[]) => [
    ...new Set(
      declaredTools
        .filter((tool) => tool.includes("/"))
        .map((tool) => tool.split("/")[0])
        .filter((connector) => connector && !grantedConnectors.has(connector)),
    ),
  ];

  // `UC-50.2-05`: why this agent is in error. Derived from its last failed run's last
  // failed step rather than stored on the agent: the agent's status already says it is in
  // error, and a copy of the reason beside it would be a second place for it to go stale.
  const [failure] = await dbRo()
    .select({ result: s.runStep.result })
    .from(s.runStep)
    .innerJoin(s.run, eq(s.run.id, s.runStep.runId))
    .where(and(eq(s.run.agentId, row.id), eq(s.runStep.status, "Failed")))
    .orderBy(desc(s.run.startedAt), desc(s.runStep.seq))
    .limit(1);

  return {
    code: row.code,
    lastFailure: failure?.result ?? null,
    profile: row.profile,
    model: row.model ?? "",
    fallbackModel: row.fallbackModel,
    reportsTo: reportsTo[0]?.name ?? null,
    trust: row.trust,
    versionLock: row.versionLock,
    memoryEnabled: row.memoryEnabled,
    budgetSoft: row.budgetSoft,
    budgetHard: row.budgetHard,
    instructions: editing.instructions ?? row.instructions,
    draft: editing.draftNumber === null ? null : `v${editing.draftNumber}`,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      enabled: skill.status === "Published",
      notApplied: skillNotApplied(skill),
      missingConnectors: missingFor(skill.declaredTools),
    })),
    tools: tools.map((tool) => ({ id: tool.id, ref: `${tool.connector}/${tool.tool}`, tier: tool.tier, mode: tool.mode })),
    skillShelf: skillShelf
      .filter((skill) => !skills.some((attached) => attached.id === skill.id))
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        versionLabel: skill.versionLabel,
        missingConnectors: missingFor(skill.declaredTools),
      })),
    toolShelf: toolShelf
      .filter((tool) => !tools.some((granted) => granted.id === tool.id))
      .map((tool) => ({ id: tool.id, ref: `${tool.connector}/${tool.tool}`, tier: tool.tier })),
    knowledge: knowledge.map((collection) => ({
      id: collection.id,
      name: collection.name,
      status: collection.status,
      granted: collection.granted,
    })),
    memory: memoryScopes.map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      name: scope.name,
      granted: scope.granted,
      writable: scope.writable,
    })),
    versions: versions.map((version) => ({
      v: `v${version.versionNumber}`,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      by: version.publishedBy ?? "",
      evalScore: version.evalScore,
      isActive: version.isActive,
    })),
    stats: {
      runs: counters?.runs ?? stats[0]?.runs ?? 0,
      successRatePct: stats[0] && stats[0].runs > 0 ? Math.round((stats[0].succeeded / stats[0].runs) * 1000) / 10 : 0,
      cost: stats[0]?.cost ?? 0,
      evalScore: row.evalScore,
    },
  };
}


/**
 * `UC-51.1-05`: the run budget on the agent's active version, if that version is still at
 * `version`. Returns the version's new lock.
 */
export async function setRunBudget(
  code: string,
  soft: number | null,
  hard: number | null,
  version: number,
  personId: string,
): Promise<number> {
  const rows = await db()
    .update(s.agentVersion)
    .set({ runBudgetSoftAed: soft, runBudgetHardAed: hard, updatedBy: personId, updatedAt: new Date() })
    .where(
      and(
        eq(s.agentVersion.version, version),
        sql`${s.agentVersion.id} = (select a.active_version_id from ai.agent a where a.code = ${code})`,
      ),
    )
    .returning({ version: s.agentVersion.version });
  assertWritten(rows, "AgentVersion");
  return rows[0].version;
}

/**
 * Whether this is the agent the platform ships and depends on (D65).
 *
 * Separate from `isSystemAgent`, which says an agent is the platform's own rather than one
 * a person configures. This is about whether the product still works without it. The AI
 * Assistant panel always runs the built-in agent.
 */
export async function isBuiltinAgent(code: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ isBuiltin: s.agent.isBuiltin })
    .from(s.agent)
    .where(eq(s.agent.code, code))
    .limit(1);
  return row?.isBuiltin ?? false;
}

/**
 * Whether the agent is marked `is_system`: one the platform ships for its own use, whose
 * trust no screen changes. False when no agent has that code.
 */
export async function isSystemAgent(code: string): Promise<boolean> {
  const [row] = await dbRo().select({ isSystem: s.agent.isSystem }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
  return row?.isSystem ?? false;
}

/** Trust on the agent's active version, if that version is still at `version`. Returns its new lock. */
export async function setTrust(code: string, trust: string, version: number, personId: string): Promise<number> {
  const rows = await db()
    .update(s.agentVersion)
    .set({ trust, updatedAt: new Date(), updatedBy: personId })
    .where(
      and(
        eq(s.agentVersion.version, version),
        sql`${s.agentVersion.id} = (select a.active_version_id from ai.agent a where a.code = ${code})`,
      ),
    )
    .returning({ version: s.agentVersion.version });
  assertWritten(rows, "AgentVersion");
  return rows[0].version;
}

/**
 * Data model section 23 rule 6: exactly one version of an agent is active, so publishing
 * or rolling back is a single transaction that clears the old one first.
 */
export async function activateVersion(code: string, versionNumber: number, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [agent] = await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
    if (!agent) throw new Error(`No agent ${code}.`);
    await tx.update(s.agentVersion).set({ isActive: false, updatedAt: new Date(), updatedBy: personId }).where(eq(s.agentVersion.agentId, agent.id));
    const [target] = await tx
      .update(s.agentVersion)
      .set({ isActive: true, publishedAt: new Date(), publishedBy: personId, updatedAt: new Date(), updatedBy: personId })
      .where(and(eq(s.agentVersion.agentId, agent.id), eq(s.agentVersion.versionNumber, versionNumber)))
      .returning({ id: s.agentVersion.id });
    if (!target) throw new Error(`Agent ${code} has no version ${versionNumber}.`);
    await tx.update(s.agent).set({ activeVersionId: target.id, updatedAt: new Date(), updatedBy: personId }).where(eq(s.agent.id, agent.id));
  });
}

/** How many of an agent's runs a delete refusal names. */
export const DELETE_BLOCKER_RUN_KEYS = 10;

/**
 * What still points at an agent and would block deleting it. The agent's own configuration —
 * its versions, skills, tool modes, budget, client exposure and connector access — cascades
 * away with it; everything counted here is a real use the database will otherwise refuse the
 * delete over, or a reference nothing enforces at the schema level (`reportsToType`/`Id` are
 * polymorphic, so no foreign key reaches them).
 */
export async function agentDeleteBlockers(agentId: string): Promise<{
  runs: number;
  /** The keys of its newest `DELETE_BLOCKER_RUN_KEYS` runs, so the refusal can name them. */
  runKeys: string[];
  embeddedDeployments: number;
  memoryReviews: number;
  memoryScopes: number;
  storylineSteps: number;
  reports: number;
}> {
  const [row] = await dbRo()
    .select({
      runs: sql<number>`(select count(*) from ai.run r where r.agent_id = ${agentId})::int`,
      runKeys: sql<string[]>`array(select r.key from ai.run r where r.agent_id = ${agentId} order by r.created_at desc limit ${DELETE_BLOCKER_RUN_KEYS})`,
      embeddedDeployments: sql<number>`(select count(*) from ai.embedded_deployment d where d.default_agent_id = ${agentId})::int`,
      memoryReviews: sql<number>`(select count(*) from ai.memory_review m where m.proposed_by_agent_id = ${agentId})::int`,
      // `memory_scope.kind`/`ref_id` is polymorphic, the same as `reports_to_type`/`Id` below:
      // nothing enforces it, so an agent's own memory bank would otherwise be silently
      // orphaned rather than counted here.
      memoryScopes: sql<number>`(select count(*) from ai.memory_scope sc where sc.kind = 'Agent' and sc.ref_id = ${agentId})::int`,
      storylineSteps: sql<number>`(select count(*) from ai.storyline_step s where s.agent_override_id = ${agentId})::int`,
      reports: sql<number>`(
        (select count(*) from core.person p where p.reports_to_type = 'Agent' and p.reports_to_id = ${agentId})
        + (select count(*) from ai.agent a where a.reports_to_type = 'Agent' and a.reports_to_id = ${agentId})
      )::int`,
    })
    .from(s.agent)
    .where(eq(s.agent.id, agentId))
    .limit(1);
  return row ?? { runs: 0, runKeys: [], embeddedDeployments: 0, memoryReviews: 0, memoryScopes: 0, storylineSteps: 0, reports: 0 };
}

/** Removes an agent the caller has already checked is not in use. */
export async function deleteAgent(agentId: string): Promise<void> {
  await db().delete(s.agent).where(eq(s.agent.id, agentId));
}

/**
 * Cancels a run that is still going and returns its id. A finished run is left alone and gives
 * `null`: `UC-52.1-11`, nothing was there to cancel.
 */
export async function cancelRun(key: string, personId: string): Promise<{ id: string } | null> {
  const [row] = await db()
    .update(s.run)
    .set({ status: "Cancelled", endedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.run.key, key), sql`${s.run.status} in ('Queued', 'Running', 'Waiting')`))
    .returning({ id: s.run.id });
  return row ?? null;
}

/** Everything a run needs from the agent's active version, to assemble a `RunInput`. */
export type RunnableAgent = {
  id: string;
  code: string;
  /** Idle, Running, Waiting, Paused, Error or Retired; a run refuses the last three. */
  status: string;
  versionId: string;
  nameEn: string;
  profile: string;
  instructions: string;
  /** The gateway route alias the run asks for, e.g. `reasoning-default`. */
  route: string;
  budgetSoft: number | null;
  budgetHard: number | null;
  organisationRules: string;
};

/**
 * `UC-03.1-01`: what an agent run is started from.
 *
 * Read here rather than in the agent service: the version, its instructions, its route and
 * its budget are this platform's data, and the permissions that decide whether this person
 * may start the run are evaluated against the same rows. The agent service is given an
 * assembled run, not a database.
 */
export async function readRunnableAgent(code: string): Promise<RunnableAgent | null> {
  const [row] = await dbRo()
    .select({
      id: s.agent.id,
      code: s.agent.code,
      // `UC-78.1-02`: a paused platform pauses every agent, which is one flag rather than a
      // status written onto each one. A run therefore asks the flag, not a copy of it.
      status: sql<string>`case
        when ${s.agent.status} = 'Error' then ${s.agent.status}
        when (select coalesce(bool_or(ss.agents_paused), false) from gov.system_state ss) then 'Paused'
        else ${s.agent.status} end`,
      versionId: s.agentVersion.id,
      nameEn: s.agent.nameEn,
      profile: s.agentVersion.executionProfile,
      instructions: s.agentVersion.instructions,
      route: sql<string | null>`(select r.alias from ai.route r where r.id = ${outer(s.agentVersion.primaryRouteId)})`,
      budgetSoft: sql<number | null>`${s.agentVersion.runBudgetSoftAed}::float8`,
      budgetHard: sql<number | null>`${s.agentVersion.runBudgetHardAed}::float8`,
    })
    .from(s.agent)
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(eq(s.agent.code, code))
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    status: row.status,
    versionId: row.versionId,
    nameEn: row.nameEn,
    profile: row.profile,
    instructions: row.instructions ?? "",
    // A version with no route still runs: the gateway's default chain is what an operator
    // configured for exactly this case, and refusing here would make the agent unusable
    // for a reason the person asking cannot fix.
    route: row.route ?? "reasoning-default",
    budgetSoft: row.budgetSoft,
    budgetHard: row.budgetHard,
    organisationRules: "",
  };
}

/**
 * Every other runnable agent, for `delegate_to_agent` to name a real one by (`UC-03.1-01`).
 *
 * The first line of its instructions stands in for a description no agent has: it is the
 * one sentence that already says what the agent is for.
 */
export async function delegatableAgents(excludeCode: string): Promise<{ code: string; nameEn: string; descriptionEn: string }[]> {
  const rows = await dbRo()
    .select({
      code: s.agent.code,
      nameEn: s.agent.nameEn,
      instructions: s.agentVersion.instructions,
      status: sql<string>`case
        when ${s.agent.status} = 'Error' then ${s.agent.status}
        when (select coalesce(bool_or(ss.agents_paused), false) from gov.system_state ss) then 'Paused'
        else ${s.agent.status} end`,
    })
    .from(s.agent)
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(sql`${s.agent.code} <> ${excludeCode}`);
  return rows
    .filter((row) => !NOT_RUNNABLE.includes(row.status))
    .map((row) => ({ code: row.code, nameEn: row.nameEn, descriptionEn: (row.instructions ?? "").split("\n")[0].slice(0, 200) }));
}

/**
 * The connectors a run may reach, by code: every enabled one (D227). Which of their tools
 * the run is offered is the agent version's own grant (`ai.agent_tool_mode`).
 */
export async function enabledConnectorCodes(): Promise<string[]> {
  const rows = await dbRo()
    .select({ code: s.connector.code })
    .from(s.connector)
    // A disabled connector is not reachable, so naming it in the token would be a grant
    // the platform does not honour.
    .where(eq(s.connector.isEnabled, true));
  return rows.map((row) => row.code);
}

/** Which language a person reads, so a run answers in it. */
export async function preferredLanguage(personId: string): Promise<"en" | "ar"> {
  const [row] = await dbRo()
    .select({ language: s.person.preferredLanguage })
    .from(s.person)
    .where(eq(s.person.id, personId))
    .limit(1);
  return row?.language === "ar" ? "ar" : "en";
}

/** `UC-50.2-02`: the agent codes already taken, lower-cased for comparison. */
export async function existingAgentCodes(): Promise<Set<string>> {
  const rows = await dbRo().select({ code: s.agent.code }).from(s.agent);
  return new Set(rows.map((row) => row.code.toLowerCase()));
}

/** The org unit the agent with this code belongs to (null for none), or null when there is no such agent. */
export async function agentOrgUnit(code: string): Promise<{ orgUnitId: string | null } | null> {
  const [row] = await dbRo().select({ orgUnitId: s.agent.orgUnitId }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
  return row ?? null;
}

/** The route behind an alias and its kind, for an agent's model route. */
export async function routeByAlias(alias: string): Promise<{ id: string; kind: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.route.id, kind: s.route.kind })
    .from(s.route)
    .where(eq(s.route.alias, alias))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-50.2-01`: a new agent and its first version.
 *
 * The version is left unpublished, which is what "draft" means here — `ai.agent` has no
 * Draft status, and inventing one would put the same fact in two places. An agent whose
 * active version has never been published is a draft; publishing it is `UC-51.4`.
 */
export async function insertAgent(values: {
  code: string;
  nameEn: string;
  nameAr: string;
  initials: string;
  orgUnitId: string | null;
  profile: string;
  trust: string;
  primaryRouteId: string | null;
  createdBy: string;
  /** Attached to this first version directly — it is already active, there is no draft to edit. */
  skillVersionIds?: string[];
}): Promise<string> {
  return db().transaction(async (tx) => {
    const [agent] = await tx
      .insert(s.agent)
      .values({
        code: values.code,
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        initials: values.initials,
        orgUnitId: values.orgUnitId,
        isSystem: false,
        status: "Idle",
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })
      .returning({ id: s.agent.id });

    const [version] = await tx
      .insert(s.agentVersion)
      .values({
        agentId: agent.id,
        versionNumber: 1,
        // Data model section 23 rule 6: exactly one version is active, and it is this one (UC-51.4-05).
        isActive: true,
        executionProfile: values.profile,
        trust: values.trust,
        primaryRouteId: values.primaryRouteId,
        memoryEnabled: false,
        releaseNotes: "",
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })
      .returning({ id: s.agentVersion.id });

    await tx.update(s.agent).set({ activeVersionId: version.id }).where(eq(s.agent.id, agent.id));

    if (values.skillVersionIds?.length) {
      await tx
        .insert(s.agentSkill)
        .values(values.skillVersionIds.map((skillVersionId) => ({ agentVersionId: version.id, skillVersionId })));
    }
    // The grant is written out, never implied (D38): a new agent starts with the default
    // and the row says so, which is what makes revoking one of them a change anybody can
    // see. A tool absent from this list is absent from the agent's token.
    await tx.insert(s.agentPlatformTool).values(
      DEFAULT_TOOL_GRANT.map((toolName) => ({
        agentVersionId: version.id,
        toolName,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })),
    );
    return agent.id;
  });
}

/** The model routes an agent may run on: the chat routes, by the kind each route declares. */
export async function routeAliases(): Promise<string[]> {
  const rows = await dbRo()
    .select({ alias: s.route.alias })
    .from(s.route)
    .where(inArray(s.route.kind, [...CHAT_ROUTE_KINDS]))
    .orderBy(asc(s.route.alias));
  return rows.map((row) => row.alias);
}

/**
 * The agent's editable revision, created from the active one if there is none.
 *
 * `UC-51.2-01`: an edit saves "a draft revision", not a change to what is running. A
 * version that has never been published is that draft; editing a published version in
 * place would change what every run in flight is executing.
 */
export async function draftVersionId(code: string, personId: string): Promise<string | null> {
  return db().transaction(async (tx) => {
    const [agent] = await tx
      .select({ id: s.agent.id, activeVersionId: s.agent.activeVersionId })
      .from(s.agent)
      .where(eq(s.agent.code, code))
      .limit(1);
    if (!agent) return null;

    const [existing] = await tx
      .select({ id: s.agentVersion.id })
      .from(s.agentVersion)
      .where(and(eq(s.agentVersion.agentId, agent.id), isNull(s.agentVersion.publishedAt)))
      .orderBy(desc(s.agentVersion.versionNumber))
      .limit(1);
    if (existing) return existing.id;

    // No draft yet: the next one starts as a copy of what is running, so a designer edits
    // from where the agent is rather than from nothing.
    const [active] = await tx
      .select()
      .from(s.agentVersion)
      .where(eq(s.agentVersion.id, agent.activeVersionId ?? ""))
      .limit(1);
    const [highest] = await tx
      .select({ versionNumber: s.agentVersion.versionNumber })
      .from(s.agentVersion)
      .where(eq(s.agentVersion.agentId, agent.id))
      .orderBy(desc(s.agentVersion.versionNumber))
      .limit(1);

    const [draft] = await tx
      .insert(s.agentVersion)
      .values({
        agentId: agent.id,
        versionNumber: (highest?.versionNumber ?? 0) + 1,
        instructions: active?.instructions ?? "",
        executionProfile: active?.executionProfile ?? "Task",
        primaryRouteId: active?.primaryRouteId ?? null,
        fallbackRouteId: active?.fallbackRouteId ?? null,
        trust: active?.trust ?? "Standard",
        memoryEnabled: active?.memoryEnabled ?? false,
        runBudgetSoftAed: active?.runBudgetSoftAed ?? null,
        runBudgetHardAed: active?.runBudgetHardAed ?? null,
        releaseNotes: "",
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.agentVersion.id });

    // The skills, tool modes and the platform grant come with it, or the draft would
    // publish an agent stripped of everything it was configured with.
    const skills = await tx
      .select({ skillVersionId: s.agentSkill.skillVersionId })
      .from(s.agentSkill)
      .where(eq(s.agentSkill.agentVersionId, active?.id ?? ""));
    if (skills.length) {
      await tx
        .insert(s.agentSkill)
        .values(skills.map((skill) => ({ agentVersionId: draft.id, skillVersionId: skill.skillVersionId })));
    }
    const tools = await tx
      .select({ connectorToolId: s.agentToolMode.connectorToolId, mode: s.agentToolMode.mode })
      .from(s.agentToolMode)
      .where(eq(s.agentToolMode.agentVersionId, active?.id ?? ""));
    if (tools.length) {
      await tx.insert(s.agentToolMode).values(
        tools.map((tool) => ({
          agentVersionId: draft.id,
          connectorToolId: tool.connectorToolId,
          mode: tool.mode,
        })),
      );
    }
    const granted = await tx
      .select({ toolName: s.agentPlatformTool.toolName })
      .from(s.agentPlatformTool)
      .where(eq(s.agentPlatformTool.agentVersionId, active?.id ?? ""));
    if (granted.length) {
      await tx.insert(s.agentPlatformTool).values(
        granted.map((tool) => ({
          agentVersionId: draft.id,
          toolName: tool.toolName,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }
    return draft.id;
  });
}

/** `UC-51.1-03` and `UC-51.2-01`: write the fields an edit changes onto the draft. */
export async function updateDraftVersion(
  versionId: string,
  values: Partial<{
    instructions: string;
    executionProfile: string;
    primaryRouteId: string | null;
    fallbackRouteId: string | null;
    memoryEnabled: boolean;
  }>,
  personId: string,
): Promise<void> {
  await db()
    .update(s.agentVersion)
    .set({ ...values, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.agentVersion.id, versionId));
}

/** A tool's tier and the mode this version gives it, for the tier floor. */
export async function connectorToolTier(connectorToolId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ tier: s.connectorTool.tier })
    .from(s.connectorTool)
    .where(eq(s.connectorTool.id, connectorToolId))
    .limit(1);
  return row?.tier ?? null;
}

/** `UC-51.2-03`: set how this version may call one tool. */
export async function setToolMode(
  versionId: string,
  connectorToolId: string,
  mode: string,
  personId: string,
): Promise<void> {
  await db()
    .insert(s.agentToolMode)
    .values({ agentVersionId: versionId, connectorToolId, mode, createdBy: personId, updatedBy: personId })
    .onConflictDoUpdate({
      target: [s.agentToolMode.agentVersionId, s.agentToolMode.connectorToolId],
      set: { mode, updatedAt: new Date(), updatedBy: personId },
    });
}

/** Take one connector tool off this version's grant. */
export async function revokeTool(versionId: string, connectorToolId: string): Promise<void> {
  await db()
    .delete(s.agentToolMode)
    .where(and(eq(s.agentToolMode.agentVersionId, versionId), eq(s.agentToolMode.connectorToolId, connectorToolId)));
}

/** The available tools of one connector, by id. */
export async function availableToolIdsOf(connectorCode: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ id: s.connectorTool.id })
    .from(s.connectorTool)
    .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
    .where(and(eq(s.connector.code, connectorCode), eq(s.connectorTool.isAvailable, true)));
  return rows.map((row) => row.id);
}

/**
 * Grant this version tools it does not hold yet. How many were added.
 *
 * A read (T0) is granted at Auto and anything else at Approval (D264): the tool's own tier
 * decides, and a tool already granted keeps the mode somebody gave it.
 */
export async function grantTools(versionId: string, toolIds: string[], personId: string): Promise<number> {
  if (!toolIds.length) return 0;
  const tools = await dbRo()
    .select({ id: s.connectorTool.id, tier: s.connectorTool.tier })
    .from(s.connectorTool)
    .where(inArray(s.connectorTool.id, toolIds));
  if (!tools.length) return 0;
  const added = await db()
    .insert(s.agentToolMode)
    .values(
      tools.map((tool) => ({
        agentVersionId: versionId,
        connectorToolId: tool.id,
        mode: tool.tier === "T0" ? "Auto" : "Approval",
        createdBy: personId,
        updatedBy: personId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: s.agentToolMode.connectorToolId });
  return added.length;
}

/** `UC-51.2-02`: add a skill to this version, or take it away. */
export async function setSkill(versionId: string, skillVersionId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await db()
      .insert(s.agentSkill)
      .values({ agentVersionId: versionId, skillVersionId })
      .onConflictDoNothing();
    return;
  }
  await db()
    .delete(s.agentSkill)
    .where(and(eq(s.agentSkill.agentVersionId, versionId), eq(s.agentSkill.skillVersionId, skillVersionId)));
}

/**
 * The platform and harness tools this version is granted (D38, D80).
 *
 * Ordered by name so a grant reads the same way every time it is recorded on a run row
 * and compared with the next one.
 */
export async function platformToolGrant(versionId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ toolName: s.agentPlatformTool.toolName })
    .from(s.agentPlatformTool)
    .where(eq(s.agentPlatformTool.agentVersionId, versionId))
    .orderBy(asc(s.agentPlatformTool.toolName));
  return rows.map((row) => row.toolName);
}

/** Grants this version a platform or harness tool, or revokes it. */
export async function setPlatformTool(versionId: string, toolName: string, enabled: boolean, personId: string): Promise<void> {
  if (enabled) {
    await db()
      .insert(s.agentPlatformTool)
      .values({ agentVersionId: versionId, toolName, createdBy: personId, updatedBy: personId })
      .onConflictDoNothing();
    return;
  }
  await db()
    .delete(s.agentPlatformTool)
    .where(and(eq(s.agentPlatformTool.agentVersionId, versionId), eq(s.agentPlatformTool.toolName, toolName)));
}

/**
 * How many runs one parent has already delegated, and how many are still going (D15).
 *
 * Depth alone does not bound a tree: one agent delegating fifty children is as
 * expensive as a deep chain and arrives much faster. Counted from the run rows rather
 * than held in the workflow, because the limit has to hold across a worker restart and
 * because the platform, not the agent, is what enforces it.
 */
export async function delegationCounts(parentRunId: string): Promise<{
  total: number;
  running: number;
}> {
  const [row] = await dbRo()
    .select({
      total: sql<number>`count(*)::int`,
      running: sql<number>`count(*) filter (where ${s.run.status} in ('Queued','Running','Waiting'))::int`,
    })
    .from(s.run)
    .where(eq(s.run.parentRunId, parentRunId));
  return { total: Number(row?.total ?? 0), running: Number(row?.running ?? 0) };
}

/** How many delegations above it a run sits: 0 for a mission a person started (D15). */
export async function delegationDepth(runId: string): Promise<number> {
  const result = await dbRo().execute<{ depth: number }>(sql`
    with recursive chain(id, parent_run_id, depth) as (
      select id, parent_run_id, 0 from ai.run where id = ${runId}
      union all
      select r.id, r.parent_run_id, chain.depth + 1
        from ai.run r join chain on r.id = chain.parent_run_id
       where chain.depth < 32
    )
    select coalesce(max(depth), 0)::int as depth from chain`);
  return Number(result.rows[0]?.depth ?? 0);
}

/**
 * Puts this version's platform tool grant back to exactly `tools`, in one transaction. An empty
 * list grants none.
 *
 * Replaces rather than merges: a reset that only added rows would leave behind every tool
 * somebody had granted since, which is not a reset.
 */
export async function replacePlatformToolGrant(
  versionId: string,
  tools: readonly string[],
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.agentPlatformTool).where(eq(s.agentPlatformTool.agentVersionId, versionId));
    if (tools.length === 0) return;
    await tx.insert(s.agentPlatformTool).values(
      tools.map((toolName) => ({
        agentVersionId: versionId,
        toolName,
        createdBy: personId,
        updatedBy: personId,
      })),
    );
  });
}

/** Restores the seeded instructions and budgets of one version. */
export async function resetVersionConfiguration(
  versionId: string,
  defaults: { instructions: string; budgetSoftAed: number; budgetHardAed: number },
  personId: string,
): Promise<void> {
  await db()
    .update(s.agentVersion)
    .set({
      instructions: defaults.instructions,
      runBudgetSoftAed: defaults.budgetSoftAed,
      runBudgetHardAed: defaults.budgetHardAed,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.agentVersion.id, versionId));
}

/**
 * Replaces the version's skills with the current published version of each named skill.
 * A name the platform has no published version of is left out.
 */
export async function replaceSkills(versionId: string, names: readonly string[]): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.agentSkill).where(eq(s.agentSkill.agentVersionId, versionId));
    if (names.length === 0) return;
    const current = await tx
      .select({ id: s.skillVersion.id })
      .from(s.skill)
      .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.skill.currentVersionId))
      .where(and(inArray(s.skill.skillName, [...names]), eq(s.skillVersion.status, "Published")));
    if (current.length > 0) {
      await tx.insert(s.agentSkill).values(current.map((row) => ({ agentVersionId: versionId, skillVersionId: row.id })));
    }
  });
}

/** Records which generation of the seeded defaults an agent now sits on. */
export async function markDefaultVersion(code: string, version: number): Promise<void> {
  await db().update(s.agent).set({ defaultVersion: version }).where(eq(s.agent.code, code));
}

/** Grants this version a knowledge collection to read, or revokes it. */
export async function setKnowledgeAccess(versionId: string, collectionId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await db()
      .insert(s.agentKnowledgeAccess)
      .values({ agentVersionId: versionId, collectionId })
      .onConflictDoNothing();
    return;
  }
  await db()
    .delete(s.agentKnowledgeAccess)
    .where(and(eq(s.agentKnowledgeAccess.agentVersionId, versionId), eq(s.agentKnowledgeAccess.collectionId, collectionId)));
}

/**
 * Grants this version a memory scope to read (or to write, via `access`), or revokes it.
 *
 * Without a grant `runPayloadFor` tells the harness no scope at all, so this is what makes
 * "agents use memory only within the scopes their configuration allows" (specification
 * §7.4.6) a real boundary rather than one with no way to ever be drawn.
 */
export async function setMemoryAccess(versionId: string, memoryScopeId: string, access: "Read" | "ReadWrite" | null): Promise<void> {
  if (access === null) {
    await db()
      .delete(s.agentMemoryAccess)
      .where(and(eq(s.agentMemoryAccess.agentVersionId, versionId), eq(s.agentMemoryAccess.memoryScopeId, memoryScopeId)));
    return;
  }
  await db()
    .insert(s.agentMemoryAccess)
    .values({ agentVersionId: versionId, memoryScopeId, access })
    .onConflictDoUpdate({ target: [s.agentMemoryAccess.agentVersionId, s.agentMemoryAccess.memoryScopeId], set: { access } });
}

/** The version's number and notes, for the publish rules. */
export async function readVersion(versionId: string): Promise<{
  versionNumber: number;
  releaseNotes: string | null;
  evalScore: number | null;
  publishedAt: Date | null;
} | null> {
  const [row] = await dbRo()
    .select({
      versionNumber: s.agentVersion.versionNumber,
      releaseNotes: s.agentVersion.releaseNotes,
      evalScore: sql<number | null>`${s.agentVersion.evalScore}::float8`,
      publishedAt: s.agentVersion.publishedAt,
    })
    .from(s.agentVersion)
    .where(eq(s.agentVersion.id, versionId))
    .limit(1);
  return row ?? null;
}

/** `UC-51.3-02`: publish the draft, making it the version new runs use. */
export async function publishVersion(
  code: string,
  versionId: string,
  releaseNotes: string,
  personId: string,
): Promise<number> {
  return db().transaction(async (tx) => {
    const [agent] = await tx.select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
    if (!agent) throw new Error(`No agent ${code}.`);

    await tx
      .update(s.agentVersion)
      .set({ isActive: false, updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.agentVersion.agentId, agent.id));

    const [published] = await tx
      .update(s.agentVersion)
      .set({
        releaseNotes,
        isActive: true,
        publishedAt: new Date(),
        publishedBy: personId,
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(eq(s.agentVersion.id, versionId))
      .returning({ id: s.agentVersion.id, versionNumber: s.agentVersion.versionNumber });

    await tx
      .update(s.agent)
      .set({ activeVersionId: published.id, updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.agent.id, agent.id));
    return published.versionNumber;
  });
}

/** A run's row id from the key the console shows, for the fields that reference a run. */
export async function runIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.run.id }).from(s.run).where(eq(s.run.key, key)).limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------- what a run writes back (S-12, S-52, S-71, S-72) */

/**
 * The people an approval is routed to.
 *
 * Whoever holds `approvals:decide` where the approval's project is (`UC-41.2-03`): an Allow at
 * the organisation, on the project's org unit or a unit above it, or on the project itself, or
 * an Allow anywhere with membership of the project, as `visibleProjectIds` reaches a project;
 * and no Deny at the organisation, on those units or on the project. With no project, only the
 * organisation-wide holders. Minus the person the run acts for — `UC-12.1-10`: approving your
 * own request is not a second pair of eyes.
 */
export async function approversFor(exceptPersonId: string, projectId: string | null): Promise<string[]> {
  // `UC-12.1-03`: a sequential approval goes to one approver after another, so the order
  // has to be the same every time it is read. By name, as the policy is written out.
  const grants = await dbRo()
    .select({
      personId: s.roleAssignment.personId,
      effect: s.rolePermission.effect,
      scopeType: s.roleAssignment.scopeType,
      scopeId: s.roleAssignment.scopeId,
    })
    .from(s.roleAssignment)
    .innerJoin(s.rolePermission, eq(s.rolePermission.roleId, s.roleAssignment.roleId))
    .innerJoin(s.permission, eq(s.permission.id, s.rolePermission.permissionId))
    .innerJoin(s.person, eq(s.person.id, s.roleAssignment.personId))
    .where(and(eq(s.permission.code, "approvals:decide"), eq(s.person.status, "Active")))
    .orderBy(asc(s.person.nameEn), asc(s.roleAssignment.personId));

  const { units, members } = projectId ? await projectScope(projectId) : { units: [], members: [] };
  const covers = (grant: (typeof grants)[number]) =>
    grant.scopeType === "Organisation" ||
    (grant.scopeType === "OrgUnit" && units.includes(grant.scopeId ?? "")) ||
    (grant.scopeType === "Project" && grant.scopeId === projectId);

  const byPerson = Map.groupBy(grants, (grant) => grant.personId);
  return [...byPerson]
    .filter(
      ([personId, held]) =>
        personId !== exceptPersonId &&
        !held.some((grant) => grant.effect === "Deny" && covers(grant)) &&
        held.some((grant) => grant.effect === "Allow" && (covers(grant) || members.includes(personId))),
    )
    .map(([personId]) => personId);
}

/** A project's org unit with every unit above it, and the people who are its members. */
async function projectScope(projectId: string): Promise<{ units: string[]; members: string[] }> {
  const [{ rows }, members] = await Promise.all([
    dbRo().execute<{ id: string }>(sql`
      with recursive up as (
        select org_unit_id as id from work.project where id = ${projectId} and org_unit_id is not null
        union all
        select unit.parent_org_unit_id from core.org_unit unit join up on unit.id = up.id where unit.parent_org_unit_id is not null
      )
      select id from up
    `),
    dbRo()
      .select({ id: s.projectMember.principalId })
      .from(s.projectMember)
      .where(and(eq(s.projectMember.projectId, projectId), eq(s.projectMember.principalType, "Person"))),
  ]);
  return { units: rows.map((row) => row.id), members: members.map((row) => row.id) };
}

/**
 * Why a bound approval did not let a call through, when it did not.
 *
 * Read only after the atomic claim below failed, so the call is already refused: this
 * names which of the bindings is the one that did not hold, which is what the agent has
 * to tell the person — "ask again" and "someone has already used that" are different
 * sentences.
 */
export type ApprovalClaimFailure =
  | "no_such_approval"
  | "not_approved"
  | "already_used"
  | "expired"
  | "wrong_run"
  | "wrong_tool"
  | "arguments_changed"
  | "record_changed";

/**
 * Spend one approval on exactly the call it was given for (D20, D21, D49).
 *
 * One statement, so two concurrent retries of the same approved call cannot both win:
 * `consumed_at is null` is in the WHERE, and only the update that sets it returns a row.
 * Every binding is in the same WHERE for the same reason — a check done in application
 * code before the update is a check two callers can both pass.
 */
export async function claimApproval(input: {
  approvalId: string;
  runId: string;
  toolName: string;
  argumentsHash: string;
  targetVersion: number | null;
}): Promise<{ ok: true; key: string } | { ok: false; reason: ApprovalClaimFailure }> {
  const claimed = await db()
    .update(s.approval)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(s.approval.id, input.approvalId),
        eq(s.approval.runId, input.runId),
        eq(s.approval.action, input.toolName),
        eq(s.approval.argumentsHash, input.argumentsHash),
        eq(s.approval.status, "Approved"),
        isNull(s.approval.consumedAt),
        sql`${s.approval.expiresAt} > now()`,
        input.targetVersion === null
          ? isNull(s.approval.targetVersion)
          : eq(s.approval.targetVersion, input.targetVersion),
      ),
    )
    .returning({ key: s.approval.key });
  if (claimed.length > 0) return { ok: true, key: claimed[0].key };

  const [row] = await dbRo()
    .select({
      runId: s.approval.runId,
      action: s.approval.action,
      argumentsHash: s.approval.argumentsHash,
      targetVersion: s.approval.targetVersion,
      status: s.approval.status,
      consumedAt: s.approval.consumedAt,
      expiresAt: s.approval.expiresAt,
    })
    .from(s.approval)
    .where(eq(s.approval.id, input.approvalId))
    .limit(1);

  if (!row) return { ok: false, reason: "no_such_approval" };
  if (row.runId !== input.runId) return { ok: false, reason: "wrong_run" };
  if (row.action !== input.toolName) return { ok: false, reason: "wrong_tool" };
  if (row.consumedAt) return { ok: false, reason: "already_used" };
  if (row.status !== "Approved") return { ok: false, reason: "not_approved" };
  if (!row.expiresAt || row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (row.argumentsHash !== input.argumentsHash) return { ok: false, reason: "arguments_changed" };
  return { ok: false, reason: "record_changed" };
}

/**
 * `UC-12.1-01`: inserts a pending approval under the next `APR-nnnn` key, with policy `AnyOf`,
 * and an open Inbox item for each approver, in one transaction. Returns its id and key.
 *
 * The arguments are stored as the harness redacted them: the console shows them to someone
 * about to authorise the call, so they have to be readable, and they must not carry a
 * credential the tool was handed.
 */
export async function createApproval(
  input: {
    runId: string;
    callId: string;
    action: string;
    argumentsRedacted: Record<string, unknown>;
    /** The canonical hash of the arguments this approval is an approval of (D20). */
    argumentsHash: string;
    /** The version of the record it targets, when the call names one. */
    targetVersion: number | null;
    /** When it stops counting. A pending approval left open is a standing grant (D21). */
    expiresAt: Date;
    reason: string;
    risk: string;
    workItemId: string | null;
    approvers: string[];
  },
  personId: string,
): Promise<{ id: string; key: string }> {
  const { approval, mail } = await db().transaction(async (tx) => {
    const { rows } = await tx.execute<{ nextKey: string }>(
      sql`select 'APR-' || lpad((coalesce(max(substring(key from 5)::int), 0) + 1)::text, 4, '0') as "nextKey"
          from ai.approval where key ~ '^APR-[0-9]+$'`,
    );

    const [approval] = await tx
      .insert(s.approval)
      .values({
        key: rows[0].nextKey,
        runId: input.runId,
        callId: input.callId,
        requestedByType: "Agent",
        workItemId: input.workItemId,
        action: input.action,
        argumentsRedacted: input.argumentsRedacted,
        argumentsHash: input.argumentsHash,
        targetVersion: input.targetVersion,
        expiresAt: input.expiresAt,
        evidence: input.reason,
        risk: input.risk,
        // One decision settles it. A policy needing more than one is the project's to set,
        // and nothing here may quietly require fewer.
        policy: "AnyOf",
        status: "Pending",
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.approval.id, key: s.approval.key });

    let mail: string[] = [];
    if (input.approvers.length > 0) {
      const items = await tx
        .insert(s.inboxItem)
        .values(
          input.approvers.map((approver) => ({
            personId: approver,
            kind: "Approval",
            sourceType: "Approval",
            sourceId: approval.id,
            status: "Open",
            createdBy: personId,
            updatedBy: personId,
          })),
        )
        .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
      mail = await queueAlertEmails(tx, {
        items,
        kind: "Approval",
        titleEn: `Approval needed: ${input.reason}`,
        titleAr: `اعتماد مطلوب: ${input.reason}`,
        path: "/inbox?filter=approval",
        actorId: personId,
      });
    }
    return { approval, mail };
  });
  await enqueueMailJobs(mail);
  return approval;
}

/** `UC-12.2-01`: the question a run waits on, in the inbox of the person it asked. */
export async function createQuestion(
  input: { runId: string; question: string; options: string[]; askedTo: string },
  personId: string,
): Promise<{ id: string }> {
  const { question, mail } = await db().transaction(async (tx) => {
    const [question] = await tx
      .insert(s.agentQuestion)
      .values({
        runId: input.runId,
        askedToType: "Person",
        askedToId: input.askedTo,
        question: input.question,
        options: input.options.length > 0 ? input.options : null,
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.agentQuestion.id });

    const items = await tx
      .insert(s.inboxItem)
      .values({
        personId: input.askedTo,
        kind: "Question",
        sourceType: "AgentQuestion",
        sourceId: question.id,
        status: "Open",
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
    const mail = await queueAlertEmails(tx, {
      items,
      kind: "Question",
      titleEn: `An agent asks: ${input.question}`,
      titleAr: `سؤال من وكيل: ${input.question}`,
      path: "/inbox?filter=question",
      actorId: personId,
    });
    return { question, mail };
  });
  await enqueueMailJobs(mail);
  return question;
}

/** One run by id, as the tools that write to it need it. */
export async function readRunById(runId: string): Promise<{
  id: string;
  key: string;
  agentId: string;
  agentCode: string;
  agentVersionId: string;
  route: string;
  personId: string | null;
  status: string;
  contextType: string;
  contextId: string | null;
  grantedTools: string[] | null;
  startedAt: Date | null;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.run.id,
      key: s.run.key,
      agentId: s.run.agentId,
      agentCode: s.agent.code,
      agentVersionId: s.run.agentVersionId,
      route: sql<string>`coalesce(r.alias, '')`,
      personId: s.run.createdBy,
      status: s.run.status,
      contextType: s.run.contextType,
      contextId: s.run.contextId,
      grantedTools: s.run.grantedTools,
      startedAt: s.run.startedAt,
    })
    .from(s.run)
    .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.run.agentVersionId))
    .leftJoin(sql`ai.route r`, sql`r.id = ${s.agentVersion.primaryRouteId}`)
    .where(eq(s.run.id, runId))
    .limit(1);
  return row ?? null;
}

/** D67: who started a run, and whether this person owns the room it runs in. */
export async function cancelScopeOf(key: string, personId: string): Promise<{ id: string; status: string; startedBy: string | null; roomOwner: boolean } | null> {
  const [row] = await dbRo()
    .select({
      id: s.run.id,
      status: s.run.status,
      startedBy: s.run.createdBy,
      roomOwner: sql<boolean>`${s.run.contextType} = 'Room' and exists (
        select 1 from work.room_participant p
        where p.room_id::text = ${s.run.contextId}::text and p.principal_type = 'Person'
          and p.principal_id = ${personId} and p.room_role = 'Owner')`,
    })
    .from(s.run)
    .where(eq(s.run.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * D300: a finished run with what is its own: its steps, its approvals and their decisions, its
 * questions, its playground tests and the Inbox items they raised. A replay of it and a run it
 * delegated to keep existing and lose the link. What it produced (messages, artifacts, emails)
 * stays.
 */
export async function deleteRun(runId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const approvals = sql`(select a.id from ai.approval a where a.run_id = ${runId})`;
    const questions = sql`(select q.id from ai.agent_question q where q.run_id = ${runId})`;
    await tx.execute(sql`delete from ai.inbox_item where (source_type = 'Approval' and source_id in ${approvals})
      or (source_type = 'AgentQuestion' and source_id in ${questions})`);
    await tx.execute(sql`delete from ai.approval where run_id = ${runId}`);
    await tx.execute(sql`delete from ai.agent_question where run_id = ${runId}`);
    await tx.execute(sql`delete from ai.playground_test where run_id = ${runId}`);
    await tx.execute(sql`delete from ai.run_step where run_id = ${runId}`);
    await tx.execute(sql`update ai.run set replay_of_run_id = null where replay_of_run_id = ${runId}`);
    await tx.delete(s.run).where(eq(s.run.id, runId));
  });
}

/**
 * Write what a run produced: its status, its totals, its last step and its handoff.
 *
 * Until this existed a finished run kept whatever it was created with — no cost, no token
 * counts, no output — so every screen reading a run read the moment it started.
 */
export async function finishRun(
  input: {
    runId: string;
    status: string;
    output: string;
    tokensIn: number;
    tokensOut: number;
    toolCallCount: number;
    estimatedCostAed: number;
    handoff: { goal: string; decisions: string; openQuestions: string; nextStep: string } | null;
    contextType: string;
    contextId: string | null;
    steps: {
      seq: number;
      type: string;
      name: string;
      status: string;
      result: string;
      hooksApplied: string[];
      estimatedCostAed: number;
      startedAt: Date;
      endedAt: Date;
    }[];
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(s.run)
      .set({
        status: input.status,
        endedAt: new Date(),
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        toolCallCount: input.toolCallCount,
        estimatedCostAed: input.estimatedCostAed,
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(eq(s.run.id, input.runId));

    const { rows } = await tx.execute<{ max: number }>(
      sql`select coalesce(max(seq), 0) as max from ai.run_step where run_id = ${input.runId}`,
    );
    const already = rows[0].max;

    // The harness's own timeline — one row per model, tool, approval and verify step it
    // recorded — is what the run viewer reads. A run the harness built before it carried
    // one falls back to a single marker, the only thing finishing it can still say.
    if (input.steps.length > 0) {
      await tx.insert(s.runStep).values(
        input.steps.map((step) => ({
          runId: input.runId,
          seq: already + step.seq,
          type: step.type,
          name: step.name,
          status: step.status,
          result: step.result || null,
          hooksApplied: step.hooksApplied,
          estimatedCostAed: step.estimatedCostAed,
          startedAt: step.startedAt,
          endedAt: step.endedAt,
        })),
      );
    } else {
      await tx.insert(s.runStep).values({
        runId: input.runId,
        seq: already + 1,
        type: "Handoff",
        name: "finish",
        status: input.status,
        result: input.output || null,
        estimatedCostAed: 0,
        endedAt: new Date(),
      });
    }

    // The handoff is what the next run in the same room, work item or request reads first,
    // so it belongs to the context rather than to this run; any other context's (a
    // deployment, the setup) is the run's own.
    if (input.handoff && input.contextId && input.contextType !== "None") {
      const byContext = (CONTEXT_HANDOFF_OWNERS as readonly string[]).includes(input.contextType);
      await tx
        .insert(s.contextHandoff)
        .values({
          ownerType: byContext ? input.contextType : "Run",
          ownerId: byContext ? input.contextId : input.runId,
          goal: input.handoff.goal,
          decisions: input.handoff.decisions,
          openQuestions: input.handoff.openQuestions,
          nextStep: input.handoff.nextStep,
          createdBy: personId,
          updatedBy: personId,
        })
        .onConflictDoUpdate({
          target: [s.contextHandoff.ownerType, s.contextHandoff.ownerId],
          set: {
            goal: input.handoff.goal,
            decisions: input.handoff.decisions,
            openQuestions: input.handoff.openQuestions,
            nextStep: input.handoff.nextStep,
            updatedAt: new Date(),
            updatedBy: personId,
          },
        });
    }
  });
}

/**
 * The tools a run was granted when it started, or null when the row predates the column.
 *
 * Null and empty are different: an older run never recorded a grant, which is not the
 * same as having been granted nothing. A caller deciding a child's grant has to treat
 * the first as "fall back to the configuration" and the second as "nothing".
 */
export async function grantedToolsOf(runId: string): Promise<string[] | null> {
  const [row] = await dbRo()
    .select({ grantedTools: s.run.grantedTools })
    .from(s.run)
    .where(eq(s.run.id, runId))
    .limit(1);
  return row?.grantedTools ?? null;
}

/**
 * Narrow a run's recorded grant to what a refresh just derived (D50).
 *
 * Only ever downwards. The snapshot follows the grant down so a later refresh cannot
 * widen back to what the row said before this one narrowed it — without that, revoking a
 * tool would hold only until the next refresh read the old snapshot again.
 */
export async function narrowRunGrant(runId: string, tools: string[]): Promise<void> {
  await db().update(s.run).set({ grantedTools: tools }).where(eq(s.run.id, runId));
}

/**
 * Opens the run row the platform shows, before the agent service is asked to run it: a Queued
 * row with its recorded grant, keyed `RUN-` and the next number after the highest in use (88001
 * for the first run). Returns the key.
 *
 * The platform owns the record because it owns the key the console shows, the budget the run
 * spends against and the audit it writes.
 */
export async function openRun(input: {
  id: string;
  agentId: string;
  agentVersionId: string;
  trigger: string;
  contextType: string;
  contextId: string | null;
  temporalWorkflowId: string | null;
  replayOfRunId: string | null;
  replayFromStep: number | null;
  personId: string;
  /** Exactly the tools the run may call, recorded so a resume cannot widen it (D35). */
  grantedTools: string[];
  /** The run that delegated this one, so the runs of one mission form a tree (D46). */
  parentRunId?: string | null;
}): Promise<string> {
  const { rows } = await db().execute<{ next: number }>(
    sql`select coalesce(max(substring(key from '[0-9]+$')::int), 88000) + 1 as next from ai.run`,
  );
  const key = `RUN-${rows[0]?.next ?? 88001}`;
  await db()
    .insert(s.run)
    .values({
      id: input.id,
      key,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      trigger: input.trigger,
      contextType: input.contextType,
      contextId: input.contextId,
      status: "Queued",
      startedAt: new Date(),
      temporalWorkflowId: input.temporalWorkflowId,
      replayOfRunId: input.replayOfRunId,
      replayFromStep: input.replayFromStep,
      grantedTools: input.grantedTools,
      parentRunId: input.parentRunId ?? null,
      createdBy: input.personId,
      updatedBy: input.personId,
    });
  return key;
}

/** The statuses `markRunStatus` treats as over — `finishRun` is the only other way to reach one. */
const TERMINAL_RUN_STATUSES = new Set(["Succeeded", "Failed", "Cancelled", "BudgetExceeded"]);

/**
 * Move a run to a status it reached without finishing, such as a start that was refused,
 * or a pause for an approval or a question. `endedAt` is only stamped on a terminal status —
 * `Waiting` is not one, and a run paused for a person is not a run that has ended.
 */
export async function markRunStatus(runId: string, status: string, personId: string): Promise<void> {
  await db()
    .update(s.run)
    .set({
      status,
      endedAt: TERMINAL_RUN_STATUSES.has(status) ? new Date() : null,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.run.id, runId));
}

/**
 * The row a run is about, from the key the screens use.
 *
 * The console names a work item `TSK-2301` and a room `SES-1037`; the run row points at
 * the row itself, so a run started from a screen is still linked to what it was about.
 */
export async function contextIdForKey(contextType: string, key: string): Promise<string | null> {
  const table =
    contextType === "WorkItem" ? s.workItem : contextType === "Room" ? s.discussionRoom : contextType === "Request" ? s.request : null;
  if (!table) return null;
  const [row] = await dbRo().select({ id: table.id }).from(table).where(eq(table.key, key)).limit(1);
  return row?.id ?? null;
}

/**
 * The connector codes one project allows. An empty list means the project has no
 * allow-list, which is every connector the agent itself may reach (data model section 4).
 */
export async function connectorCodesForProject(projectId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ code: s.connector.code })
    .from(s.projectAllowedConnector)
    .innerJoin(s.connector, eq(s.connector.id, s.projectAllowedConnector.connectorId))
    .where(and(eq(s.projectAllowedConnector.projectId, projectId), eq(s.connector.isEnabled, true)));
  return [...new Set(rows.map((row) => row.code))];
}

/** The project a run's context belongs to, so the project's policy applies to the run. */
export async function projectOfContext(contextType: string, contextId: string): Promise<string | null> {
  const table =
    contextType === "WorkItem" ? s.workItem : contextType === "Room" ? s.discussionRoom : contextType === "Request" ? s.request : null;
  if (!table) return null;
  const [row] = await dbRo().select({ projectId: table.projectId }).from(table).where(eq(table.id, contextId)).limit(1);
  return row?.projectId ?? null;
}

/**
 * A tool's tier under the agent's own mode.
 *
 * Section 23 rule 4: an agent's mode is never looser than the tool's tier. `Approval` makes
 * a tool need one whatever its tier says, and `Denied` is not offered at all — a tool the
 * designer turned off must not reach the model, because a model that can see it will try.
 */
function tierUnderMode(tier: string, mode: string): RunTool["tier"] | null {
  if (mode === "Denied") return null;
  const own = (["T0", "T1", "T2", "T3"] as const).includes(tier as RunTool["tier"])
    ? (tier as RunTool["tier"])
    : "T1";
  if (mode === "Approval" && (own === "T0" || own === "T1")) return "T2";
  return own;
}

/** `UC-57.1`: which retrieval mode a collection's index supports. */
function retrievalMode(indexConfig: Record<string, unknown>): RunKnowledge["mode"] {
  const type = String(indexConfig.type ?? "Hybrid");
  return type === "Vector" || type === "Graph" ? type : "Hybrid";
}

/** The route a collection's passages were actually embedded with. */
function embeddingRouteOf(modelsConfig: Record<string, unknown>): string {
  return String(modelsConfig.embeddingRoute ?? "");
}

/**
 * Everything the agent's published version brings to a run.
 *
 * @param versionId the active version the run was started against.
 * @param connectorCodes the connectors this run may reach, already narrowed by the project
 *   policy (`UC-21.2-02`). A tool on a connector outside this list is not offered.
 */
export async function runPayloadFor(versionId: string, connectorCodes: string[]): Promise<RunPayload> {
  const [toolRows, skillRows, knowledgeRows, memoryRows] = await Promise.all([
    connectorCodes.length === 0
      ? Promise.resolve([])
      : dbRo()
          .select({
            name: s.connectorTool.name,
            connectorCode: s.connector.code,
            connectorId: s.connector.id,
            description: s.connectorTool.descriptionEn,
            tier: s.connectorTool.tier,
            mode: s.agentToolMode.mode,
            transport: s.connector.transport,
            operation: s.connectorTool.operation,
          })
          .from(s.agentToolMode)
          .innerJoin(s.connectorTool, eq(s.connectorTool.id, s.agentToolMode.connectorToolId))
          .innerJoin(s.connector, eq(s.connector.id, s.connectorTool.connectorId))
          .where(
            and(
              eq(s.agentToolMode.agentVersionId, versionId),
              eq(s.connector.isEnabled, true),
              eq(s.connectorTool.isAvailable, true),
              inArray(s.connector.code, connectorCodes),
            ),
          ),
    dbRo()
      .select({
        id: s.skillVersion.id,
        name: s.skill.skillName,
        description: s.skill.descriptionEn,
        packageRef: s.skillVersion.packageRef,
        declaredTools: s.skillVersion.declaredTools,
        ...skillApplication,
      })
      .from(s.agentSkill)
      .innerJoin(s.skillVersion, eq(s.skillVersion.id, s.agentSkill.skillVersionId))
      .innerJoin(s.skill, eq(s.skill.id, s.skillVersion.skillId))
      .leftJoin(s.skillScanResult, eq(s.skillScanResult.skillVersionId, s.skillVersion.id))
      .where(eq(s.agentSkill.agentVersionId, versionId)),
    dbRo()
      .select({
        collectionId: s.knowledgeCollection.collectionId,
        name: s.knowledgeCollection.nameEn,
        indexConfig: s.knowledgeCollection.indexConfigJson,
        modelsConfig: s.knowledgeCollection.modelsConfigJson,
      })
      .from(s.agentKnowledgeAccess)
      .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.agentKnowledgeAccess.collectionId))
      .where(eq(s.agentKnowledgeAccess.agentVersionId, versionId)),
    dbRo()
      .select({
        scope: s.memoryScope.kind,
        scopeId: s.memoryScope.refId,
        access: s.agentMemoryAccess.access,
      })
      .from(s.agentMemoryAccess)
      .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.agentMemoryAccess.memoryScopeId))
      .where(eq(s.agentMemoryAccess.agentVersionId, versionId)),
  ]);

  const tools: RunTool[] = [];
  for (const row of toolRows) {
    const tier = tierUnderMode(row.tier, row.mode);
    if (!tier) continue;
    // `UC-54.1-09`: an OpenAPI connector's operations are called by this application, not
    // by the connector runtime, because the credential is stored here. The harness routes
    // by `server`, so naming `platform` is what sends the call to the right place — and
    // the operation's own schema goes with it, so the model fills in real parameters
    // instead of being handed an empty object.
    const openApi = row.transport === "OpenApi";
    tools.push({
      // The harness names a connector tool the way the console does, so an approval and a
      // run step read as the same tool on both screens.
      name: `${row.connectorCode}/${row.name}`,
      description: row.description ?? "",
      parameters_json_schema:
        (openApi ? ((row.operation as { parametersJsonSchema?: Record<string, unknown> } | null)?.parametersJsonSchema) : undefined) ??
        { type: "object" },
      tier,
      server: openApi ? "platform" : "connector",
      ...(openApi ? {} : { connector_id: row.connectorId }),
    });
  }

  // A pinned skill that may not reach a run is left out, as the agent screen says (D156):
  // a draft version, or an uploaded one whose scan is missing or failed.
  const skills = skillRows.filter((row) => {
    const reason = skillNotApplied(row);
    if (reason) logger().warn({ versionId, skill: row.name, reason }, "skill not applied to the run");
    return reason === null;
  });

  return {
    tools,
    skills: skills.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      // The skill's folder in the bundle the agent image carries.
      path: row.name,
      declared_tools: row.declaredTools ?? [],
      // Anything not bundled is read from the object store by the agent service.
      package_ref: row.sourceType === "Bundled" ? null : row.packageRef,
    })),
    knowledge: knowledgeRows.map((row) => ({
      collection_id: row.collectionId,
      name: row.name,
      mode: retrievalMode(row.indexConfig),
      embedding_route: embeddingRouteOf(row.modelsConfig),
    })),
    memory: memoryRows.map((row) => ({
      scope: row.scope as RunMemory["scope"],
      scope_id: row.scopeId,
      writable: row.access !== "Read",
    })),
  };
}

/**
 * D384: the last `limit` audit entries of one record by its label (its key) since `since`, oldest
 * first, read from the primary because the brief that lists them follows the write that started the
 * run. A key can be reused after its record is deleted, so entries before the record existed are not its own.
 */
export async function auditTrailOf(objectType: string, objectLabel: string, since: Date, limit = 20) {
  const rows = await db()
    .select({ at: s.auditEntry.at, actor: s.auditEntry.actorLabel, action: s.auditEntry.action, outcome: s.auditEntry.outcome })
    .from(s.auditEntry)
    .where(and(eq(s.auditEntry.objectType, objectType), eq(s.auditEntry.objectLabel, objectLabel), gte(s.auditEntry.at, since)))
    .orderBy(desc(s.auditEntry.at))
    .limit(limit);
  return rows.reverse();
}
