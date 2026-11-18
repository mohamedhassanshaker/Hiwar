import { clear, rowCounts } from "@/db/seed";
import { closeDatabase, db, type Database } from "@/db/client";
import { seedAgents } from "@/db/seed/agents";
import { seedCapabilities } from "@/db/seed/capabilities";
import { seedModels } from "@/db/seed/models";
import { seedOrganisation } from "@/db/seed/organisation";
import { seedEngage } from "./engage";
import { seedGovernance } from "./governance";
import { seedKnowledge } from "./knowledge";
import { seedRuns } from "./runs";
import { seedWork } from "./work";

/**
 * The organisation the suites are written against: real request history, discussion rooms,
 * budgets spent, embedded deployments, runs with their steps — the fixtures `tests/db/` and
 * `tests/e2e/` read, and the 568 scenarios of `docs/02-product-requirements/screens-use-cases.md`.
 *
 * This is test data, which is why it is here and not in `src/db/seed`: a deployment gets
 * the clean start that `npm run db:seed` writes, and nothing can ask the product for this.
 * `scripts/verify.sh` and `scripts/dev-local.sh` load it with `npm run test:seed`.
 *
 * It owns the same tables the product seed does, so it clears them first and writes the
 * shared identity, model and capability rows itself rather than layering on top.
 */
export async function seedDemo(database: Database): Promise<void> {
  await clear(database);
  // The order is the foreign-key order: identity first, then the capabilities an agent
  // version points at, then the work those agents do, then what governs it.
  await seedOrganisation(database);
  await seedModels(database);
  await seedCapabilities(database);
  await seedAgents(database);
  await seedWork(database);
  await seedKnowledge(database);
  await seedRuns(database);
  await seedEngage(database);
  await seedGovernance(database);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("tests/fixtures/demo/index.ts");
if (invokedDirectly) {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("DATABASE_URL must be set.\n");
    process.exit(1);
  }
  seedDemo(db()).then(
    async () => {
      const counts = await rowCounts(db());
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      process.stdout.write(`Demo fixtures loaded: ${Object.keys(counts).length} tables, ${total} rows.\n`);
      await closeDatabase();
    },
    async (error: unknown) => {
      // The driver wraps the database's own error, so the cause carries the constraint or
      // column that was refused; the message alone is only the statement that failed.
      const reported = error instanceof Error ? error.message.split("\n")[0] : String(error);
      const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
      process.stderr.write(`Demo fixtures failed: ${reported}\n`);
      if (cause) process.stderr.write(`Caused by: ${cause.message}\n`);
      await closeDatabase();
      process.exit(1);
    },
  );
}
