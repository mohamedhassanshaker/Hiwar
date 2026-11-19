/**
 * The prototype's sample data is written against one moment: Friday 9 October 2026,
 * 14:45 Dubai time. A demo organisation seeded a year later would show an empty "today",
 * so every timestamp in the seed is shifted by the distance between that moment and the
 * moment the seed runs. Relative labels — "2m ago", "due in 3 days", "this month" — then
 * read the same whenever the seed is run.
 *
 * Row counts do not depend on the clock, so `npm run db:seed` stays idempotent.
 */
export const PROTOTYPE_NOW = Date.parse("2026-10-09T10:45:00Z");

const DELTA = Date.now() - PROTOTYPE_NOW;

/** A prototype instant, moved to the present. */
export function shift(instant: Date | string | number): Date {
  const value = typeof instant === "number" ? instant : typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  return new Date(value + DELTA);
}

/** `minutes` before the seeded "now". */
export function at(minutes: number): Date {
  return shift(PROTOTYPE_NOW - minutes * 60_000);
}

/** `days` before the seeded "now". */
export function daysAgo(days: number): Date {
  return at(days * 24 * 60);
}

/** A prototype `yyyy-mm-dd`, moved to the present and written back as `yyyy-mm-dd`. */
export function shiftDay(day: string): string {
  return shift(`${day}T00:00:00Z`).toISOString().slice(0, 10);
}

/** The first day of the month `offset` months before the seeded "now". */
export function monthStart(offset: number): Date {
  const now = at(0);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

/** The last day of the month `offset` months before the seeded "now". */
export function monthEnd(offset: number): Date {
  const now = at(0);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 0));
}
