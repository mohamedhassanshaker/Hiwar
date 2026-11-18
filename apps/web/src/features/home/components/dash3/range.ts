/**
 * The ranges Dashboard 3 offers, and how a bucket is labelled (handoff v2 section 2.3).
 *
 * The presets are relative to today rather than stored as dates, so a dashboard left open
 * overnight is showing the last seven days and not the seven days it opened on. "More"
 * carries the two dates the calendar produced.
 */

export type RangeId = "7d" | "1m" | "3m" | "6m" | "1y" | "custom";

/** A custom range carries its ends; a preset works them out from today. */
export type Range = { id: Exclude<RangeId, "custom"> } | { id: "custom"; from: Date; to: Date };

/** The earliest date the calendar goes back to. */
export const EARLIEST = new Date(2025, 0, 1);

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/** The two ends of a range, both whole days, ending today. */
export function boundsOf(range: Range, now = new Date()): { from: Date; to: Date } {
  if (range.id === "custom") return { from: startOfDay(range.from), to: endOfDay(range.to) };
  const to = endOfDay(now);
  const from = startOfDay(now);
  switch (range.id) {
    case "7d":
      from.setDate(from.getDate() - 6);
      break;
    case "1m":
      from.setMonth(from.getMonth() - 1);
      break;
    case "3m":
      from.setMonth(from.getMonth() - 3);
      break;
    case "6m":
      from.setMonth(from.getMonth() - 6);
      break;
    case "1y":
      from.setFullYear(from.getFullYear() - 1);
      break;
  }
  return { from, to };
}

/** `YYYY-MM-DD` in the local calendar, which is what the range action accepts. */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Whether two dates fall on the same local calendar day; false when either is null. */
export const sameDay = (a: Date | null, b: Date | null) =>
  a !== null && b !== null && isoDay(a) === isoDay(b);

/** The five presets, in the order the menus list them. */
export const PRESETS: Exclude<RangeId, "custom">[] = ["7d", "1m", "3m", "6m", "1y"];

const PRESET_LABEL: Record<Exclude<RangeId, "custom">, [string, string]> = {
  "7d": ["Last 7 days", "آخر 7 أيام"],
  "1m": ["Last month", "آخر شهر"],
  "3m": ["Last 3 months", "آخر 3 أشهر"],
  "6m": ["Last 6 months", "آخر 6 أشهر"],
  "1y": ["Last year", "آخر سنة"],
};

/** What a range is called, in the reader's language. */
export function rangeLabel(range: Range, t: (en: string, ar: string) => string, locale: string): string {
  if (range.id !== "custom") return t(...PRESET_LABEL[range.id]);
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  const start = range.from.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  const end = range.to.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${end}`;
}

/** `YYYY-MM-DD` of an instant on the calendar of `zone`. */
const dayIn = (date: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);

/**
 * The tick under one bucket.
 *
 * The last day of a day-bucketed range is "Today" rather than a date, which is the rule
 * handoff v2 states for every range menu: the ranges include today, and they say so.
 * The buckets are the organisation's days (D365), so they are named in its `zone`: the
 * runtime's own zone differs between the server and the browser, and the two renders
 * must read alike.
 */
export function bucketLabel(
  start: string,
  unit: string,
  last: boolean,
  t: (en: string, ar: string) => string,
  locale: string,
  zone: string,
  /** The browser's own clock, or null before it is known (D160). */
  now: Date | null,
): string {
  const date = new Date(start);
  if (unit === "day") {
    if (last && now && dayIn(date, zone) === dayIn(now, zone)) return t("Today", "اليوم");
    return date.toLocaleDateString(locale, { weekday: "short", timeZone: zone });
  }
  if (unit === "week") return date.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: zone });
  if (unit === "month") return date.toLocaleDateString(locale, { month: "short", timeZone: zone });
  return date.toLocaleDateString(locale, { month: "short", year: "2-digit", timeZone: zone });
}
