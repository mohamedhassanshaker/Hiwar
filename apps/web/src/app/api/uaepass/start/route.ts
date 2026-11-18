import { connection, NextResponse, type NextRequest } from "next/server";

import { beginUaePass, uaePassConfigured } from "@/features/auth/service";
import { env } from "@/lib/env";

// Never cached and never prerendered: it reads this browser's cookies and the settings of the running pod.
export const instant = false;

/**
 * D387: `GET /api/uaepass/start?next=&lang=` — Sign in with UAE PASS. Sends the browser to UAE
 * PASS's login with a fresh state; back to `/sign-in` when UAE PASS is not set up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  await connection();
  if (!uaePassConfigured()) return NextResponse.redirect(new URL("/sign-in", env().APP_URL));
  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  return NextResponse.redirect(await beginUaePass(request.nextUrl.searchParams.get("next"), lang));
}
