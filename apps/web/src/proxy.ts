import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { env } from "@/server/env";
import { allowedOrigins, deploymentByKey } from "@/server/visitor";
import { recordWidgetLoadError } from "@/server/widget";

/**
 * Two jobs before a request reaches the app:
 * - The widget frame may only be embedded by the deployment's listed origins (DEP-001 FR-006):
 *   the browser enforces this from the Content-Security-Policy `frame-ancestors` directive.
 *   A frame the browser will not show (unknown key, or a page whose origin is not listed) is
 *   recorded as a widget load error for Cost and health (OPS-004 FR-003).
 * - Panel pages get the request path in `x-path`, so support-access page views can be audited
 *   (OPS-003 FR-004).
 */
/** The origin of the page that embeds the frame: the browser's Referer, else the loader's `page`. */
function embeddingOrigin(request: NextRequest): string | null {
  for (const value of [request.headers.get("referer"), request.nextUrl.searchParams.get("page")]) {
    if (!value) continue;
    try {
      return new URL(value).origin;
    } catch {
      // Not an absolute address; try the next source.
    }
  }
  return null;
}

const sameOrigin = (a: string, b: string) => a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/embed/")) {
    const key = path.split("/")[2] ?? "";
    const deployment = key ? await deploymentByKey(key) : null;
    const origins = deployment ? await allowedOrigins(deployment.id) : [];
    const response = NextResponse.next();
    // 'self' lets the control panel's widget preview (C-Widget) show the frame.
    const ancestors = ["'self'", ...origins.filter((o) => /^https?:\/\/[^\s;'"]+$/.test(o))].join(" ");
    response.headers.set("Content-Security-Policy", `frame-ancestors ${deployment ? ancestors : "'none'"}`);
    if (request.headers.get("sec-fetch-dest") === "iframe") {
      const embedder = embeddingOrigin(request);
      const blocked = embedder !== null && !sameOrigin(embedder, new URL(env().APP_URL).origin) && !origins.some((o) => sameOrigin(o, embedder));
      const reason = !deployment ? "unknown_key" : blocked ? "origin_not_allowed" : null;
      if (reason) event.waitUntil(recordWidgetLoadError({ orgId: deployment?.orgId ?? null, deploymentId: deployment?.id ?? null, reason, origin: embedder }));
    }
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set("x-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/embed/:path*", "/conversations/:path*", "/agents/:path*", "/knowledge/:path*", "/deployments/:path*", "/analytics/:path*", "/billing/:path*", "/team/:path*", "/audit/:path*", "/search/:path*", "/ops/:path*"],
};
