import { db, schema, type Tx } from "@/db";

type Area = (typeof schema.auditEntries.$inferInsert)["area"];

/** Records an audit entry (ORG-003). Entries are never updated or deleted. */
export async function audit(
  entry: { orgId: string; actorUserId: string | null; actorName: string; area: Area; action: string; item: string; change?: string },
  tx?: Tx,
): Promise<void> {
  await (tx ?? db).insert(schema.auditEntries).values({ ...entry, change: entry.change ?? "" });
}
