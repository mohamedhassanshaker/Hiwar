import { afterAll, describe, expect, it } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `UC-73.1-02` and `UC-74.1-02`: the audit and log filters, against the real database.
 *
 * What is under test is specifically that the filter runs in the query. A browser filtering
 * a page it has already been given answers "which of the newest N rows match", which on an
 * append-only log reads as "the agents did almost nothing". The distinguishing property,
 * asserted below, is that a filtered query reaches rows **older than the oldest row of an
 * unfiltered page of the same size** — something a browser-side filter can never do,
 * because those rows were never sent to it.
 *
 * Nothing here writes to `audit.audit_entry`: it is append-only, with a guard trigger that
 * refuses DELETE, so a suite cannot clean up after itself. The seeded demo organisation
 * supplies the rows instead.
 */
describe.skipIf(!hasDatabase)("governance filters", () => {
  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-73.1-02 reaches agent entries beyond the unfiltered page, not just those inside it", async () => {
    const { listAudit } = await import("@/features/governance/repository");

    const { rows: counts } = await testPool().query<{ agents: string }>(
      "select count(*) as agents from audit.audit_entry where actor_type = 'Agent'",
    );
    const agentTotal = Number(counts[0].agents);
    expect(agentTotal, "the seed must carry agent entries for this case to mean anything").toBeGreaterThan(0);

    // A page small enough that it cannot hold every agent entry.
    const pageSize = Math.max(1, Math.floor(agentTotal / 2));

    const unfiltered = await listAudit({ limit: pageSize });
    const filtered = await listAudit({ actor: "agent", limit: pageSize });

    expect(filtered.every((row) => row.actorType === "Agent")).toBe(true);
    expect(filtered.length).toBe(pageSize);

    // The filtered page ends at or before the unfiltered page does. If filtering happened
    // in the browser it could only ever return a subset of the unfiltered page, so its
    // oldest row could never be older than the unfiltered page's oldest row.
    const oldestOf = (rows: { at: string }[]) => rows[rows.length - 1].at;
    expect(new Date(oldestOf(filtered)).getTime()).toBeLessThanOrEqual(new Date(oldestOf(unfiltered)).getTime());
  });

  it("UC-73.1-02 separates people from agents, with neither leaking into the other", async () => {
    const { listAudit } = await import("@/features/governance/repository");

    const people = await listAudit({ actor: "human", limit: 100 });
    const agents = await listAudit({ actor: "agent", limit: 100 });

    expect(people.length).toBeGreaterThan(0);
    expect(agents.length).toBeGreaterThan(0);
    expect(people.every((row) => row.actorType !== "Agent")).toBe(true);
    expect(agents.every((row) => row.actorType === "Agent")).toBe(true);
  });

  it("UC-73.1-02 narrows by period, and a shorter window never returns more", async () => {
    const { listAudit } = await import("@/features/governance/repository");

    const ninety = await listAudit({ sinceDays: 90, limit: 500 });
    const day = await listAudit({ sinceDays: 1, limit: 500 });

    expect(day.length).toBeLessThanOrEqual(ninety.length);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    expect(day.every((row) => new Date(row.at).getTime() >= cutoff)).toBe(true);
  });

  it("UC-73.1-02 narrows by action prefix", async () => {
    const { listAudit } = await import("@/features/governance/repository");

    const all = await listAudit({ limit: 500 });
    // Action codes are `area:verb`, but not every entry carries one, so take a prefix from
    // an entry that actually has a colon rather than from whichever row happens to be newest.
    const withArea = all.find((row) => row.action.includes(":"));
    expect(withArea, "the seed must carry an `area:verb` action").toBeTruthy();
    const prefix = withArea!.action.split(":")[0];

    const rows = await listAudit({ action: `${prefix}:`, limit: 500 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.action.startsWith(`${prefix}:`))).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(all.length);
  });

  it("UC-73.1-02 matches the action prefix literally", async () => {
    const { listAudit } = await import("@/features/governance/repository");

    const all = await listAudit({ limit: 500 });
    const withArea = all.find((row) => row.action.includes(":"));
    expect(withArea, "the seed must carry an `area:verb` action").toBeTruthy();
    const prefix = withArea!.action.split(":")[0];

    // `_` is a character to find, not a wildcard that also matches the `:` after the area.
    const rows = await listAudit({ action: `${prefix}_`, limit: 500 });
    expect(rows.every((row) => row.action.startsWith(`${prefix}_`))).toBe(true);
  });

  it("UC-73.1-05 refuses to delete an audit entry", async () => {
    // The guard trigger is the control behind "the log is append-only". It is asserted here
    // because it is also why this suite cannot insert fixtures of its own.
    await expect(testPool().query("delete from audit.audit_entry where false")).rejects.toThrow(/append-only/i);
  });

  it("UC-79.1-01 UC-79.1-02 carries the five guides specification 7.5.8 names, in both languages", async () => {
    const { listDocPages } = await import("@/features/governance/repository");

    const pages = await listDocPages();
    const slugs = pages.map((page) => page.slug);

    // The five the specification names. Others may exist; these may not be missing.
    for (const slug of ["getting-started", "discussion-rooms", "approvals", "storylines", "connectors-and-tiers"]) {
      expect(slugs, `specification 7.5.8 names the ${slug} guide`).toContain(slug);
    }

    // `UC-79.1-02`: every guide has an Arabic title and body, so switching language shows
    // the guide rather than an empty page.
    for (const page of pages) {
      expect(page.titleAr.trim().length, `${page.slug} has no Arabic title`).toBeGreaterThan(0);
      expect(page.bodyAr.trim().length, `${page.slug} has no Arabic body`).toBeGreaterThan(0);
    }
  });

  it("UC-79.1-03 links in a guide point at screens this console serves", async () => {
    const { listDocPages } = await import("@/features/governance/repository");
    const { ROUTES } = await import("@/lib/routes");

    const served = new Set(Object.values(ROUTES) as string[]);
    const link = /\[([^\]]+)\]\(([^)]+)\)/g;

    const pages = await listDocPages();
    const broken: string[] = [];
    for (const page of pages) {
      for (const body of [page.bodyEn, page.bodyAr]) {
        for (const match of body.matchAll(link)) {
          const target = match[2];
          if (!served.has(target)) broken.push(`${page.slug} -> ${target}`);
        }
      }
    }

    // A link to a screen that does not exist would open a 404 from the help, which is
    // worse than no link at all.
    expect(broken).toEqual([]);
  });

  it("UC-74.1-02 filters the log by level and by service, and lists the services present", async () => {
    const { listLogs, listLogServices } = await import("@/features/governance/repository");

    const services = await listLogServices();
    expect(services.length).toBeGreaterThan(0);
    expect(new Set(services).size, "the service list must not repeat a name").toBe(services.length);

    const errors = await listLogs({ level: "Error", limit: 200 });
    expect(errors.every((row) => row.level === "Error")).toBe(true);

    const byService = await listLogs({ service: services[0], limit: 200 });
    expect(byService.length).toBeGreaterThan(0);
    expect(byService.every((row) => row.service === services[0])).toBe(true);
  });

  it("UC-74.1-03 filters the log down to one run", async () => {
    const { listLogs } = await import("@/features/governance/repository");

    const all = await listLogs({ limit: 200 });
    const withRun = all.find((row) => row.correlationId);
    expect(withRun?.correlationId, "the seed must carry a correlated log line").toBeTruthy();

    const rows = await listLogs({ runId: withRun!.correlationId!, limit: 200 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.correlationId === withRun!.correlationId)).toBe(true);
  });
});
