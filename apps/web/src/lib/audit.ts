import { headers } from "next/headers";

import { insertAuditEntry } from "@/db/queries/audit";

/**
 * Requirement 34 and `COM-18`: every data-changing action writes one row here, with the
 * actor, what they did, to what, and whether it was allowed. `audit.audit_entry` is
 * append-only — the guard trigger of `infra/postgres/04-audit-guard.sql` rejects an
 * `UPDATE` or a `DELETE` — so this is the only way a row ever gets there.
 */
export type AuditActor = { type: "Person" | "Agent" | "Client" | "System"; id: string | null; label: string };

export type AuditRecord = {
  actor: AuditActor;
  action: string;
  objectType: string;
  objectId?: string | null;
  objectLabel?: string | null;
  detail?: Record<string, unknown>;
  outcome?: "Allowed" | "Denied";
  correlationId?: string | null;
};

/**
 * Writes one audit entry. The outcome defaults to Allowed; the correlation id defaults to the
 * request's `x-correlation-id`, and the IP is the first `x-forwarded-for` address.
 */
export async function audit(record: AuditRecord): Promise<void> {
  const requestHeaders = await headers();
  await insertAuditEntry({
    actorType: record.actor.type,
    actorId: record.actor.id,
    actorLabel: record.actor.label,
    action: record.action,
    objectType: record.objectType,
    objectId: record.objectId ?? null,
    objectLabel: record.objectLabel ?? null,
    detailJson: record.detail ?? {},
    outcome: record.outcome ?? "Allowed",
    correlationId: record.correlationId ?? requestHeaders.get("x-correlation-id"),
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
}
