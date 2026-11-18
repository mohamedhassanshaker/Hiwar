import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "../db/harness";

/**
 * NFR-01: what a screen's data path costs, at p50 and p95.
 *
 * The requirement is "server timing on the screen's data path, excluding browser render",
 * so this calls the loader each screen calls rather than fetching a page: a page's time
 * carries React's render and the network, and neither is what the budget is about.
 *
 * It is a measurement, not a gate. The file is named `.measure.ts`, which the vitest
 * include pattern leaves out, because a latency assertion on a developer's machine fails
 * for reasons that have nothing to do with the code. Run it with:
 *
 *     DATABASE_URL=… npx vitest run --config vitest.measure.config.ts
 *
 * and read the table it prints. The budget is stated beside each figure so a reader can
 * see which screens are inside it without doing the arithmetic.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-measurements-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

/** NFR-01: a list or detail screen responds in under this, at p95. */
const BUDGET_MS = 300;

/** Enough samples for a p95 to mean something, few enough to run in a minute. */
const SAMPLES = 30;

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

describe.skipIf(!hasDatabase)("NFR-01 the data path behind each screen", () => {
  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    signedInAs = owner.rows[0].id;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("reports p50 and p95 for every list and detail screen", async () => {
    const [agents, engage, files, governance, home, inbox, integrations, knowledge, memory, models, organisation, projects, requests, rooms, schedules, skills, workItems, budgets, connectors] =
      await Promise.all([
        import("@/features/agents/service"),
        import("@/features/engage/service"),
        import("@/features/files/service"),
        import("@/features/governance/service"),
        import("@/features/home/service"),
        import("@/features/inbox/service"),
        import("@/features/integrations/service"),
        import("@/features/knowledge/service"),
        import("@/features/memory/service"),
        import("@/features/models/service"),
        import("@/features/organisation/service"),
        import("@/features/projects/service"),
        import("@/features/requests/service"),
        import("@/features/rooms/service"),
        import("@/features/schedules/service"),
        import("@/features/skills/service"),
        import("@/features/work-items/service"),
        import("@/features/budgets/service"),
        import("@/features/connectors/service"),
      ]);

    const screens: [screen: string, load: () => Promise<unknown>][] = [
      ["dashboard", home.loadDashboard],
      ["records", () => home.loadRecords("open")],
      ["inbox", inbox.loadInbox],
      ["projects", projects.loadProjects],
      ["discussion-rooms", rooms.loadRooms],
      ["work-items", workItems.loadWorkItems],
      ["requests", requests.loadRequests],
      ["scheduled-work-items", schedules.loadSchedules],
      ["artifacts", files.loadArtifacts],
      ["files", files.loadFiles],
      ["org-chart", organisation.loadOrgChart],
      ["people", organisation.loadPeopleAndRoles],
      ["org-units", organisation.loadOrgUnits],
      ["profile", organisation.loadMyProfile],
      ["agents", agents.loadRuns],
      ["skills", skills.loadSkills],
      ["connectors", connectors.loadConnectors],
      ["memory", memory.loadMemory],
      ["knowledge", knowledge.loadKnowledge],
      ["models", models.loadModels],
      ["channels", engage.loadChannelBoard],
      ["embedded-deployment", engage.loadDeployments],
      ["budgets", budgets.loadBudgets],
      ["integrations", integrations.loadIntegrations],
      ["settings", governance.loadSettings],
      ["audit", governance.loadAudit],
      ["logs", governance.loadLogs],
      ["system", governance.loadSystem],
    ];

    const rows: { screen: string; p50: number; p95: number; budget: string }[] = [];
    for (const [screen, load] of screens) {
      // One call first, so a cold import or a first-use connection is not in the sample.
      await load();
      const timings: number[] = [];
      for (let run = 0; run < SAMPLES; run += 1) {
        const started = performance.now();
        await load();
        timings.push(performance.now() - started);
      }
      timings.sort((left, right) => left - right);
      const p95 = percentile(timings, 0.95);
      rows.push({
        screen,
        p50: Math.round(percentile(timings, 0.5)),
        p95: Math.round(p95),
        budget: p95 <= BUDGET_MS ? "within" : "over",
      });
    }

    rows.sort((left, right) => right.p95 - left.p95);
    console.table(rows);
    const over = rows.filter((row) => row.budget === "over").map((row) => `${row.screen} ${row.p95}ms`);
    console.log(
      over.length === 0
        ? `NFR-01: every screen is within ${BUDGET_MS} ms at p95 (${SAMPLES} samples each).`
        : `NFR-01: over ${BUDGET_MS} ms at p95 — ${over.join(", ")}`,
    );

    // The measurement has to have measured something; the budget itself is reported, not
    // asserted, because this machine is not the one the budget is about.
    expect(rows).toHaveLength(screens.length);
  }, 600_000);
});
