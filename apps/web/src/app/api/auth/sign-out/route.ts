import { NextResponse } from "next/server";

import { env } from "@/server/env";
import { endSession } from "@/server/session";

/** ORG-004 FR-010: Sign out ends the session and opens the public Home. */
export async function POST() {
  await endSession();
  return NextResponse.redirect(new URL("/", env().APP_URL), 303);
}
