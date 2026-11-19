import { contentTypeOf } from "@/features/skills/file-kinds";
import { readSkillFile } from "@/features/skills/service";
import { contentDisposition } from "@/lib/uploads";
import { packageRefusal } from "../../refusal";

/** One file of a skill's current version (`?path=`), inline or, with `download=1`, as a download. */

// Never cached and never prerendered: what this answers depends on who is asking.
export const instant = false;

/**
 * 400 for a path that leaves the package, 403 without `skills:read`, 404 for no such skill or
 * file. Served as text, a raster image or bytes, never as a type the browser would run.
 */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await context.params;
  const asked = new URL(request.url).searchParams;
  const path = asked.get("path") ?? "";
  try {
    const file = await readSkillFile(name, path);
    const type = contentTypeOf(path);
    return new Response(file.body, {
      headers: {
        "content-type": type,
        ...(file.size === null ? {} : { "content-length": String(file.size) }),
        "content-disposition": contentDisposition(
          asked.get("download") === "1" ? "attachment" : "inline",
          path.slice(path.lastIndexOf("/") + 1),
          type,
        ),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (problem) {
    const refused = packageRefusal(problem);
    if (refused) return refused;
    throw problem;
  }
}
