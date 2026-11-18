import { afterAll, describe, expect, it } from "vitest";

import { closeDatabase, db } from "@/db/client";
import { rowCounts, seed } from "@/db/seed";
import { seedDemo } from "../fixtures/demo";
import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * Requirement 24: `npm run db:seed` may be run as often as a developer likes. The seed
 * truncates `core`, `work`, `ai` and `gov` and derives every id from a natural key, so a
 * second run leaves exactly the row counts the first one did — and `rowCounts()` reports a
 * figure a reader can reproduce with `select count(*)`, not the planner's estimate.
 */
describe.skipIf(!hasDatabase)("the seed", () => {
  afterAll(async () => {
    // The seed owns the same tables the fixtures do, so this file replaces the rest of the
    // suite's data while it runs and has to put it back before the next file reads it.
    if (hasDatabase) await seedDemo(db());
    await closeDatabase();
    await closeTestPool();
  });

  it(
    "leaves the same row counts when it is run twice",
    async () => {
      await seed(db());
      const first = await rowCounts(db());
      await seed(db());
      const second = await rowCounts(db());

      expect(Object.keys(first).length).toBeGreaterThan(0);
      expect(second).toEqual(first);
    },
    // Two truncate-and-reload cycles, observed to occasionally run well past the default
    // 30 s under the test runner even though a bare `tsx` invocation of the same seed
    // finishes in a few seconds — generous headroom rather than a flaky failure.
    120_000,
  );

  it("reports counted rows, not the planner's estimate", async () => {
    const counts = await rowCounts(db());
    const counted = await testPool().query<{ count: string }>("select count(*)::text as count from core.person");
    expect(counts["core.person"]).toBe(Number(counted.rows[0].count));
  });

  it(
    "loads the suites' own fixtures to the same counts twice over",
    async () => {
      await seedDemo(db());
      const first = await rowCounts(db());
      await seedDemo(db());
      expect(await rowCounts(db())).toEqual(first);
    },
    180_000,
  );
});

describe.skipIf(!hasDatabase)("a skill's declared tools", () => {
  it("names only tools the agents holding it can actually reach", async () => {
    // A skill's frontmatter tells the model what the skill needs. When it names a tool
    // the agent was never granted, the model is told to use something that will be
    // refused — and nothing catches it, because a declaration is prose until something
    // reads it. `exp` and `kb` both declared the `knowledge/search` *connector* tool
    // while holding only the `knowledge_search` *platform* tool, and had done since the
    // seed was written.
    //
    // The configuration screen (#20b) will warn on this when a grant is edited. This is
    // the same rule where the seed can break it.
    const { DEFAULT_PLATFORM_TOOLS } = await import("@/features/agents/run-payload");

    const rows = await testPool().query<{
      agent: string;
      skill: string;
      declared: string[] | null;
      connectorTools: string[] | null;
    }>(
      `select a.code as agent,
              s.skill_name as skill,
              sv.declared_tools as declared,
              array_remove(array_agg(distinct c.code || '/' || ct.name), null) as "connectorTools"
         from ai.agent a
         join ai.agent_version av on av.id = a.active_version_id
         join ai.agent_skill asg on asg.agent_version_id = av.id
         join ai.skill_version sv on sv.id = asg.skill_version_id
         join ai.skill s on s.id = sv.skill_id
         left join ai.agent_tool_mode atm on atm.agent_version_id = av.id
         left join ai.connector_tool ct on ct.id = atm.connector_tool_id
         left join ai.connector c on c.id = ct.connector_id
        group by a.code, s.skill_name, sv.declared_tools`,
    );

    const unreachable: string[] = [];
    for (const row of rows.rows) {
      const reachable = new Set<string>([...DEFAULT_PLATFORM_TOOLS, ...(row.connectorTools ?? [])]);
      for (const tool of row.declared ?? []) {
        if (!reachable.has(tool)) unreachable.push(`${row.agent}/${row.skill} → ${tool}`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});
