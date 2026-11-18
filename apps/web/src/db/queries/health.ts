import { sql } from "drizzle-orm";

import { dbRo } from "@/db/client";

/** The liveness query behind the `postgres` probe of `src/lib/health.ts`. */
export async function serverVersion(): Promise<string | null> {
  const { rows } = await dbRo().execute<{ version: string }>(
    sql`select current_setting('server_version') as version`,
  );
  return rows[0]?.version ?? null;
}
