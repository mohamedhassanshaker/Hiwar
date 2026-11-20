import { followConversations } from "@/features/engage/service";
import { channelStream } from "@/lib/sse";
import { NotPermitted, requireSession } from "@/lib/session";
import { channels } from "@/lib/valkey";

/**
 * D344: every visitor conversation's activity, for the open-conversations panel and desktop
 * alerts. Each message names the conversation and whether a visitor wrote, never what they
 * wrote; the browser re-reads what it shows under its own permissions.
 */

export const maxDuration = 300;

/** Streams the conversations channel. 403 without `conversations:read`, 501 without live updates. */
export async function GET(request: Request) {
  await requireSession();
  try {
    await followConversations();
  } catch (problem) {
    if (problem instanceof NotPermitted) return new Response("You may not follow visitor conversations.", { status: 403 });
    throw problem;
  }
  return channelStream(channels.conversations(), request.signal);
}
