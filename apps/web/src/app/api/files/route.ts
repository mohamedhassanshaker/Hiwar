import { FileRejected, readContent } from "@/features/files/service";
import { NotPermitted } from "@/lib/session";
import { contentDisposition } from "@/lib/uploads";

/**
 * `UC-32.1-02` and `UC-33.1-08`: the bytes behind a preview or a download.
 *
 * The console serves them itself: the object store sits inside the cluster with no route of
 * its own, and the scope of use has to be decided somewhere the browser cannot skip. The
 * service decides it; this hands back what it allowed.
 */

// Never cached and never prerendered: what this answers depends on who is asking.
export const instant = false;

/**
 * Streams a file, an artifact or an attachment (`?kind=`) by `?name=`, inline or, with
 * `download=1`, as a download. An attachment is resolved through its owner (`ownerType`, default
 * WorkItem, and `ownerKey`). 400 without a name, 403 when the service refuses the read.
 */
export async function GET(request: Request): Promise<Response> {
  const asked = new URL(request.url).searchParams;
  const name = asked.get("name");
  const asKind = asked.get("kind");
  const kind = asKind === "artifact" || asKind === "attachment" ? asKind : "file";
  // An attachment is read through the item it is on, which is what decides who may see it.
  const askedOwnerType = asked.get("ownerType");
  const ownerType = askedOwnerType === "Request" || askedOwnerType === "Room" ? askedOwnerType : "WorkItem";
  const ownerKey = asked.get("ownerKey");
  const owner = kind === "attachment" && ownerKey ? ({ type: ownerType, key: ownerKey } as const) : undefined;
  // The preview reads the same bytes in place; only the download asks to be saved.
  const disposition = asked.get("download") === "1" ? "attachment" : "inline";
  if (!name) return new Response("Name the file.", { status: 400 });

  try {
    const content = await readContent(name, kind, owner);
    return new Response(content.body, {
      headers: {
        "content-type": content.contentType,
        ...(content.size === null ? {} : { "content-length": String(content.size) }),
        "content-disposition": contentDisposition(disposition, name, content.contentType),
        "cache-control": "private, no-store",
      },
    });
  } catch (problem) {
    // A route has no error boundary of its own, so both refusals answer here: the person is
    // not allowed, or the file is not theirs to read.
    if (problem instanceof FileRejected) return new Response(problem.message, { status: 403 });
    if (problem instanceof NotPermitted) return new Response("You may not read files.", { status: 403 });
    throw problem;
  }
}
