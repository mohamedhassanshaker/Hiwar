"use server";

import { exportRecordsInput, reportInput, searchInput, seriesInput } from "./schema";
import * as service from "./service";
import type { DashboardSeries, SearchGroup } from "./types";
import type { Report } from "./service";

/** S-11: exporting a drill-down list, which the audit log records. */

export async function exportRecords(input: unknown): Promise<string> {
  return service.exportRecords(exportRecordsInput.parse(input));
}

/** Handoff v2 section 3: the rows of a dashboard report, which the audit log records. */
export async function buildReport(input: unknown): Promise<Report> {
  return service.buildReport(reportInput.parse(input));
}

/** S-10: the charts for a range the person chose, without reloading the whole dashboard. */
export async function loadSeries(input: unknown): Promise<DashboardSeries> {
  return service.loadSeries(seriesInput.parse(input));
}

/** S-02: what the search palette calls on every keystroke. The filtering is all server-side. */
export async function searchEverything(input: unknown): Promise<SearchGroup[]> {
  return service.search(searchInput.parse(input));
}
