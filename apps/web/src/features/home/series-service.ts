import { requireSession } from "@/lib/session";
import * as repository from "./repository";
import type { SeriesInput } from "./schema";
import type { DashboardSeries } from "./types";

/**
 * The instant a calendar day starts in `zone`, read from the zone's own offset at that time,
 * so a day that starts on a daylight-saving change still starts at its local midnight.
 */
function dayStart(day: string, zone: string): Date {
  const midnightUtc = Date.parse(`${day}T00:00:00.000Z`);
  const offsetAt = (instant: number): number => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return wall - Math.floor(instant / 1000) * 1000;
  };
  const first = midnightUtc - offsetAt(midnightUtc);
  return new Date(midnightUtc - offsetAt(first));
}

/** `day` moved by `days`, both `YYYY-MM-DD`. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A range of whole calendar days in the organisation's time zone (D365): from the start of
 * `fromDay` to the last millisecond of `toDay`, there. The buckets are cut in the same zone in
 * the database, so a reader in the UAE sees the day it is in the UAE, not in UTC.
 */
export function dayBounds(fromDay: string, toDay: string, zone: string): { from: Date; to: Date } {
  return { from: dayStart(fromDay, zone), to: new Date(dayStart(shiftDay(toDay, 1), zone).getTime() - 1) };
}

/** The range Dashboard 3 opens on: the last seven days in the organisation's zone, ending today. */
export function defaultRange(zone: string, now = new Date()): { from: Date; to: Date } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  return dayBounds(shiftDay(today, -6), today, zone);
}

/** The charts for one range, which the range menus re-read without reloading the page. */
export async function loadSeries(input: SeriesInput): Promise<DashboardSeries> {
  await requireSession();
  const zone = await repository.organisationZone();
  const { from, to } = dayBounds(input.from, input.to, zone);
  return readSeries(from, to, zone);
}

/**
 * The chart series for `from`..`to`: runs and finished work per bucket, run outcomes, and the
 * count finished in the equal span just before. Checks no session; callers do.
 */
export async function readSeries(from: Date, to: Date, zone: string): Promise<DashboardSeries> {
  const unit = repository.bucketUnit(from, to);
  // The same span immediately before, so "14 more than last week" compares like with like.
  const span = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - span);
  const [runs, finished, finishedPrevious, outcomes] = await Promise.all([
    repository.runsPerBucket(unit, from, to),
    repository.finishedPerBucket(unit, from, to),
    repository.finishedBetween(previousFrom, previousTo),
    repository.runOutcomes(from, to),
  ]);
  return { from: from.toISOString(), to: to.toISOString(), unit, zone, runs, finished, finishedPrevious, outcomes };
}
