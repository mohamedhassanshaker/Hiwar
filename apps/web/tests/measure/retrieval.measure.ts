import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "../db/harness";

/**
 * NFR-03: what a retrieval test costs, at p50 and p95.
 *
 * The requirement names its own measurement — "the duration the retrieval popup already
 * reports (`UC-58.1-01`)" — so this calls the same service the popup calls and reads the
 * figure it hands back. Each of the three modes is measured on its own, because a graph
 * query and a vector query are different work.
 *
 * It needs the agent service, so it runs against a deployment:
 *
 *     AGENT_SERVICE_URL=… DATABASE_URL=… npx vitest run --config vitest.measure.config.ts
 *
 * Like the screen measurement, it reports rather than asserts: the figure belongs to the
 * machine the stores are on, not to this one.
 */

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

/** NFR-03: a retrieval test returns in under this, at p95. */
const BUDGET_MS = 500;

/** Fewer than the screens take: each one is a round trip to the retrieval stores. */
const SAMPLES = 20;

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

describe.skipIf(!hasDatabase)("NFR-03 a retrieval test", () => {
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

  it("reports p50 and p95 for each retrieval mode", async () => {
    const { testRetrieval } = await import("@/features/knowledge/service");
    const rows: { mode: string; p50: number; p95: number; budget: string }[] = [];

    for (const mode of ["Vector", "Graph", "Hybrid"] as const) {
      const first = await testRetrieval({ query: "per diem", mode, limit: 8 });
      if (!first.ok) {
        rows.push({ mode, p50: 0, p95: 0, budget: `not run: ${first.reason}` });
        continue;
      }

      const timings: number[] = [];
      for (let run = 0; run < SAMPLES; run += 1) {
        const outcome = await testRetrieval({ query: "per diem", mode, limit: 8 });
        // The popup's own figure, which is what the requirement names.
        if (outcome.ok) timings.push(outcome.durationMs);
      }
      timings.sort((left, right) => left - right);
      const p95 = percentile(timings, 0.95);
      rows.push({
        mode,
        p50: Math.round(percentile(timings, 0.5)),
        p95: Math.round(p95),
        budget: p95 <= BUDGET_MS ? "within" : "over",
      });
    }

    console.table(rows);
    const over = rows.filter((row) => row.budget === "over").map((row) => `${row.mode} ${row.p95}ms`);
    console.log(
      over.length === 0
        ? `NFR-03: every mode that ran is within ${BUDGET_MS} ms at p95 (${SAMPLES} samples each).`
        : `NFR-03: over ${BUDGET_MS} ms at p95 — ${over.join(", ")}`,
    );

    expect(rows).toHaveLength(3);
  }, 600_000);
});
