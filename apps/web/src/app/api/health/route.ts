import { health } from "@/lib/health";

/**
 * Acceptance 19: `GET /api/health` returns 200 with a JSON body listing each dependency.
 * The Kubernetes readiness probe and the System screen both read it, so it is never cached
 * and never prerendered.
 */
export const instant = false;

/** Always 200, uncached; each dependency's own status is in the body. */
export async function GET(): Promise<Response> {
  const result = await health();
  return Response.json(result, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
