import { mayFollowRun } from "@/features/agents/service";
import { runStream } from "@/lib/sse";
import { NotPermitted, requireSession } from "@/lib/session";

/**
 * One run's AG-UI events, replayed from the offset the browser last saw (UC-52.1-04).
 * `Last-Event-ID` is what a reconnecting EventSource sends back on its own.
 *
 * The events carry the model's text, so only the person who started the run, somebody who
 * may read agent runs (D124), or, for a run in a room, somebody who may read that room
 * (D161) is given them.
 */

export const maxDuration = 300;

/**
 * Streams the run's events after `Last-Event-ID`, else `?after=`, else from the start. 404 for no
 * such run, 403 for a person who may not follow it.
 */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  await requireSession();
  const { runId } = await context.params;
  try {
    if (!(await mayFollowRun(runId))) return new Response("No such run.", { status: 404 });
  } catch (problem) {
    if (problem instanceof NotPermitted) return new Response("You may not follow this run.", { status: 403 });
    throw problem;
  }
  const after = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? "0-0";
  return runStream(runId, after, request.signal);
}
