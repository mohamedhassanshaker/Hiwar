import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, schema } from "@/db";
import { can } from "@/server/authz";
import { sseResponse } from "@/server/live";
import { getSession } from "@/server/session";

/** SSE for the panel: `topic=org` for the organization, `topic=conv:<id>` for one thread of the same organization. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.org || !session.role) {
    return NextResponse.json({ error: "Your session has expired. Sign in again to continue." }, { status: 401 });
  }
  const topic = request.nextUrl.searchParams.get("topic") ?? "org";
  if (topic === "org") return sseResponse(request, [`org:${session.org.id}`]);
  const conversationId = topic.startsWith("conv:") ? topic.slice(5) : "";
  if (!can(session.role, "conversations") || !/^[0-9a-f-]{36}$/.test(conversationId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const owned = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.orgId, session.org.id)),
    columns: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return sseResponse(request, [`conv:${conversationId}`]);
}
