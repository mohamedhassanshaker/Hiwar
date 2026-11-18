import { channels } from "@/lib/valkey";
import { channelStream } from "@/lib/sse";
import { requireSession } from "@/lib/session";

/** The inbox badge, which has to match the open items live (UC-01.1-06). */

// Never cached and never prerendered: this answers a live request.
export const instant = false;

/** Streams the signed-in person's own inbox channel; 501 without live updates. */
export async function GET(request: Request) {
  const session = await requireSession();
  return channelStream(channels.inbox(session.personId), request.signal);
}
