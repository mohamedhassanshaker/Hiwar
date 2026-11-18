import { channelStream } from "@/lib/sse";
import { DASHBOARD_SCOPE } from "@/lib/live";
import { liveUpdatesConfigured, channels } from "@/lib/valkey";
import { requireSession } from "@/lib/session";

/**
 * `UC-10.1-02`: the dashboard's live channel. Each message is a reason something it counts
 * changed; the browser re-reads the page under its own permissions.
 *
 * 501 when live updates are not configured, so the browser stops reconnecting instead of
 * retrying a stream that will never exist.
 */

export const instant = false;
export const maxDuration = 300;

/** Streams the dashboard channel to any signed-in person; 501 without live updates. */
export async function GET(request: Request) {
  await requireSession();
  if (!liveUpdatesConfigured()) {
    return new Response("Live updates are not configured.", { status: 501 });
  }
  return channelStream(channels.dashboard(DASHBOARD_SCOPE), request.signal);
}
