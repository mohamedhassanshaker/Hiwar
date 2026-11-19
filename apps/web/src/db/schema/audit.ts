import { sql } from "drizzle-orm";
import { index, jsonb, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { enumCheck, jsonObjectCheck, ts } from "./_conventions";
import { AUDIT_ACTOR_TYPES, AUDIT_OUTCOMES } from "./enums";

/**
 * Data model section 20 and section 23 rule 7 — the audit trail.
 *
 * The schema is its own, so the application role can be granted `INSERT` and `SELECT` and
 * nothing else; `infra/postgres/03-audit.sql` adds the guard trigger that rejects `UPDATE`
 * and `DELETE` even for a role that was granted them by mistake, and the monthly range
 * partitions. The primary key therefore carries the partition column.
 */
export const audit = pgSchema("audit");

export const auditEntry = audit.table(
  "audit_entry",
  {
    id: uuid("id")
      .notNull()
      .default(sql`uuidv7()`),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    objectLabel: text("object_label"),
    detailJson: jsonb("detail_json"),
    outcome: text("outcome").notNull().default("Allowed"),
    correlationId: text("correlation_id"),
    ipAddress: text("ip_address"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at], name: "audit_entry_pk" }),
    index("audit_entry_at_idx").on(t.at),
    index("audit_entry_actor_idx").on(t.actorType, t.actorId, t.at),
    index("audit_entry_object_idx").on(t.objectType, t.objectId, t.at),
    index("audit_entry_action_idx").on(t.action, t.at),
    enumCheck("audit_entry_actor_check", t.actorType, AUDIT_ACTOR_TYPES),
    enumCheck("audit_entry_outcome_check", t.outcome, AUDIT_OUTCOMES),
    jsonObjectCheck("audit_entry_detail_check", t.detailJson),
  ],
);

export type AuditEntryRow = typeof auditEntry.$inferSelect;
export type NewAuditEntry = typeof auditEntry.$inferInsert;
