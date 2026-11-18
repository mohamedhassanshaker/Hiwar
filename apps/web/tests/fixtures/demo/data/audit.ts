/**
 * Synthetic audit history for the demo organisation (`UC-73.1-02`, `UC-74.1-02`): the Audit
 * screen's filters, and the database suite that exercises them against the real append-only
 * table, need a mix of Person and Agent entries spread over enough real days that a filtered
 * query can reach rows a browser-side filter never could.
 *
 * `audit.audit_entry` is partitioned by month and the maintenance routine only keeps last
 * month, this month and the next three (`infra/postgres/03-partitions.sql`), so every entry
 * built from these templates stays within about three weeks of "now" — old enough to spread
 * across pages, never old enough to miss a partition.
 */
export const AUDIT_PERSON_TEMPLATES: [person: string, action: string, objectType: string, objectLabel: string][] = [
  ["u1", "settings:write", "Settings", "General settings"],
  ["u4", "agents:write", "Agent", "Expense Reviewer"],
  ["u4", "agents:publish", "Agent", "Expense Reviewer v7"],
  ["u6", "connectors:write", "Connector", "ERP"],
  ["u6", "budgets:write", "Budget", "Expense Reviewer budget"],
  ["u3", "requests:approve", "Request", "EXP-4471"],
  ["u3", "approvals:decide", "Approval", "EXP-4471"],
  ["u7", "exports:create", "AuditExport", "Audit log, last 30 days"],
  ["u6", "permissions:write", "RoleAssignment", "Layla Ahmed"],
  ["u1", "agents:publish", "Agent", "Customer Assistant v12"],
];

export const AUDIT_AGENT_TEMPLATES: [agent: string, action: string, objectType: string, objectLabel: string][] = [
  ["exp", "runs:finish", "Run", "RUN-7731"],
  ["sup", "runs:finish", "Run", "RUN-7742"],
  ["prc", "runs:finish", "Run", "RUN-7753"],
  ["bug", "runs:finish", "Run", "RUN-7764"],
  ["rec", "memory:write", "Memory", "Reconciliation notes"],
  ["kb", "knowledge:ingest", "KnowledgeSource", "Policy handbook"],
  ["def", "runs:finish", "Run", "RUN-7775"],
];
