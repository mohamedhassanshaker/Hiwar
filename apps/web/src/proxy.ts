import { NextResponse, type NextRequest } from "next/server";

import { allowedOrigins, deploymentByKey } from "@/server/visitor";

/**
 * Two jobs before a request reaches the app:
 * - The widget frame may only be embedded by the deployment's listed origins (DEP-001 FR-006):
 *   the browser enforces this from the Content-Security-Policy `frame-ancestors` directive.
 * - Panel pages get the request path in `x-path`, so support-access page views can be audited
 *   (OPS-003 FR-004).
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/embed/")) {
    const key = path.split("/")[2] ?? "";
    const deployment = key ? await deploymentByKey(key) : null;
    const origins = deployment ? await allowedOrigins(deployment.id) : [];
    const response = NextResponse.next();
    // 'self' lets the control panel's widget preview (C-Widget) show the frame.
    const ancestors = ["'self'", ...origins.filter((o) => /^https?:\/\/[^\s;'"]+$/.test(o))].join(" ");
    response.headers.set("Content-Security-Policy", `frame-ancestors ${deployment ? ancestors : "'none'"}`);
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set("x-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/embed/:path*", "/conversations/:path*", "/agents/:path*", "/knowledge/:path*", "/deployments/:path*", "/analytics/:path*", "/billing/:path*", "/team/:path*", "/audit/:path*", "/search/:path*", "/ops/:path*"],
};
