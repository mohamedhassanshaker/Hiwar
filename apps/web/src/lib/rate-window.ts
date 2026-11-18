import { liveUpdatesConfigured, valkey } from "./valkey";

/**
 * A fixed-window counter in Valkey, for calls that cost money per use and have no table to
 * count them in, such as a transcription (D386). Without Valkey (the `core` profile) nothing
 * is counted and every call is let through, since there is nowhere to count across replicas.
 */

/**
 * Counts one call against `key` and says whether it is within `limit` for the current window.
 *
 * @param key what the calls are counted per, e.g. `stt:person:<id>`.
 * @param limit calls allowed in one window.
 * @param windowSeconds the window's length; it starts at the first call counted in it.
 * @returns true when this call is within the limit.
 */
export async function withinRate(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return (await countAgainst(key, windowSeconds)) <= limit;
}

/**
 * Counts one event against `key` in its window and returns the count so far; 0 without Valkey.
 * For limits on failures (D387: wrong passwords), where only some calls are counted.
 */
export async function countAgainst(key: string, windowSeconds: number): Promise<number> {
  if (!liveUpdatesConfigured()) return 0;
  const counted = `awp:rate:${key}`;
  const calls = await valkey().incr(counted);
  if (calls === 1) await valkey().expire(counted, windowSeconds);
  return calls;
}

/** Whether `key` has already reached `limit` in its current window, counting nothing. */
export async function reachedLimit(key: string, limit: number): Promise<boolean> {
  if (!liveUpdatesConfigured()) return false;
  return Number((await valkey().get(`awp:rate:${key}`)) ?? 0) >= limit;
}
