import { loadConversation } from "@/features/engage/service";
import { channelStream } from "@/lib/sse";
import { NotPermitted, requireSession } from "@/lib/session";
import { channels, liveUpdatesConfigured } from "@/lib/valkey";

/**
 * D342: one visitor conversation's live channel for the Conversations screen.
 *
 * Each message says only that the conversation changed; the browser re-reads it under its own
 * permissions. The conversation is loaded first, so a person who may not read it is refused
 * the stream as well.
 */

export const instant = false;
export const maxDuration = 300;

/** Streams the conversation's channel. 404 for no such conversation, 403 without `conversations:read`, 501 without live updates. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No such conversation.", { status: 404 });
  try {
    if (!(await loadConversation(id))) return new Response("No such conversation.", { status: 404 });
  } catch (problem) {
    if (problem instanceof NotPermitted) return new Response("You may not read this conversation.", { status: 403 });
    throw problem;
  }
  if (!liveUpdatesConfigured()) return new Response("Live updates are not configured.", { status: 501 });
  return channelStream(channels.conversation(id), request.signal);
}
