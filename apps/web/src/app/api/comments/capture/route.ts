import { z } from "zod";

import { readCapture } from "@/features/comments/service";
import { getObject } from "@/lib/objects";
import { NotPermitted } from "@/lib/session";

/**
 * The captured area of a card attached to a comment (handoff v2 section 5.1).
 *
 * Served through the console rather than from the store: the object store sits inside the
 * cluster with no route of its own, and a signed-in check the browser could skip is not a
 * check. The service decides whether the comment may be read at all; this hands back the
 * bytes it allowed.
 */

// Never cached and never prerendered: what this answers depends on who is asking.
export const instant = false;

/**
 * Streams the capture of the comment named by `?comment=`, uncached. 400 without a comment or with
 * one that is not an id (the column is a uuid, so the database would otherwise fail with a 500),
 * 404 when it has no capture, 403 when the person may not read the comment.
 */
export async function GET(request: Request): Promise<Response> {
  const commentId = new URL(request.url).searchParams.get("comment");
  if (!commentId) return new Response("Name the comment.", { status: 400 });
  if (!z.uuid().safeParse(commentId).success) return new Response("That is not a comment id.", { status: 400 });

  try {
    const capture = await readCapture(commentId);
    if (!capture) return new Response("No capture.", { status: 404 });
    const object = await getObject(capture.ref);
    if (!object) return new Response("No capture.", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        ...(object.size === null ? {} : { "content-length": String(object.size) }),
        "cache-control": "private, no-store",
      },
    });
  } catch (problem) {
    // A route has no error boundary of its own, so the refusal answers here.
    if (problem instanceof NotPermitted) return new Response("You may not read this.", { status: 403 });
    throw problem;
  }
}
