import { sql } from "drizzle-orm";

import { closeDatabase, db, type Database } from "../client";
import { seedAgents, SYSTEM_AGENT_IDS } from "./agents";
import { seedConnectors, seedSkills } from "./capabilities";
import { CONNS0 } from "./data/connectors";
import { DEFAULT_AGENT, DEFAULT_CONNECTORS, DEFAULT_SKILLS } from "./data/default-start";
import { AGENTS } from "./data/people";
import { SKILLS } from "./data/skills";
import { seedDefaultStart } from "./default-start";
import { seedModels } from "./models";
import { seedOrganisation } from "./organisation";

/**
 * Requirement 24: what a fresh install starts with. Every id is derived from a natural key
 * (`./ids.ts`), and the seed clears the four domain schemas before it writes, so running it
 * twice leaves the same row counts. `audit` is never cleared: it is append-only by design
 * (section 23 rule 10).
 */
const SCHEMAS = ["core", "work", "ai", "gov"] as const;

/**
 * Truncates what the seed owns. Exported for `tests/fixtures/demo`, which replaces this
 * organisation with the one the suites are written against and has to start from the same
 * empty database this does.
 */
export async function clear(database: Database): Promise<void> {
  const { rows } = await database.execute<{ list: string }>(sql`
    select string_agg(format('%I.%I', schemaname, tablename), ', ') as list
    from pg_tables
    where schemaname in ('core', 'work', 'ai', 'gov')
  `);
  const list = rows[0]?.list;
  if (list) await database.execute(sql.raw(`truncate table ${list} restart identity cascade`));
}

/**
 * The organisation (people, roles, permissions), the platform's own system agent (the page
 * assistant), one project, the organisation's own request types, one knowledge base and the
 * one agent that answers from it, every setting turned on — everything a fresh install needs
 * and nothing it would have to delete first.
 *
 * The rich organisation the 567 scenarios are written against is not here: it is test
 * data, and lives with the tests (`tests/fixtures/demo`).
 */
export async function seed(database: Database): Promise<void> {
  await clear(database);
  // The order is the foreign-key order: identity first, then the capabilities an agent
  // version points at, then the work those agents do.
  await seedOrganisation(database);
  await seedModels(database);
  const commonConnectors = CONNS0.filter((connector) => (DEFAULT_CONNECTORS as readonly string[]).includes(connector.n));
  await seedSkills(database, SKILLS.filter((skill) => (DEFAULT_SKILLS as readonly string[]).includes(skill.n)));
  await seedConnectors(database, commonConnectors);
  await seedAgents(database, {
    agents: AGENTS.filter((agent) => (SYSTEM_AGENT_IDS as readonly string[]).includes(agent.id) || agent.id === DEFAULT_AGENT.id),
    connectors: commonConnectors,
  });
  await seedDefaultStart(database);
}

/**
 * The row count of every table in the five schemas, for the idempotency check.
 *
 * `count(*)`, not `pg_stat_user_tables.n_live_tup`: that column is the planner's estimate,
 * which drifts after a truncate-and-reload and made two identical seeds report different
 * totals. A partition is left out, because its rows are already counted in its parent.
 */
export async function rowCounts(database: Database): Promise<Record<string, number>> {
  const { rows: tables } = await database.execute<{ name: string }>(sql`
    select format('%I.%I', n.nspname, c.relname) as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('core', 'work', 'ai', 'gov', 'audit')
      and c.relkind in ('r', 'p')
      and not c.relispartition
    order by 1
  `);
  if (tables.length === 0) return {};
  const counts = tables
    .map((table) => `select '${table.name}' as name, count(*)::text as count from ${table.name}`)
    .join(" union all ");
  const { rows } = await database.execute<{ name: string; count: string }>(sql.raw(counts));
  const entries: [string, number][] = rows.map((row) => [row.name, Number(row.count)]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("src/db/seed/index.ts");
if (invokedDirectly) {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("DATABASE_URL must be set.\n");
    process.exit(1);
  }
  seed(db()).then(
    async () => {
      const counts = await rowCounts(db());
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      process.stdout.write(`Seed complete: ${Object.keys(counts).length} tables, ${total} rows.\n`);
      await closeDatabase();
    },
    async (error: unknown) => {
      // The driver wraps the database's own error, so the cause carries the constraint or
      // column that was refused; the message alone is only the statement that failed.
      const reported = error instanceof Error ? error.message.split("\n")[0] : String(error);
      const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
      process.stderr.write(`Seed failed: ${reported}\n`);
      if (cause) process.stderr.write(`Caused by: ${cause.message}\n`);
      await closeDatabase();
      process.exit(1);
    },
  );
}

export { SCHEMAS };
