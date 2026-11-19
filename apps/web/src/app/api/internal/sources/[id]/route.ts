import { NextResponse } from "next/server";

import { isAgentService } from "@/server/agent-service";
import { setStatus, statusInput } from "@/server/knowledge";

/** Status callback from the agent service, authenticated with the shared service token. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAgentService(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await setStatus(id, statusInput.parse(await request.json()));
  return NextResponse.json({ ok: true });
}
