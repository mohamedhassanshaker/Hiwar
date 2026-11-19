import { db, schema as s } from "@/db/client";

/**
 * The insert behind `src/lib/audit.ts`. Every SQL statement that is not a feature's lives
 * under `src/db/`, so a feature's `repository.ts` and this folder stay the only places
 * that touch the Drizzle client.
 */
export type AuditRow = typeof s.auditEntry.$inferInsert;

/** Writes one audit entry through the primary. */
export async function insertAuditEntry(row: AuditRow): Promise<void> {
  await db().insert(s.auditEntry).values(row);
}
