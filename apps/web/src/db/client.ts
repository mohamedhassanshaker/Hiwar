import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Two connections, as stack specification 7.1 prescribes.
 *
 * `db` is the pooled writer, through the CloudNativePG `Pooler` (PgBouncer, transaction
 * mode). `dbRo` is the replica: dashboards, drill-down lists, budget charts and exports
 * read from it. Where no replica is configured — local development, tests — `dbRo` is the
 * writer, so the same code path works everywhere.
 *
 * This module is imported only by `src/db` and by the feature modules' `repository.ts`;
 * `tests/architecture.test.ts` keeps it that way.
 */
export type Database = NodePgDatabase<typeof schema>;

let writerPool: Pool | null = null;
let readerPool: Pool | null = null;
let writer: Database | null = null;
let reader: Database | null = null;

/** A pool of at most 10 connections, tagged `awp-web`, timing out a connect after 10 s. */
function pool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "awp-web",
  });
}

/** The pooled writer. Every mutation goes through it. */
export function db(): Database {
  if (!writer) {
    writerPool = pool(env().DATABASE_URL);
    writer = drizzle(writerPool, { schema });
  }
  return writer;
}

/** The read replica. Reporting reads go through it; it never sees a write. */
export function dbRo(): Database {
  if (!reader) {
    const url = env().DATABASE_RO_URL;
    if (!url) return db();
    readerPool = pool(url);
    reader = drizzle(readerPool, { schema });
  }
  return reader;
}

/** Closes both pools. Used by tests and by the migrate and seed scripts. */
export async function closeDatabase(): Promise<void> {
  await Promise.all([writerPool?.end(), readerPool?.end()]);
  writerPool = null;
  readerPool = null;
  writer = null;
  reader = null;
}

export { schema };
