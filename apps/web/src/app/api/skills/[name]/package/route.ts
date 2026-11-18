import { skillPackageZip } from "@/features/skills/service";
import { contentDisposition } from "@/lib/uploads";
import { packageRefusal } from "../../refusal";

/** A skill's current version as a `.zip`, for Download as .zip on its detail. */

// Never cached and never prerendered: what this answers depends on who is asking.
export const instant = false;

/** 403 without `skills:read`, 404 for no such skill or no stored files, 409 for a bundled skill or one past the limits. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await context.params;
  try {
    const zip = await skillPackageZip(name);
    return new Response(zip.bytes, {
      headers: {
        "content-type": "application/zip",
        "content-length": String(zip.bytes.byteLength),
        "content-disposition": contentDisposition("attachment", zip.name, "application/zip"),
        "cache-control": "private, no-store",
      },
    });
  } catch (problem) {
    const refused = packageRefusal(problem);
    if (refused) return refused;
    throw problem;
  }
}
