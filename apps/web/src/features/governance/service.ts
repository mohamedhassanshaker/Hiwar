import { audit } from "@/lib/audit";
import { health } from "@/lib/health";
import { maskLogLine } from "@/lib/log-masking";
import { can, requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { SystemState } from "./types";

export {
  saveBrandColour,
  saveBrandingAsset,
  removeBrandingAsset,
  setFeatureFlag,
  SettingsRejected,
  saveGeneralSettings,
  saveMailSettings,
  saveMailTemplate,
  flagConsequences,
  loadBranding,
  faviconUrl,
  publicLogos,
  loadLetterhead,
  isFeatureEnabled,
} from "./settings-service";

/** S-73 to S-75, S-78 and S-79. */

/**
 * `UC-73.1-01` and `UC-73.1-02`: the newest entries matching the filter, which the
 * repository applies in the query rather than the browser applying it to one page.
 */
export async function loadAudit(filter: repository.AuditFilter = {}) {
  await requirePermission("audit:read");
  return repository.listAudit(filter);
}

/**
 * D388: one record's audit entries since it was created, oldest first (at most 500), for a report
 * about it; null for a person without `audit:read`, whose report then leaves the audit out rather
 * than refusing. `since` matters: a key is reused once its record is deleted.
 */
export async function loadRecordAudit(objectType: string, objectLabel: string, since: Date) {
  if (!(await can("audit:read"))) return null;
  return (await repository.listAudit({ objectType, objectLabel, since, limit: 500 })).reverse();
}

/** One page of the audit log, and how many entries match in all. */
export async function loadAuditPage(filter: repository.AuditFilter) {
  await requirePermission("audit:read");
  const [rows, total] = await Promise.all([repository.listAudit(filter), repository.countAudit(filter)]);
  return { rows, total };
}

/**
 * `UC-74.1-01` … `-03`: the log, filtered by level, service or run, plus the service list.
 *
 * `UC-74.1-05`: every message is masked on the way out. `lib/logger.ts` redacts named
 * fields before a line is written, which cannot reach a value interpolated into the message
 * itself, and the collected stream also carries lines this platform did not write. Masking
 * here is the one point that covers all of them, and the scenario is about what is shown.
 */
export async function loadLogs(filter: repository.LogFilter = {}) {
  await requirePermission("logs:read");
  const [rows, services, total] = await Promise.all([
    repository.listLogs(filter),
    repository.listLogServices(),
    repository.countLogs(filter),
  ]);
  return { rows: rows.map((row) => ({ ...row, message: maskLogLine(row.message) })), services, total };
}

/**
 * The Settings screen's data: organisation, calendars, settings version, branding, flags, and the
 * mail settings without the password. Requires `settings:read`.
 */
export async function loadSettings() {
  await requirePermission("settings:read");
  return repository.readSettings();
}

/** The documentation pages in their order. Checks no permission: any signed-in person reads them. */
export async function loadDocs() {
  return repository.listDocPages();
}

/**
 * The System page: the stored system state with each dependency's health probe, `up` read as
 * Healthy, `skipped` as Disabled and anything else as Error. Requires `system:read`.
 */
export async function loadSystem(): Promise<SystemState> {
  await requirePermission("system:read");
  const [state, probes] = await Promise.all([repository.readSystemState(), health()]);
  return {
    ...state,
    checkedAt: probes.checkedAt,
    services: probes.dependencies.map((probe) => ({
      name: probe.name,
      version: probe.version,
      status: probe.status === "up" ? "Healthy" : probe.status === "skipped" ? "Disabled" : "Error",
      detail: probe.detail,
    })),
  };
}

/** `UC-78.1-02` and `UC-78.1-03`: pause every agent, then let them run again. */
export async function pauseAgents(paused: boolean) {
  const session = await requirePermission("system:operate");
  await repository.setAgentsPaused(paused, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: paused ? "system:pause_agents" : "system:resume_agents",
    objectType: "SystemState",
  });
}

/**
 * `UC-73.1-03`: export the entries the auditor is looking at, and audit the export.
 *
 * Built from the same filtered read the screen showed, so what leaves the platform is what
 * was on screen — an export that quietly widened the filter would be a different document
 * from the one the auditor reviewed.
 *
 * Taking data out of the platform is itself an action, so it leaves its own entry. The
 * entry records the filter and the row count, never the rows: an audit trail that copied
 * the exported personal data would defeat the export being controlled at all.
 */
export async function exportAudit(filter: repository.AuditFilter = {}): Promise<string> {
  const session = await requirePermission("exports:create");
  await requirePermission("audit:read");

  const rows = await repository.listAudit(filter);
  const columns = ["at", "actorType", "actorLabel", "action", "objectType", "objectLabel", "outcome"] as const;
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
  ].join("\n");

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "exports:create",
    objectType: "AuditTrail",
    objectLabel: "audit",
    detail: { rows: rows.length, filter: { ...filter } },
  });
  return csv;
}
