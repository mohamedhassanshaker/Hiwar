import { useSyncExternalStore } from "react";

import { useAwp } from "@/hooks/use-awp";
import { relativeAge } from "@/i18n";

const MINUTE = 60_000;

function everyMinute(changed: () => void): () => void {
  const timer = setInterval(changed, MINUTE);
  return () => clearInterval(timer);
}

/**
 * The current minute in the browser's own time zone, or `null` while the server renders and
 * the page hydrates (D160).
 *
 * The server runs in UTC and the person's browser in theirs, so any text read off the clock —
 * a greeting, the day of the month — differs between the two and React throws away the
 * server's page on hydration. `null` on both sides of hydration keeps them identical; the
 * browser's own time follows straight after.
 */
export function useClientNow(): Date | null {
  const minute = useSyncExternalStore(everyMinute, () => Math.floor(Date.now() / MINUTE), () => null);
  return minute === null ? null : new Date(minute * MINUTE);
}

/**
 * "5m ago", read off the browser's clock once it is known (D160): blank while the server
 * renders and the page hydrates, so the two never disagree about the minute.
 */
export function useAgo(): { now: Date | null; age: (value: Date | string) => string; ago: (value: Date | string) => string } {
  const now = useClientNow();
  const { t } = useAwp();
  return {
    now,
    age: (value) => (now ? relativeAge(value, now) : ""),
    ago: (value) => (now ? t(`${relativeAge(value, now)} ago`, `قبل ${relativeAge(value, now)}`) : ""),
  };
}
