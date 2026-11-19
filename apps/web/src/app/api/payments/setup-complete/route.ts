import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/env";
import { completeCardSetup } from "@/server/payments";
import { apiMember } from "@/server/session";

/** Return address of the provider's hosted card form. */
export async function GET(request: NextRequest) {
  const member = await apiMember("billing", { write: true });
  await completeCardSetup(member, request.nextUrl.searchParams.get("session_id") ?? "");
  return NextResponse.redirect(new URL("/billing?card=updated", env().APP_URL));
}
