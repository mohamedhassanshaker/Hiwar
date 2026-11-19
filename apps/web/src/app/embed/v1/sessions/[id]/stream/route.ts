import { refusal, sessionOf } from "@/features/engage/widget-http";
import { widgetStream } from "@/features/engage/widget-stream";

/**
 * `GET /embed/v1/sessions/{id}/stream` (widget specification 14): server-sent events. The
 * token comes in the query string, because an `EventSource` cannot set a header.
 */

export const instant = false;
export const maxDuration = 300;

/** Opens the session's event stream; a token refusal answers in the protocol's error shape. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const claims = await sessionOf(request, id);
    return widgetStream(claims, request.signal);
  } catch (problem) {
    return refusal(problem);
  }
}
