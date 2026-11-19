import { NextResponse, type NextRequest } from "next/server";

import { verifyEmail } from "@/server/accounts";
import { env } from "@/server/env";
import { startSession } from "@/server/session";

/** ORG-004 FR-003/FR-004: the verification link signs the new Owner in and opens Conversations. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await verifyEmail(token);
  if (!result) return NextResponse.redirect(new URL("/verify-email/invalid", env().APP_URL));
  await startSession(result.userId, result.orgId, true);
  return NextResponse.redirect(new URL("/conversations", env().APP_URL));
}
