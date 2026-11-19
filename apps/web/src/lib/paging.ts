/** How many rows a screen paged on the server asks for at a time. */
export const SERVER_PAGE_SIZE = 50;

/** The 1-based page a `?page=` value names; anything unreadable is the first page. */
export function pageOf(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Which page a screen is on, of how many rows, with how many to a page. */
export type ServerPage = { page: number; total: number; size: number };

/** A `YYYY-MM-DD` filter value as the start of that day in Dubai time, which the console shows; undefined otherwise. */
export function dayStart(day: string | undefined): Date | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  // D342: a day that does not exist (2026-13-45, 2026-02-31) is unreadable too, not a crash or a rolled-over date.
  const utc = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== day) return undefined;
  return new Date(`${day}T00:00:00+04:00`);
}

/** The start of the day after a `YYYY-MM-DD` filter value, so a "to" day is included; undefined otherwise. */
export function dayAfter(day: string | undefined): Date | undefined {
  const start = dayStart(day);
  return start ? new Date(start.getTime() + 86_400_000) : undefined;
}
