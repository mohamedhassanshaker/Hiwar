import { loadRecentRooms } from "@/features/rooms/service";
import { audit } from "@/lib/audit";
import { can, requirePermission, requireSession } from "@/lib/session";
import * as repository from "./repository";
import type { ExportRecordsInput } from "./schema";
import type { DashboardData, RecordSet } from "./types";
import { defaultRange, readSeries } from "./series-service";

export { defaultRange, loadSeries } from "./series-service";
export { type ReportRow, type Report, buildReport, reportWords } from "./report-service";
export { search } from "./search-service";

/** S-10 the dashboard and S-11 its drill-downs. */

/**
 * Where a signed-in person lands (`UC-01.1-01`, `UC-05.1-04`): the dashboard, for everyone and
 * on a brand-new installation too (D371). An empty installation is configured from its own
 * screens or through the Platform Assistant, both reached from there.
 */
export async function landingPath(): Promise<string> {
  return "/dashboard";
}

/**
 * Everything the dashboard shows for a signed-in person, read in parallel. The run list is cut
 * to its first four rows and the SLA list to a count; `showCost` gates the money cards.
 */
export async function loadDashboard(): Promise<DashboardData> {
  await requireSession();
  const zone = await repository.organisationZone();
  const { from, to } = defaultRange(zone);
  const [organisation, openWorkItems, runs, approvals, agentsInError, cost, sla, rooms, showCost, empty, automation, costSplit, series] =
    await Promise.all([
      repository.readOrganisation(),
      repository.openWorkItems(),
      repository.runsInProgress(4),
      repository.approvalsWaiting(),
      repository.agentsInError(),
      repository.estimatedCost(),
      repository.countSlaAtRisk(),
      loadRecentRooms(4),
      // `UC-10.1-05`: what the platform spends is a budget figure, so it is gated by the
      // permission that gates the budgets screen rather than shown to everyone who signs in.
      can("budgets:read"),
      repository.installationIsEmpty(),
      // Eight weeks, which is the span the sparkline is drawn over whatever range the
      // cards below it are showing: the automation rate is a trend, not a period figure.
      repository.automationRate("week", to),
      repository.monthCostSplit(),
      readSeries(from, to, zone),
    ]);
  return {
    organisationEn: organisation.nameEn,
    organisationAr: organisation.nameAr,
    openWorkItems,
    runs,
    approvals,
    agentsInError,
    cost,
    slaAtRisk: sla,
    rooms,
    showCost,
    empty,
    automation,
    costSplit,
    series,
  };
}

/**
 * One page (50 rows unless given) of one drill-down list (`sla` when no kind is given) for a
 * signed-in person, filtered in the database (D349), with whether they may export it.
 */
export async function loadRecords(kind: string | undefined, query: repository.RecordQuery = {}): Promise<RecordSet> {
  await requireSession();
  const [set, mayExport] = await Promise.all([
    repository.readRecordSet(kind ?? "sla", { ...query, limit: Math.min(query.limit ?? 50, 200) }),
    can("exports:create"),
  ]);
  return { ...set, mayExport };
}

/**
 * Requirement 34: an export is audited like any other action, because it takes data out of
 * the platform. The rows are built from the same read model the screen showed.
 */
export async function exportRecords(input: ExportRecordsInput): Promise<string> {
  const session = await requirePermission("exports:create");
  // Every row the filters match, read with the same filters the screen's page was, so the file
  // holds what the screen lists across all its pages.
  const set = await repository.readRecordSet(input.kind, { term: input.term, project: input.project, status: input.status });
  const rows = set.rows;
  // `UC-11.1-05`: an estimated cost is labelled as estimated wherever it leaves the platform.
  const header = set.cols.map((column) => (column === "amount" ? "estimated_cost_aed" : column)).join(",");
  const body = rows
    .map((row) => row.map((cell) => (cell === null ? "" : `"${String(cell).replace(/"/g, '""')}"`)).join(","))
    .join("\n");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "exports:create",
    objectType: "RecordSet",
    objectLabel: input.kind,
    detail: {
      rows: rows.length,
      format: input.format,
      filtered: Boolean(input.term?.trim() || (input.project && input.project !== "any") || (input.status && input.status !== "any")),
    },
  });
  return `${header}\n${body}`;
}
