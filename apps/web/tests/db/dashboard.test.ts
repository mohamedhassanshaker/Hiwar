import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-10 the dashboard and S-11 its drill-downs, against the database.
 *
 * Every figure on the dashboard is a count somebody acts on, so these ask the services for
 * them with a real person signed in rather than asserting on the screen's markup.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("the dashboard", () => {
  let ownerId = "";
  let memberId = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    // Someone without `budgets:read`, which is what gates the cost cards.
    const member = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       where p.status = 'Active'
         and not exists (
           select 1 from core.role_assignment ra
           join core.role r on r.id = ra.role_id
           where ra.person_id = p.id and r.code in ('Owner', 'Admin', 'WorkLead', 'Auditor')
         )
       order by p.email limit 1`,
    );
    memberId = member.rows[0]?.id ?? "";
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-10.1-01 reads every card the screen shows from the database", async () => {
    const { loadDashboard } = await import("@/features/home/service");
    signedInAs = ownerId;

    const data = await loadDashboard();
    expect(data.organisationEn.length).toBeGreaterThan(0);
    expect(data.openWorkItems.total).toBeGreaterThanOrEqual(0);
    expect(data.openWorkItems.byStatus.length).toBeGreaterThan(0);
    expect(data.runs.inProgress).toBeGreaterThanOrEqual(0);
    expect(data.approvals.waiting).toBeGreaterThanOrEqual(0);
    expect(data.agentsInError.count).toBeGreaterThanOrEqual(0);
    expect(data.cost.month).toBeGreaterThanOrEqual(0);
    expect(data.slaAtRisk).toBeGreaterThanOrEqual(0);

    // The open-work total is the sum of its own breakdown, because the card and the chart
    // beside it disagreeing is worse than either being wrong.
    const summed = data.openWorkItems.byStatus.reduce((total, row) => total + row.count, 0);
    expect(summed).toBe(data.openWorkItems.total);
  });

  it("UC-10.1-04 budget burn is month to date, against the month's limit", async () => {
    const { loadDashboard } = await import("@/features/home/service");
    signedInAs = ownerId;

    const data = await loadDashboard();
    // Today's estimate cannot exceed the month's: the month contains today.
    expect(data.cost.month).toBeGreaterThanOrEqual(data.cost.today);
    expect(data.cost.limit).toBeGreaterThanOrEqual(0);
  });

  it("UC-10.1-05 a person without the budget permission is not sent the costs", async () => {
    if (!memberId) return;
    const { loadDashboard } = await import("@/features/home/service");

    signedInAs = ownerId;
    expect((await loadDashboard()).showCost).toBe(true);

    // Not hidden with CSS: the flag is decided on the server, where the permission is.
    signedInAs = memberId;
    expect((await loadDashboard()).showCost).toBe(false);
  });

  it("UC-10.1-06 says when the platform has nothing in it, rather than only showing zeros", async () => {
    const { loadDashboard } = await import("@/features/home/service");
    signedInAs = ownerId;

    const data = await loadDashboard();
    const { rows } = await testPool().query<{ any: boolean }>(
      "select exists (select 1 from work.work_item) or exists (select 1 from work.request) as any",
    );
    expect(data.empty).toBe(!rows[0].any);
  });

  it("UC-10.1-03 UC-10.2-01 UC-10.2-02 UC-10.2-03 every card opens a list, even an empty one", async () => {
    const { loadRecords } = await import("@/features/home/service");
    signedInAs = ownerId;

    for (const kind of ["open", "runs", "approvals", "agentsErr", "cost", "sla"]) {
      const set = await loadRecords(kind);
      expect(set.kind).toBe(kind);
      expect(set.cols.length).toBeGreaterThan(0);
      // `UC-10.1-03`: a card showing nothing still opens; the list says it is empty.
      expect(Array.isArray(set.rows)).toBe(true);
    }

    // `UC-10.2-01`: the SLA list is the one due soonest, and nothing already finished.
    const sla = await loadRecords("sla");
    expect(sla.title[0].length).toBeGreaterThan(0);
  });

  it("UC-11.1-01 UC-11.1-02 UC-11.1-03 UC-11.1-06 the list filters by what the person typed", async () => {
    const { loadRecords } = await import("@/features/home/service");
    const { filterRecords } = await import("@/features/home/filter");
    signedInAs = ownerId;

    const set = await loadRecords("open");
    expect(set.cols).toContain("key");
    expect(set.cols).toContain("status");

    if (set.rows.length > 0) {
      const key = String(set.rows[0][0]);
      expect(filterRecords(set, { term: key }).length).toBeGreaterThan(0);
      const status = String(set.rows[0][3]);
      expect(filterRecords(set, { status }).every((row) => row[3] === status)).toBe(true);
    }
    // `UC-11.1-06`: a term nothing matches empties the list rather than ignoring the filter.
    expect(filterRecords(set, { term: "zzzz-nothing-matches" })).toEqual([]);
  });

  it("D349 a drill-down filters and pages in the database, and the export takes every page", async () => {
    const { exportRecords, loadRecords } = await import("@/features/home/service");
    signedInAs = ownerId;

    const open = await testPool().query<{ key: string; status: string; project: string }>(
      `select wi.key, wi.status, p.key as project from work.work_item wi join work.project p on p.id = wi.project_id
        where wi.status in ('Backlog', 'ToDo', 'InProgress', 'InReview', 'Blocked') order by wi.key`,
    );
    expect(open.rowCount).toBeGreaterThan(2);

    const second = await loadRecords("open", { limit: 2, offset: 2 });
    expect(second.total).toBe(open.rowCount);
    expect(second.rows.map((row) => row[0])).toEqual(open.rows.slice(2, 4).map((row) => row.key));

    const status = open.rows[0].status;
    const byStatus = await loadRecords("open", { status });
    expect(byStatus.total).toBe(open.rows.filter((row) => row.status === status).length);
    const project = open.rows[0].project;
    expect((await loadRecords("open", { project })).total).toBe(open.rows.filter((row) => row.project === project).length);
    expect((await loadRecords("open", { term: open.rows[1].key })).rows.map((row) => row[0])).toContain(open.rows[1].key);
    // The search is literal.
    expect((await loadRecords("open", { term: "%" })).total).toBe(0);

    // The file holds every matching row, not the page the screen showed.
    const csv = await exportRecords({ kind: "open", format: "csv", status });
    expect(csv.split("\n").length - 1).toBe(byStatus.total);
  });

  it("UC-11.1-05 exports the filtered rows, labels the estimate and records the export", async () => {
    const { exportRecords, loadRecords } = await import("@/features/home/service");
    signedInAs = ownerId;

    const set = await loadRecords("cost");
    const csv = await exportRecords({ kind: "cost", format: "csv" });
    const lines = csv.split("\n");
    // An exported cost is an estimate, and a column named "amount" in a spreadsheet is not.
    expect(lines[0]).toContain("estimated_cost_aed");
    expect(lines.length - 1).toBe(set.rows.length || 1);

    // Narrowing the export narrows the file.
    if (set.rows.length > 1) {
      const narrowed = await exportRecords({ kind: "cost", format: "csv", term: String(set.rows[0][0]) });
      expect(narrowed.split("\n").length).toBeLessThan(lines.length);
    }

    // Requirement 34: taking data out of the platform is an audited act.
    const audited = await testPool().query<{ count: string }>(
      `select count(*) from audit.audit_entry
       where action = 'exports:create' and object_label = 'cost' and at > now() - interval '2 minutes'`,
    );
    expect(Number(audited.rows[0].count)).toBeGreaterThan(0);
  });

  it("UC-11.1-05 refuses the export to a person who may not take data out", async () => {
    if (!memberId) return;
    const { exportRecords, loadRecords } = await import("@/features/home/service");
    signedInAs = memberId;

    expect((await loadRecords("open")).mayExport).toBe(false);
    await expect(exportRecords({ kind: "open", format: "csv" })).rejects.toThrow();
  });

  /** The organisation's time zone, in which the dashboard counts its days (D365). */
  const organisationZone = async () =>
    (await testPool().query<{ zone: string }>("select time_zone as zone from core.organisation limit 1")).rows[0].zone;

  /**
   * The seven whole days ending yesterday in the organisation's zone, which rows a concurrent
   * suite writes today do not reach.
   */
  async function lastWeek(): Promise<{ from: string; to: string; days: string[]; zone: string }> {
    const zone = await organisationZone();
    const { rows } = await testPool().query<{ day: string }>(
      `select to_char(d, 'YYYY-MM-DD') as day
         from generate_series((now() at time zone $1)::date - 7, (now() at time zone $1)::date - 1, interval '1 day') d
        order by d`,
      [zone],
    );
    const days = rows.map((row) => row.day);
    return { from: days[0], to: days[6], days, zone };
  }

  const personId = async (email: string) =>
    (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;

  /**
   * What the database holds for one week, per day in the organisation's zone, worked out here
   * in SQL rather than by the code under test: runs started and work items finished.
   */
  async function weekFigures(from: string, to: string, days: string[], zone: string) {
    const bounds = await testPool().query<{ start: Date; end: Date; starts: Date[] }>(
      `select ($1::date::timestamp at time zone $3) as start,
              (($2::date + 1)::timestamp at time zone $3) - interval '1 millisecond' as "end",
              array(select (d::timestamp at time zone $3) from generate_series($1::date, $2::date, interval '1 day') d order by d) as starts`,
      [from, to, zone],
    );
    const { start, end, starts } = bounds.rows[0];
    const perDay = async (table: string, column: string) => {
      const { rows } = await testPool().query<{ day: string; count: number }>(
        `select to_char((${column} at time zone $3)::date, 'YYYY-MM-DD') as day, count(*)::int as count
           from ${table} where ${column} >= $1 and ${column} <= $2 group by 1`,
        [start, end, zone],
      );
      return days.map((day) => rows.find((row) => row.day === day)?.count ?? 0);
    };
    const outcomes = await testPool().query<{ completed: number; waiting: number; failed: number }>(
      `select count(*) filter (where status = 'Succeeded')::int as completed,
              count(*) filter (where status = 'Waiting')::int as waiting,
              count(*) filter (where status in ('Failed', 'BudgetExceeded'))::int as failed
         from ai.run where started_at >= $1 and started_at <= $2`,
      [start, end],
    );
    const previous = await testPool().query<{ count: number }>(
      `select count(*)::int as count from work.work_item
       where completed_at >= $1::timestamptz - interval '7 days' and completed_at < $1::timestamptz`,
      [start],
    );
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      starts: starts.map((stamp) => new Date(stamp).toISOString()),
      runsPerDay: await perDay("ai.run", "started_at"),
      finishedPerDay: await perDay("work.work_item", "completed_at"),
      finishedPrevious: previous.rows[0].count,
      outcomes: outcomes.rows[0],
    };
  }

  it("handoff v2 2.3 D365 reads the charts for a chosen week, one bar per day of the organisation", async () => {
    const { loadSeries } = await import("@/features/home/service");
    signedInAs = ownerId;
    const { from, to, days, zone } = await lastWeek();
    // A run half an hour into one of the days, local time: in the UAE that is 20:30 UTC the day
    // before, which a chart cut on UTC days counted a day early.
    const agent = (await testPool().query<{ id: string; version: string }>(
      "select id, active_version_id as version from ai.agent where active_version_id is not null order by code limit 1",
    )).rows[0];
    const runId = crypto.randomUUID();
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'Console', 'Succeeded', ($5::date::timestamp + interval '30 minutes') at time zone $6, $7, $7)`,
      [runId, `RUN-TZ-${runId.slice(0, 8)}`, agent.id, agent.version, days[3], zone, ownerId],
    );
    try {
      const expected = await weekFigures(from, to, days, zone);
      expect(expected.runsPerDay[3]).toBeGreaterThan(0);

      const series = await loadSeries({ from, to });
      expect(series.unit).toBe("day");
      expect(series.from).toBe(expected.start);
      expect(series.to).toBe(expected.end);
      expect(series.runs).toEqual(expected.starts.map((start, index) => ({ start, count: expected.runsPerDay[index] })));
      expect(series.finished).toEqual(expected.starts.map((start, index) => ({ start, count: expected.finishedPerDay[index] })));
      // The comparison is the seven days immediately before.
      expect(series.finishedPrevious).toBe(expected.finishedPrevious);
      expect(series.outcomes).toEqual(expected.outcomes);
    } finally {
      await testPool().query("delete from ai.run where id = $1", [runId]);
    }
  });

  it("handoff v2 2.3 refuses the charts to a person who is not signed in", async () => {
    const { loadSeries } = await import("@/features/home/service");
    signedInAs = "";
    const { from, to } = await lastWeek();
    await expect(loadSeries({ from, to })).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("handoff v2 3 builds a report from the read model, section by section, and audits it", async () => {
    const { buildReport } = await import("@/features/home/service");
    const { CARD_IDS } = await import("@/features/home/report-sections");
    signedInAs = ownerId;
    const { from, to, days, zone } = await lastWeek();
    const expected = await weekFigures(from, to, days, zone);
    const name = `Weekly review ${Date.now().toString(36)}`;
    const open = await testPool().query<{ status: string; count: number }>(
      "select status, count(*)::int as count from work.work_item where status in ('InProgress', 'Blocked') group by status",
    );
    const openCount = (status: string) => String(open.rows.find((row) => row.status === status)?.count ?? 0);

    const report = await buildReport({ name, from, to, sections: [...CARD_IDS], format: "csv", lang: "en" });

    expect(report.title).toBe(name);
    expect(report.period).toBe(`${from} – ${to}`);
    const sections = [...new Set(report.rows.map(([section]) => section))];
    expect(sections.slice(0, 7)).toEqual([
      "AI Assistant",
      "Agent runs",
      "Estimated cost",
      "Month budget",
      "Tasks finished",
      "Run outcomes",
      "Needs attention",
    ]);
    // The last two list records, so a section with none to list has no rows.
    expect(sections.slice(7).every((section) => ["Runs in progress", "Discussion room activity"].includes(section))).toBe(
      true,
    );
    const rowsOf = (section: string) =>
      report.rows.filter(([label]) => label === section).map(([, item, value]) => [item, value]);

    const totalRuns = expected.runsPerDay.reduce((sum, count) => sum + count, 0);
    expect(rowsOf("Agent runs")).toEqual([
      ["Total runs", String(totalRuns)],
      ...days.map((day, index) => [day, String(expected.runsPerDay[index])]),
    ]);
    const totalFinished = expected.finishedPerDay.reduce((sum, count) => sum + count, 0);
    expect(rowsOf("Tasks finished")).toEqual([
      ["Total tasks", String(totalFinished)],
      ...days.map((day, index) => [day, String(expected.finishedPerDay[index])]),
      ["Previous period", String(expected.finishedPrevious)],
      ["Still being worked on", openCount("InProgress")],
      ["Stuck, need your help", openCount("Blocked")],
    ]);
    const outcomes = rowsOf("Run outcomes");
    expect(outcomes.map(([item]) => item)).toEqual(["Completed", "Waiting", "Failed"]);
    expect(outcomes.map(([, value]) => Number(value.split(" ")[0]))).toEqual([
      expected.outcomes.completed,
      expected.outcomes.waiting,
      expected.outcomes.failed,
    ]);
    expect(rowsOf("Estimated cost").map(([item]) => item)).toEqual(["This month (AED)", "Models", "Tools and connectors"]);
    expect(rowsOf("Month budget").map(([item]) => item)).toEqual(["Budget (AED)", "Estimated spend (AED)", "Used"]);
    expect(rowsOf("Month budget")[0][1]).toMatch(/^\d+\.\d{2}$/);
    expect(rowsOf("Needs attention").map(([item]) => item.split(" · ")[0])).toEqual([
      "Agents in error",
      "Approvals waiting",
      "SLA at risk",
    ]);
    // At most three live runs, each named by a key the run table holds.
    const live = rowsOf("Runs in progress");
    expect(live.length).toBeLessThanOrEqual(3);
    const keys = (await testPool().query<{ key: string }>("select key from ai.run")).rows.map((row) => row.key);
    for (const [item] of live) expect(keys).toContain(item.split(" · ")[0]);
    for (const [, value] of rowsOf("Discussion room activity")) expect(value).toMatch(/^\d+ messages$/);

    // Requirement 34: taking data out of the platform is an audited act.
    const audited = await testPool().query<{ detail_json: { rows: number; sections: string[] } }>(
      `select detail_json from audit.audit_entry
       where action = 'exports:create' and object_type = 'DashboardReport' and object_label = $1`,
      [name],
    );
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0].detail_json.rows).toBe(report.rows.length);
    expect(audited.rows[0].detail_json.sections).toEqual([...CARD_IDS]);
  });

  it("UC-10.1-05 a report leaves the money sections out for a person without budgets:read", async () => {
    const { buildReport } = await import("@/features/home/service");
    const { CARD_IDS } = await import("@/features/home/report-sections");
    // A WorkLead may export but may not see budgets.
    signedInAs = await personId("khalid@tahseel.ae");
    const { from, to } = await lastWeek();

    const report = await buildReport({ name: "تقرير", from, to, sections: [...CARD_IDS], format: "pdf", lang: "ar" });
    const sections = new Set(report.rows.map(([section]) => section));
    expect(sections.has("عمليات الوكلاء")).toBe(true);
    expect(sections.has("التكلفة التقديرية")).toBe(false);
    expect(sections.has("ميزانية الشهر")).toBe(false);
    expect(sections.has("Agent runs")).toBe(false);
  });

  it("handoff v2 3 refuses a report to a person who may not take data out", async () => {
    const { buildReport } = await import("@/features/home/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = await personId("layla@tahseel.ae");
    const { from, to } = await lastWeek();
    await expect(
      buildReport({ name: "x", from, to, sections: ["runs"], format: "csv", lang: "en" }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("handoff v2 3 heads the report file in the language it was asked in", async () => {
    const { reportWords } = await import("@/features/home/service");
    expect(reportWords("en")).toEqual({ section: "Section", item: "Item", value: "Value", generated: "Generated" });
    expect(reportWords("ar")).toEqual({ section: "القسم", item: "البند", value: "القيمة", generated: "أُنشئ" });
  });

  describe("S-02 search", () => {
    const term = "policy";
    const where = "search_key like '%' || public.awp_normalise($1) || '%'";
    /** Every record of each kind whose search key holds the term, by the database's own normaliser. */
    async function matching(): Promise<Record<string, string[]>> {
      const queries: Record<string, string> = {
        room: `select key as v from work.discussion_room where ${where}`,
        workItem: `select key as v from work.work_item where ${where}`,
        request: `select key as v from work.request where ${where}`,
        agent: `select code as v from ai.agent where ${where}`,
        skill: `select skill_name as v from ai.skill where ${where}`,
        connector: `select code as v from ai.connector where ${where}`,
        knowledge: `select name_en as v from ai.knowledge_collection where ${where}
                    union all select title as v from ai.knowledge_document where ${where}`,
        artifact: `select name_en as v from work.artifact where ${where}`,
      };
      const found: Record<string, string[]> = {};
      for (const [kind, text] of Object.entries(queries)) {
        found[kind] = (await testPool().query<{ v: string }>(text, [term])).rows.map((row) => row.v);
      }
      return found;
    }

    it("S-02 groups the matches by kind, in the order of specification 6.1", async () => {
      const { search } = await import("@/features/home/service");
      signedInAs = ownerId;
      const found = await matching();
      const order = ["room", "workItem", "request", "agent", "skill", "connector", "knowledge", "artifact"];

      const groups = await search({ term });
      expect(groups.map((group) => group.kind)).toEqual(order.filter((kind) => found[kind].length > 0));
      for (const group of groups) {
        expect(group.hits.length).toBe(Math.min(5, found[group.kind].length));
        // Knowledge and artifacts carry the collection or project as their code, so match them by name.
        const byName = group.kind === "knowledge" || group.kind === "artifact";
        for (const hit of group.hits) expect(found[group.kind]).toContain(byName ? hit.nameEn : hit.code);
      }
      // An empty term asks for nothing.
      expect(await search({ term: "" })).toEqual([]);
    });

    it("S-02 leaves out a kind the person may not read, however well it matches", async () => {
      const { search } = await import("@/features/home/service");
      const found = await matching();
      expect(found.skill.length).toBeGreaterThan(0);

      signedInAs = ownerId;
      const everything = (await search({ term })).map((group) => group.kind);
      // A Member holds no skills:read or connectors:read.
      signedInAs = await personId("layla@tahseel.ae");
      const theirs = (await search({ term })).map((group) => group.kind);
      expect(theirs).not.toContain("skill");
      expect(theirs).not.toContain("connector");
      expect(theirs.every((kind) => everything.includes(kind))).toBe(true);
    });
  });
});
