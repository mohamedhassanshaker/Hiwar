import { loadRoom } from "@/features/rooms/service";
import { channelStream } from "@/lib/sse";
import { requireSession } from "@/lib/session";
import { channels, liveUpdatesConfigured } from "@/lib/valkey";

/**
 * `UC-23.1-01` and `UC-23.1-12`: one room's live channel.
 *
 * Each message says only that the room changed; the browser re-reads the transcript under
 * its own permissions, which is also what rebuilds it for somebody who joined late. The
 * room is loaded first, so a person who may not read it is refused the stream as well.
 *
 * 501 when live updates are not configured, so the browser stops reconnecting instead of
 * retrying a stream that will never exist.
 */

export const instant = false;
export const maxDuration = 300;

/** Streams the room's channel to a person who may read the room; 404 for no such room, 501 without live updates. */
export async function GET(request: Request, context: { params: Promise<{ roomKey: string }> }) {
  await requireSession();
  const { roomKey } = await context.params;

  const room = await loadRoom(roomKey);
  if (!room) return new Response("No such room.", { status: 404 });
  if (!liveUpdatesConfigured()) return new Response("Live updates are not configured.", { status: 501 });

  return channelStream(channels.room(room.roomId), request.signal);
}
