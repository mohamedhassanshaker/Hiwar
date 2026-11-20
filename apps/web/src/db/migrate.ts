import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Applies the drizzle-kit migrations in `src/db/migrations`. Self-contained (no `./index` or schema
 * import), so the image compiles it to one ESM file for the db-migrate Job. It connects as
 * DATABASE_URL, the application login that owns the database, so the application owns what the
 * migrations create.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://hiwar:hiwar@localhost:5433/hiwar", max: 1 });
await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
await pool.end();
console.log("migrations applied");
