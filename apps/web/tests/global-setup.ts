import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

/** Creates a fresh `hiwar_test` database and applies the migrations once per run. */
export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: "postgresql://hiwar:hiwar@localhost:5433/hiwar" });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS hiwar_test WITH (FORCE)");
  await admin.query("CREATE DATABASE hiwar_test");
  await admin.end();
  const pool = new Pool({ connectionString: "postgresql://hiwar:hiwar@localhost:5433/hiwar_test" });
  await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
  await pool.end();
}
