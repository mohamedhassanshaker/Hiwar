import { allowedOriginsOf } from "@/features/engage/conversation-view";
import { publicConfig } from "@/features/engage/widget-session";

/**
 * `GET /embed/v1/config/{code}?host=<origin>`: what the loader draws the launcher with before
 * a session exists. A disabled or unknown deployment, or a page the deployment does not
 * allow, answers 403 and the loader draws nothing (widget specification 14). The frame is
 * refused to that page anyway; this is so the visitor never sees a launcher that cannot open.
 */

export const instant = false;

const HEADERS = { "cache-control": "no-store", "access-control-allow-origin": "*" };

const refused = (code: string, message: string, messageAr: string) =>
  Response.json({ error: { code, message, messageAr, retryAfter: null } }, { status: 403, headers: HEADERS });

/**
 * The deployment's public widget configuration, open to any origin and uncached. 403
 * `DEPLOYMENT_DISABLED` when the deployment is not enabled; with `?host=`, 403
 * `ORIGIN_NOT_ALLOWED` unless it matches an allowed origin, ignoring case and a trailing slash.
 * Without `host` no origin is checked.
 */
export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const config = await publicConfig(code);
  if (!config) return refused("DEPLOYMENT_DISABLED", "This assistant is not available.", "هذا المساعد غير متاح.");
  const host = new URL(request.url).searchParams.get("host");
  if (host !== null) {
    const allowed = await allowedOriginsOf(code);
    const listed = allowed.some((origin) => origin.replace(/\/$/, "").toLowerCase() === host.replace(/\/$/, "").toLowerCase());
    if (!listed) return refused("ORIGIN_NOT_ALLOWED", "This website is not allowed to load the assistant.", "هذا الموقع غير مسموح له بتحميل المساعد.");
  }
  return Response.json(config, { headers: HEADERS });
}
