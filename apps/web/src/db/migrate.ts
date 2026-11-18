import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { syncPermissionCatalogue } from "./permissions-sync.js";

/**
 * What the `db-migrate` Job runs, and what `npm run db:migrate` runs locally.
 *
 * The order matters. `infra/postgres/01-extensions.sql` creates the extensions and the
 * search normaliser the generated `search_key` columns call, so it runs before the Drizzle
 * migrations. The partitioning, audit guard and integrity triggers run after, because they
 * attach to tables the migrations create, and the grants run last, after the partitioning
 * has rebuilt the append-only tables.
 *
 * The permission catalogue is reconciled at the end, because it is derived from the code
 * the platform is about to run: a permission the code checks and the database has never
 * heard of refuses everybody.
 */
/**
 * Where the SQL lives.
 *
 * Named rather than walked up from this file, because the compiled entry point in the image
 * does not sit where the source does, and a path that depends on that is a path that breaks
 * the moment the build layout changes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.AWP_MIGRATIONS_DIR ?? join(here, "migrations");
const infraPostgres = process.env.AWP_POSTGRES_SQL_DIR ?? join(here, "..", "..", "..", "..", "infra", "postgres");

const BEFORE_MIGRATIONS = ["01-extensions.sql"];
const AFTER_MIGRATIONS = ["03-partitions.sql", "04-audit-guard.sql", "05-integrity.sql", "06-roles.sql"];

async function runSqlFile(pool: Pool, name: string): Promise<void> {
  const sql = await readFile(join(infraPostgres, name), "utf8");
  process.stdout.write(`  ${name}\n`);
  await pool.query(sql);
}

/**
 * The journal has to be strictly increasing.
 *
 * Drizzle applies a migration only when its stamp is newer than the newest one already
 * recorded, so a hand-written entry with an older stamp makes every later migration a
 * no-op — and the run still reports success. Checking the file before applying anything
 * turns that into a failure here rather than a missing column in production.
 *
 * @throws {Error} naming the entry that is out of order.
 */
async function assertJournalInOrder(): Promise<void> {
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  let previous = 0;
  for (const entry of journal.entries) {
    if (entry.when <= previous) {
      throw new Error(
        `Migration ${entry.tag} is stamped ${entry.when}, which is not after the entry before it (${previous}). ` +
          "Drizzle would skip it and every migration after it.",
      );
    }
    previous = entry.when;
  }
}

/**
 * Runs the bootstrap SQL, the Drizzle migrations after checking the journal's order, the SQL that
 * attaches to migrated tables, and, on a seeded installation, the permission catalogue sync, on
 * one connection. An SQL file missing from the folder is skipped.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "awp-db-migrate" });
  try {
    const available = new Set(await readdir(infraPostgres));

    process.stdout.write("Bootstrap SQL (before migrations):\n");
    for (const name of BEFORE_MIGRATIONS) {
      if (available.has(name)) await runSqlFile(pool, name);
    }

    process.stdout.write("Drizzle migrations:\n");
    await assertJournalInOrder();
    await migrate(drizzle(pool), { migrationsFolder });

    process.stdout.write("Bootstrap SQL (after migrations):\n");
    for (const name of AFTER_MIGRATIONS) {
      if (available.has(name)) await runSqlFile(pool, name);
    }

    // Only on an installation that has been seeded: before that there are no roles to grant
    // against, and the seed writes the whole catalogue itself.
    const { rows } = await pool.query<{ seeded: boolean }>(
      "select exists (select 1 from core.role where is_system = true) as seeded",
    );
    if (rows[0]?.seeded) {
      const synced = await syncPermissionCatalogue(pool);
      process.stdout.write(
        `Permission catalogue: ${synced.permissions} permissions, ${synced.grants} new grants\n`,
      );
    }
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const url = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_MIGRATE_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }
  runMigrations(url).then(
    () => process.stdout.write("Migrations complete.\n"),
    (error: unknown) => {
      process.stderr.write(`Migrations failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
