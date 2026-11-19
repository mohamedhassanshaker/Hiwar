import { NextResponse } from "next/server";

import { health } from "@/lib/health";

/** Readiness and liveness for the web Deployment, and what the System screen aggregates. */
export async function GET() {
  const report = await health();
  return NextResponse.json(report);
}
