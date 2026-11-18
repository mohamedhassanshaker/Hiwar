import { connection, NextResponse, type NextRequest } from "next/server";

import { finishUaePass } from "@/features/auth/service";
import { env } from "@/lib/env";

// Never cached and never prerendered: it reads this browser's cookies and the settings of the running pod.
export const instant = false;

/**
 * D387: `GET /api/uaepass/callback?code=&state=` (or `?error=`) — where UAE PASS returns the
 * browser. Signs the person in, sends them to link their account, or back to `/sign-in` with why.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  await connection();
  const destination = await finishUaePass(request.nextUrl.searchParams);
  return NextResponse.redirect(new URL(destination, env().APP_URL));
}
