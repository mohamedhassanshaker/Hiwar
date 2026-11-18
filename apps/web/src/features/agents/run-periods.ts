/**
 * D300: how far back a run list reaches, in hours, as the agent's Runs tab and the Runs screen
 * (D383) offer it; 0 is any time. Kept out of the client components so server pages read values.
 */
export const RUN_PERIODS: [number, string, string][] = [
  [0, "Any time", "أي وقت"],
  [24, "Last 24 hours", "آخر 24 ساعة"],
  [24 * 7, "Last 7 days", "آخر 7 أيام"],
  [24 * 30, "Last 30 days", "آخر 30 يوماً"],
];

/** The period a `?period=` value names, in hours; anything not offered is any time (0). */
export function runPeriodOf(value: string | undefined): number {
  const hours = Number(value);
  return RUN_PERIODS.some(([offered]) => offered === hours) ? hours : 0;
}
