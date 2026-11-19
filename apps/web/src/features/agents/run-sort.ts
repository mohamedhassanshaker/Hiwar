/**
 * D383: the orders the Runs screen lists runs in, read from its address. Newest first unless
 * the address names another column or direction.
 */

/** The columns a run list can be sorted on. */
export const RUN_SORT_COLUMNS = ["started", "agent", "status", "duration", "cost"] as const;

export type RunSortColumn = (typeof RUN_SORT_COLUMNS)[number];

/** A column and a direction. */
export type RunSort = { column: RunSortColumn; dir: "asc" | "desc" };

/** Newest first, the order every run list has had (D349). */
export const DEFAULT_RUN_SORT: RunSort = { column: "started", dir: "desc" };

/**
 * The sort a `?sort=&dir=` pair names. An unknown column is the default order, and a column
 * with no readable direction is descending, so a link to a column lists its largest first.
 */
export function runSortOf(column: string | undefined, dir: string | undefined): RunSort {
  const known = RUN_SORT_COLUMNS.find((name) => name === column);
  if (!known) return DEFAULT_RUN_SORT;
  return { column: known, dir: dir === "asc" ? "asc" : "desc" };
}

/** The order a header press asks for: the other direction on the current column, descending on a new one. */
export function nextRunSort(current: RunSort, column: RunSortColumn): RunSort {
  if (current.column !== column) return { column, dir: "desc" };
  return { column, dir: current.dir === "desc" ? "asc" : "desc" };
}
