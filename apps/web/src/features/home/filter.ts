import type { RecordRow, RecordSetRows } from "./types";

/**
 * What the drill-down list (S-11) is filtered by, in one place.
 *
 * The screen filters as the person types and the export takes the filtered rows
 * (`UC-11.1-02`, `UC-11.1-03`, `UC-11.1-05`). Both read this, so a file never contains
 * rows the screen was hiding.
 */

/** Which element of a row each column name reads. */
export const COLUMN_INDEX: Record<string, number> = {
  key: 0,
  title: 1,
  project: 2,
  status: 3,
  who: 4,
  due: 5,
  agent: 2,
  started: 4,
  risk: 3,
  amount: 3,
  left: 5,
};

export type RecordFilter = { term?: string; project?: string; status?: string };

/** The rows of a set that match, in the set's own order. */
export function filterRecords(set: RecordSetRows, filter: RecordFilter): RecordRow[] {
  const term = (filter.term ?? "").trim().toLowerCase();
  const project = filter.project ?? "any";
  const status = filter.status ?? "any";
  return set.rows.filter(
    (row) =>
      (term === "" || `${row[0]}${row[1]}`.toLowerCase().includes(term)) &&
      (project === "any" || row[COLUMN_INDEX.project] === project) &&
      (status === "any" || row[COLUMN_INDEX.status] === status),
  );
}
