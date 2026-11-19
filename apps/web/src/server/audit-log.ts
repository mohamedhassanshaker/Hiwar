import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db, schema } from "@/db";

/** ORG-003: the area filter and search; newest first. */
export const AREAS = ["All", "Agents", "Knowledge", "Tools", "Deployments", "Conversations", "Users", "Billing", "Exports"] as const;

export async function listAudit(orgId: string, area: string, q: string, limit = 200) {
  const where: SQL[] = [eq(schema.auditEntries.orgId, orgId)];
  if (area !== "All" && (AREAS as readonly string[]).includes(area)) where.push(eq(schema.auditEntries.area, area as never));
  const term = q.trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, "\$&")}%`;
    where.push(or(ilike(schema.auditEntries.actorName, like), ilike(schema.auditEntries.item, like), ilike(schema.auditEntries.action, like))!);
  }
  return db.select().from(schema.auditEntries).where(and(...where)).orderBy(desc(schema.auditEntries.createdAt)).limit(limit);
}

export function csvCell(value: string): string {
  // Leading = + - @ would run as formulas in a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
