import { NextResponse } from "next/server";

import { fireScheduled, ScheduleRejected } from "@/features/schedules/service";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/logger";

/**
 * Flow F-06: the one way a Temporal Schedule turns into work, with no session of its own.
 *
 * `ScheduleFireWorkflow` (the `maintenance` Temporal worker) calls this the moment one
 * scheduled work item's own Schedule fires, carrying nothing but `MAINTENANCE_API_TOKEN` —
 * the same bearer secret both sides read from the one `awp-app` Secret. Everything after
 * that is `fireScheduled()`, which is the identical rule "Run now" uses.
 */

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const token = env().MAINTENANCE_API_TOKEN;
  if (!token) return NextResponse.json({ error: "Scheduled firing is not configured." }, { status: 503 });

  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (given !== token) return NextResponse.json({ error: "not permitted" }, { status: 401 });

  const { id } = await params;
  try {
    const outcome = await fireScheduled(id);
    return NextResponse.json(outcome);
  } catch (problem) {
    if (problem instanceof ScheduleRejected) {
      return NextResponse.json({ error: problem.message }, { status: 404 });
    }
    logServerError("/api/maintenance/schedules/fire", problem, { scheduleId: id });
    return NextResponse.json({ error: "the firing could not be recorded" }, { status: 500 });
  }
}
