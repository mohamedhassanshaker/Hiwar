import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as { hiwarPool?: Pool };

/** One pool per process; the dev server reloads modules, so it is kept on `globalThis`. */
export const pool =
  globalForDb.hiwarPool ??
  new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://hiwar:hiwar@localhost:5433/hiwar", max: 10 });
globalForDb.hiwarPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
