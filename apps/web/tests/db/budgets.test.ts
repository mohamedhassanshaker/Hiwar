import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-71 the budgets, S-72 one budget and what crossing its lines does.
 *
 * The decisions here are about money that is always an estimate, and about the one moment
 * it moves: a run finishing. Nothing sweeps for crossings afterwards, so a threshold has
 * to be crossed by a particular run and acted on there.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("budgets", () => {
  let ownerId = "";
  let memberId = "";
  /** An agent with no budget of its own, so these cases cannot disturb a seeded one. */
  let agentCode = "";
  let agentId = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;

    const agent = await testPool().query<{ id: string; code: string }>(
      `select a.id, a.code from ai.agent a
       where not exists (select 1 from gov.agent_budget b where b.agent_id = a.id)
       order by a.code limit 1`,
    );
    agentId = agent.rows[0].id;
    agentCode = agent.rows[0].code;
  });

  afterEach(async () => {
    await testPool().query("delete from gov.agent_budget where agent_id = $1", [agentId]);
    await testPool().query("update ai.agent set status = 'Idle' where id = $1 and status = 'Paused'", [agentId]);
    await testPool().query("delete from ai.inbox_item where source_type = 'Budget'");
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const budget = (over: Partial<Record<string, unknown>> = {}) => ({
    agentCode,
    limitAed: 100,
    period: "Monthly" as const,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    warnAtPct: 80,
    actionAt100: "PauseAgent" as const,
    ...over,
  });

  it("UC-71.1-03 UC-71.1-04 a budget with no end date is kept forever", async () => {
    const { saveBudget } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    await saveBudget(budget());
    const stored = await testPool().query<{ effective_to: Date | null; action_at_100: string }>(
      "select effective_to, action_at_100 from gov.agent_budget where agent_id = $1",
      [agentId],
    );
    expect(stored.rows[0].effective_to).toBeNull();
    expect(stored.rows[0].action_at_100).toBe("PauseAgent");

    // The change is recorded with what it set, not merely that something was saved.
    const change = await testPool().query<{ description_en: string }>(
      `select bc.description_en from gov.budget_change bc
       join gov.agent_budget ab on ab.id = bc.budget_id where ab.agent_id = $1`,
      [agentId],
    );
    expect(change.rows[0].description_en).toContain("100.00");
  });

  it("UC-72.1-02 UC-72.1-08 a new budget has no history, and an edit says what it set", async () => {
    const { saveBudget } = await import("@/features/budgets/service");
    const { readDetails } = await import("@/features/budgets/repository");
    signedInAs = ownerId;

    await saveBudget(budget({ limitAed: 100 }));
    const existing = await testPool().query<{ id: string }>(
      "select id from gov.agent_budget where agent_id = $1",
      [agentId],
    );
    // `UC-72.1-08`: nothing has run under it, so the charts have nothing to draw.
    const fresh = (await readDetails([existing.rows[0].id]))[existing.rows[0].id];
    expect(fresh.periods).toEqual([]);

    await saveBudget(budget({ budgetId: existing.rows[0].id, limitAed: 250 }));

    // `UC-72.1-02`: the change log says what the limit became, not that something changed.
    const changes = await testPool().query<{ description_en: string }>(
      `select bc.description_en from gov.budget_change bc
       join gov.agent_budget ab on ab.id = bc.budget_id
       where ab.agent_id = $1 order by bc.at`,
      [agentId],
    );
    expect(changes.rows.at(-1)?.description_en).toContain("250.00");
    // Edited rather than added: one window, not two.
    const windows = await testPool().query("select 1 from gov.agent_budget where agent_id = $1", [agentId]);
    expect(windows.rowCount).toBe(1);
  });

  it("UC-71.1-05 switching to a cheaper alias needs an alias to switch to", async () => {
    const { saveBudget, BudgetRejected } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    await expect(saveBudget(budget({ actionAt100: "SwitchToCheaperAlias" }))).rejects.toBeInstanceOf(
      BudgetRejected,
    );
    await expect(
      saveBudget(budget({ actionAt100: "SwitchToCheaperAlias", cheaperRouteAlias: "no-such-route" })),
    ).rejects.toBeInstanceOf(BudgetRejected);

    await saveBudget(budget({ actionAt100: "SwitchToCheaperAlias", cheaperRouteAlias: "small-fast" }));
    const stored = await testPool().query<{ alias: string }>(
      `select r.alias from gov.agent_budget ab
       join ai.route r on r.id = ab.cheaper_route_id where ab.agent_id = $1`,
      [agentId],
    );
    expect(stored.rows[0].alias).toBe("small-fast");
  });

  it("UC-71.1-06 refuses a limit of zero, a warning at 100 and a window that ends first", async () => {
    const { saveBudget, BudgetRejected } = await import("@/features/budgets/service");
    const { saveBudgetInput } = await import("@/features/budgets/schema");
    signedInAs = ownerId;

    expect(() => saveBudgetInput.parse(budget({ limitAed: 0 }))).toThrow();
    // Warning at 100% would fire at the same moment as the limit, so it is not a warning.
    expect(() => saveBudgetInput.parse(budget({ warnAtPct: 100 }))).toThrow();
    expect(() => saveBudgetInput.parse(budget({ warnAtPct: 0 }))).toThrow();

    await expect(
      saveBudget(budget({ effectiveFrom: "2026-06-01", effectiveTo: "2026-05-01" })),
    ).rejects.toBeInstanceOf(BudgetRejected);
  });

  it("UC-71.1-07 refuses a window that overlaps one the agent already has, naming it", async () => {
    const { saveBudget } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    await saveBudget(budget({ effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }));

    // Two limits in force at the same moment is not a limit.
    await expect(
      saveBudget(budget({ effectiveFrom: "2026-05-01", effectiveTo: "2026-12-31" })),
    ).rejects.toThrow(/2026-01-01/);

    // A window that starts after the first ends is accepted.
    await saveBudget(budget({ effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31" }));
    const windows = await testPool().query("select 1 from gov.agent_budget where agent_id = $1", [agentId]);
    expect(windows.rowCount).toBe(2);
  });

  it("UC-71.1-07 a window may start the moment another ends, since a window excludes its end", async () => {
    const { saveBudget } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    await saveBudget(budget({ effectiveFrom: "2026-07-01", effectiveTo: null }));
    await saveBudget(budget({ effectiveFrom: "2026-06-01", effectiveTo: "2026-07-01" }));
    const windows = await testPool().query("select 1 from gov.agent_budget where agent_id = $1", [agentId]);
    expect(windows.rowCount).toBe(2);
  });

  it("D349 the screen reads the history of the window it shows, and of no other", async () => {
    const { createBudget, loadBudgets } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    const first = await createBudget(budget({ limitAed: 1000, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }));
    const second = await createBudget(budget({ limitAed: 2000, effectiveFrom: "2026-07-01", effectiveTo: null }));

    const viewing = await loadBudgets(second);
    expect(Object.keys(viewing.details)).toEqual([second]);
    expect(viewing.budgets.map((row) => row.id)).toEqual(expect.arrayContaining([first, second]));
    expect((await loadBudgets()).details).toEqual({});
    // An address that names no window reads none, and never reaches the uuid column.
    expect((await loadBudgets("not-a-budget")).details).toEqual({});
  });

  it("UC-72.1-07 each of an agent's windows shows its own periods and changes", async () => {
    const { createBudget, recordRunSpend } = await import("@/features/budgets/service");
    const { readDetails } = await import("@/features/budgets/repository");
    signedInAs = ownerId;

    const first = await createBudget(budget({ limitAed: 1000, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }));
    const second = await createBudget(budget({ limitAed: 2000, effectiveFrom: "2026-07-01", effectiveTo: null }));
    await recordRunSpend({ agentId, amountAed: 40, at: new Date("2026-03-15T10:00:00Z"), actedBy: ownerId });
    await recordRunSpend({ agentId, amountAed: 5, at: new Date("2026-08-15T10:00:00Z"), actedBy: ownerId });

    const details = await readDetails([first, second]);
    expect(details[first].periods.map((period) => [period.startsAt.slice(0, 7), period.spent, period.limit])).toEqual([
      ["2026-03", 40, 1000],
    ]);
    expect(details[second].periods.map((period) => [period.startsAt.slice(0, 7), period.spent, period.limit])).toEqual([
      ["2026-08", 5, 2000],
    ]);
    expect(details[first].changes).toHaveLength(1);
    expect(details[second].changes).toHaveLength(1);
  });

  it("UC-71.1-08 the export labels every money column an estimate", async () => {
    const { exportBudgets } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    const { filename, csv } = await exportBudgets();
    const [header] = csv.split(String.fromCharCode(10));
    expect(filename).toContain("estimated");
    // A spreadsheet keeps no context, so the columns have to carry it.
    for (const column of ["limit_aed_estimated", "spend_aed_estimated", "forecast_aed_estimated"]) {
      expect(header).toContain(column);
    }
  });

  it("UC-71.1-09 a member is refused the screen, and a designer may only read it", async () => {
    const { loadBudgets, saveBudget } = await import("@/features/budgets/service");
    const { NotPermitted } = await import("@/lib/session");

    // A Member holds neither permission, so Budgets is hidden rather than read-only.
    signedInAs = memberId;
    await expect(loadBudgets()).rejects.toBeInstanceOf(NotPermitted);

    // An Agent Designer may see what their agents cost and change none of it.
    const designer = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'omar@tahseel.ae'",
    );
    signedInAs = designer.rows[0].id;
    await expect(loadBudgets()).resolves.toBeTruthy();
    await expect(saveBudget(budget())).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-72.1-04 crossing the warning sends one warning, not one per run", async () => {
    const { saveBudget, recordRunSpend } = await import("@/features/budgets/service");
    signedInAs = ownerId;
    await saveBudget(budget({ limitAed: 100, warnAtPct: 80, actionAt100: "NotifyOnly" }));

    const first = await recordRunSpend({ agentId, amountAed: 70, actedBy: ownerId });
    expect(first.warned).toBe(false);

    const crossing = await recordRunSpend({ agentId, amountAed: 15, actedBy: ownerId });
    expect(crossing.warned).toBe(true);
    expect(crossing.spent).toBe(85);

    // Already past the line: a budget does not warn again every run for the rest of it.
    const after = await recordRunSpend({ agentId, amountAed: 1, actedBy: ownerId });
    expect(after.warned).toBe(false);

    const events = await testPool().query<{ type: string }>(
      `select be.type from gov.budget_event be
       join gov.agent_budget ab on ab.id = be.budget_id where ab.agent_id = $1`,
      [agentId],
    );
    expect(events.rows.map((row) => row.type)).toEqual(["WarningSent"]);
  });

  it("UC-72.1-05 reaching the limit with pause-agent pauses the agent", async () => {
    const { saveBudget, recordRunSpend } = await import("@/features/budgets/service");
    signedInAs = ownerId;
    await saveBudget(budget({ limitAed: 50, warnAtPct: 90, actionAt100: "PauseAgent" }));

    const outcome = await recordRunSpend({ agentId, amountAed: 60, actedBy: ownerId });
    expect(outcome.hardLimit).toBe(true);

    const agent = await testPool().query<{ status: string }>("select status from ai.agent where id = $1", [
      agentId,
    ]);
    expect(agent.rows[0].status).toBe("Paused");

    const events = await testPool().query<{ type: string }>(
      `select be.type from gov.budget_event be
       join gov.agent_budget ab on ab.id = be.budget_id where ab.agent_id = $1 order by be.at`,
      [agentId],
    );
    expect(events.rows.map((row) => row.type)).toContain("HardLimitReached");
  });

  it("UC-72.1-06 notify-only records the event and leaves the agent running", async () => {
    const { saveBudget, recordRunSpend } = await import("@/features/budgets/service");
    signedInAs = ownerId;
    await saveBudget(budget({ limitAed: 50, actionAt100: "NotifyOnly" }));

    const outcome = await recordRunSpend({ agentId, amountAed: 60, actedBy: ownerId });
    expect(outcome.hardLimit).toBe(true);

    const agent = await testPool().query<{ status: string }>("select status from ai.agent where id = $1", [
      agentId,
    ]);
    expect(agent.rows[0].status).not.toBe("Paused");
  });

  it("UC-72.1-07 a new period starts at zero and the previous one stays as history", async () => {
    const { saveBudget, recordRunSpend } = await import("@/features/budgets/service");
    const { periodWindow } = await import("@/features/budgets/repository");
    signedInAs = ownerId;
    await saveBudget(budget({ limitAed: 1000, period: "Monthly" }));

    const january = new Date("2026-01-15T10:00:00Z");
    const february = new Date("2026-02-02T10:00:00Z");
    await recordRunSpend({ agentId, amountAed: 40, at: january, actedBy: ownerId });
    const next = await recordRunSpend({ agentId, amountAed: 5, at: february, actedBy: ownerId });

    // The new period starts at this run's cost, not at the last period's total.
    expect(next.spent).toBe(5);
    expect(periodWindow("Monthly", january).start.toISOString()).toContain("2026-01-01");

    const periods = await testPool().query<{ spend: string }>(
      `select bp.estimated_spend_aed as spend from gov.budget_period bp
       join gov.agent_budget ab on ab.id = bp.budget_id
       where ab.agent_id = $1 order by bp.period_start`,
      [agentId],
    );
    expect(periods.rows.map((row) => Number(row.spend))).toEqual([40, 5]);
  });

  it("UC-72.1-01 an agent with no budget in force costs nothing to account", async () => {
    const { recordRunSpend } = await import("@/features/budgets/service");
    signedInAs = ownerId;

    const outcome = await recordRunSpend({ agentId, amountAed: 99, actedBy: ownerId });
    expect(outcome.budgetId).toBeNull();
    expect(outcome.warned).toBe(false);
    expect(outcome.hardLimit).toBe(false);
  });
  /** The version a window is on, which an edit has to name back. */
  const budgetVersion = async (budgetId: string) => {
    const { rows } = await testPool().query<{ version: number }>(
      "select version from gov.agent_budget where id = $1",
      [budgetId],
    );
    return rows[0].version;
  };

  it("UC-71.1-04 says when an edit leaves the agent with no limit and takes the stop away", async () => {
    const { createBudget, updateBudget } = await import("@/features/budgets/service");
    signedInAs = ownerId;
    const budgetId = await createBudget(budget());

    // Moving the warning threshold takes nothing with it: the window still covers today
    // and reaching the limit still pauses the agent.
    const warned = await updateBudget({
      budgetId,
      expectedVersion: await budgetVersion(budgetId),
      warnAtPct: 60,
    });
    expect(warned.cascade).toEqual({ noLimitInForce: false, stopRemoved: null });
    expect(warned.before.warnAtPct).toBe(80);
    expect(warned.after.warnAtPct).toBe(60);

    // Taking the action off PauseAgent removes the stop, and ending the window leaves the
    // agent spending against nothing. Both are what an approver has to read.
    const lifted = await updateBudget({
      budgetId,
      expectedVersion: await budgetVersion(budgetId),
      actionAt100: "NotifyOnly",
      effectiveTo: "2026-01-02",
    });
    expect(lifted.cascade.stopRemoved).toBe("PauseAgent");
    expect(lifted.cascade.noLimitInForce).toBe(true);
  });

  it("UC-71.1-04 refuses a sensitive field to an agent until an approval binds it", async () => {
    const { createBudget, updateBudget } = await import("@/features/budgets/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const budgetId = await createBudget(budget());
    const version = await budgetVersion(budgetId);

    // The ceiling is the one thing an agent must not be able to lift for itself.
    const asAgent = runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateBudget({ budgetId, expectedVersion: version, limitAed: 100_000 }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    const after = await testPool().query<{ limit_aed: string; version: number }>(
      "select limit_aed, version from gov.agent_budget where id = $1",
      [budgetId],
    );
    expect(Number(after.rows[0].limit_aed)).toBe(100);
    expect(after.rows[0].version).toBe(version);

    // Moving the warning threshold is ordinary work, and the same agent may do it.
    const warned = await runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateBudget({ budgetId, expectedVersion: version, warnAtPct: 50 }),
    );
    expect(warned.after.warnAtPct).toBe(50);
  });

  it("UC-71.1-04 lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { createBudget, updateBudget, BudgetRejected } = await import("@/features/budgets/service");
    signedInAs = ownerId;
    const budgetId = await createBudget(budget());
    const version = await budgetVersion(budgetId);

    const results = await Promise.allSettled([
      updateBudget({ budgetId, expectedVersion: version, warnAtPct: 70 }),
      updateBudget({ budgetId, expectedVersion: version, warnAtPct: 90 }),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(BudgetRejected);
  });
});
