import { answer, sessionOf } from "@/features/engage/widget-http";
import { endSession, sessionView } from "@/features/engage/widget-session";

/** `GET` the session as it stands; `DELETE` ends it (widget specification 14). */

export const instant = false;

type Context = { params: Promise<{ id: string }> };

/** The session's current view with a fresh token. */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return answer(async () => sessionView(await sessionOf(request, id)));
}

/** Ends the conversation as Abandoned unless it already has an outcome; 204. */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return answer(async () => {
    await endSession(await sessionOf(request, id));
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
