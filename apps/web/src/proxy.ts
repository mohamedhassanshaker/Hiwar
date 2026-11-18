import { NextResponse, type NextRequest } from "next/server";

import { allowedOriginsOf } from "@/features/engage/conversation-view";

/**
 * What every request to the console passes through.
 *
 * Two things, both of which have to happen per request:
 *
 * `COM-09`: a session that ends mid-work must bring the person back to the screen they
 * were on. A server component cannot read its own URL, so the path goes on a request
 * header that `requireSession()` reads when it builds `/sign-in?next=…`.
 *
 * Security finding F-05: a `script-src` worth having needs a nonce that changes every
 * request, so it cannot live in the gateway's static header. Next.js reads the policy from
 * the request header, takes the nonce out of it and puts it on every script it renders;
 * `strict-dynamic` then lets those scripts load the chunks they need and nothing else.
 *
 * `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and deprecated the
 * old name (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
 */

/**
 * The whole policy, because a header can only come from one place.
 *
 * Traefik sets response headers rather than adding to them, so a policy split between the
 * edge and here would leave whichever ran last. The nonce has to be minted per request, so
 * the console is the side that owns the header and the edge sets the rest.
 */
function policy(nonce: string, frameAncestors: string): string {
  return [
    // `img-src`: an identity provider's `picture` claim is a URL the console renders, and
    // an uploaded photo is a `data:` URL (`src/lib/photo.ts`).
    "img-src 'self' data:",
    // `https:` and `'unsafe-inline'` are for browsers that do not understand
    // `strict-dynamic`; one that does ignores both, which is how the policy stays strict
    // where it can be and does not break where it cannot.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    // The design system styles elements inline, so the attribute form has to be allowed.
    "style-src 'self' 'unsafe-inline'",
    frameAncestors,
    // The console frames its own file preview (`/api/files`) and the widget preview.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/** The embedded widget's frame, `/embed/v1/frame/<deployment>` (widget specification 2, D231). */
const WIDGET_FRAME = /^\/embed\/v1\/frame\/([^/]+)\/?$/;

/**
 * Who may frame the response. The console is never framed, except for a file its own
 * preview frames. The widget's frame may be framed by the deployment's allowed origins and
 * by the console, whose Preview tab shows it; `null` among them is a page opened as a file,
 * which admits every page (D220): `*` for every network scheme, and `file:`, which `*` does
 * not match (D278).
 */
async function frameAncestorsFor(pathname: string): Promise<string> {
  if (pathname === "/api/files") return "frame-ancestors 'self'";
  const frame = WIDGET_FRAME.exec(pathname);
  if (!frame) return "frame-ancestors 'none'";
  const origins = await allowedOriginsOf(decodeURIComponent(frame[1])).catch(() => [] as string[]);
  if (origins.includes("null")) return "frame-ancestors * file:";
  const sources = origins.filter((origin) => /^https?:\/\/[^\s;,'"]+$/.test(origin));
  return `frame-ancestors 'self' ${sources.join(" ")}`.trim();
}

/**
 * Runs before every matched request: mints a nonce, builds the content security policy with
 * this path's `frame-ancestors`, and passes the request on with `x-pathname`, `x-nonce` and the
 * policy as request headers. The response carries the same policy. Static assets, image
 * optimisation, `api/auth` and the favicon are not matched.
 */
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = policy(nonce, await frameAncestorsFor(request.nextUrl.pathname));

  const headers = new Headers(request.headers);
  headers.set("x-pathname", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/auth|favicon.ico).*)"],
};
