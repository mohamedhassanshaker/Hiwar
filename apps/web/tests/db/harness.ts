import { Pool, type PoolClient } from "pg";

/**
 * The database-backed suites run against a real PostgreSQL 18, because what they check —
 * generated search keys, `CHECK` constraints, partitioning, the audit guard and the
 * integrity triggers of data model section 23 — only exists in the database.
 *
 * `docs/12-user-and-developer-guides/local-platform.md` explains how to bring one up. On a developer machine with no
 * database, `npm test` still runs the unit suites and these skip with a notice.
 *
 * That convenience must never reach a required check. NFR-30 and the project's verification
 * rule are that a required check with an empty corpus has not passed, and twenty-three
 * suites quietly skipping read exactly like twenty-three suites passing. So the gate — the
 * one entry point `make verify` and CI both call — sets `REQUIRE_DATABASE=1`, and then a
 * missing connection string is a loud failure instead of a silent skip.
 */
export const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "";
export const hasDatabase = databaseUrl.length > 0;

if (process.env.REQUIRE_DATABASE === "1" && !hasDatabase) {
  throw new Error(
    "REQUIRE_DATABASE=1 but neither DATABASE_URL nor TEST_DATABASE_URL is set, so the " +
      "database-backed suites would skip and report a false pass. Start a database with " +
      "`make dev-local`, or port-forward svc/awp-pg-rw, then set DATABASE_URL.",
  );
}

let pool: Pool | null = null;

export function testPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "awp-tests" });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = null;
}

/**
 * Runs the body in a transaction and rolls it back, so a suite never leaves a row behind
 * and cases cannot see each other's writes.
 */
export async function inRolledBackTransaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await testPool().connect();
  try {
    await client.query("begin");
    return await body(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

/**
 * Puts columns of one row back exactly as they were, `version` and `updated_at` included.
 * The version-bump trigger is suspended for the statement, because it would otherwise count
 * the restore as one more edit.
 */
export async function restoreColumns(table: string, id: string, values: Record<string, unknown>): Promise<void> {
  const client = await testPool().connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const columns = Object.keys(values);
    await client.query(`update ${table} set ${columns.map((column, index) => `${column} = $${index + 2}`).join(", ")} where id = $1`, [
      id,
      ...Object.values(values),
    ]);
    await client.query("commit");
  } catch (problem) {
    await client.query("rollback");
    throw problem;
  } finally {
    client.release();
  }
}

/** The error PostgreSQL raised, or `null` when the statement succeeded. */
export async function failureOf(client: PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error instanceof Error ? error.message : String(error);
  }
}

/** A minimal organisation, person and project, enough for the work-item rules. */
export async function seedFixture(client: PoolClient): Promise<{ personId: string; otherPersonId: string; projectId: string; otherProjectId: string }> {
  const person = await client.query<{ id: string }>(
    `insert into core.person (email, name_en, name_ar, initials, status)
     values ('fixture@tahseel.ae', 'Fixture Person', 'شخص اختباري', 'FP', 'Active') returning id`,
  );
  const other = await client.query<{ id: string }>(
    `insert into core.person (email, name_en, name_ar, initials, status)
     values ('other@tahseel.ae', 'Other Person', 'شخص آخر', 'OP', 'Active') returning id`,
  );
  const project = await client.query<{ id: string }>(
    `insert into work.project (key, name_en, name_ar) values ('FIX', 'Fixture', 'اختبار') returning id`,
  );
  const otherProject = await client.query<{ id: string }>(
    `insert into work.project (key, name_en, name_ar) values ('FIX2', 'Fixture two', 'اختبار ٢') returning id`,
  );
  return {
    personId: person.rows[0].id,
    otherPersonId: other.rows[0].id,
    projectId: project.rows[0].id,
    otherProjectId: otherProject.rows[0].id,
  };
}
