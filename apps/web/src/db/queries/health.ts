import { sql } from "drizzle-orm";

import { dbRo } from "@/db/client";

/** The database server's version, for the System page. */
export async function serverVersion(): Promise<string | null> {
  const { rows } = await dbRo().execute<{ v: string }>(sql`show server_version`);
  return rows[0]?.v ?? null;
}
