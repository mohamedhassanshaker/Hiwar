import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { handle, Refused } from "@/server/api";
import { sseResponse } from "@/server/live";
import { aiTurn, cancelRequest, currentConversation, requestPerson, visitorMessage } from "@/server/visitor";
import { confirmTool, saveContact, saveFeedback, widgetContext, widgetState } from "@/server/widget";

/**
 * The widget's API (DEP-003). The frame is served from this origin, so these calls are
 * same-origin; the deployment key and the visitor token identify the conversation.
 */

const base = z.object({ key: z.string().min(8).max(80), token: z.string().min(16).max(80) });
const visitorInfo = z.object({
  language: z.enum(["en", "ar"]),
  page: z.string().max(500).optional(),
  device: z.string().max(80).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  timezone: z.string().max(60).optional(),
});

export const GET = handle(async (request: NextRequest, { params }: { params: Promise<{ action: string }> }) => {
  const { action } = await params;
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (action === "state") return widgetState(key, token);
  if (action === "live") {
    const { deployment } = await widgetContext(key);
    const c = token ? await currentConversation(deployment, token) : null;
    return sseResponse(request, [`dep:${deployment.id}`, ...(c ? [`conv:${c.id}`] : [])]);
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ action: string }> }) => {
  const { action } = await params;
  const body = await request.json();
  const { key, token } = base.parse(body);
  const { deployment, served } = await widgetContext(key);
  // A proxy's country header when there is one; otherwise the browser's time zone (INB-001 FR-020).
  const country = request.headers.get("cf-ipcountry") ?? request.headers.get("x-vercel-ip-country") ?? undefined;
  const withCountry = <T extends { timezone?: string }>(v: T) => ({ ...v, timezone: undefined, country: country ?? (v.timezone ? `${v.timezone} time zone` : undefined) });

  switch (action) {
    case "message": {
      if (deployment.status !== "live" || !served) throw new Refused("The assistant is offline.", 409);
      const input = z.object({ text: z.string().min(1).max(4000), visitor: visitorInfo }).parse(body);
      const result = await visitorMessage({ deployment, token, text: input.text, visitor: { ...withCountry(input.visitor), email: input.visitor.email || undefined } });
      if (result.runAi) after(() => aiTurn(result.conversationId));
      return { ok: true };
    }
    case "person": {
      const input = z.object({ visitor: visitorInfo }).parse(body);
      let c = await currentConversation(deployment, token);
      if (!c || c.state === "CLOSED") {
        await visitorMessage({ deployment, token, text: input.visitor.language === "ar" ? "أريد التحدث مع شخص" : "I would like to talk to a person", visitor: { ...withCountry(input.visitor), email: input.visitor.email || undefined } });
        c = await currentConversation(deployment, token);
      }
      if (c) await requestPerson(c.id, "visitor_request", "Visitor asked for a person. Reason code: visitor_request. Staff notified.");
      return { ok: true };
    }
    case "cancel": {
      const c = await currentConversation(deployment, token);
      if (c) await cancelRequest(c);
      return { ok: true };
    }
    case "contact": {
      const input = z
        .object({ language: z.enum(["en", "ar"]), name: z.string().trim().max(120).optional(), email: z.string().trim().email("Enter a valid email address."), phone: z.string().trim().max(40).optional(), message: z.string().trim().max(2000).optional() })
        .parse(body);
      await saveContact(key, token, input, input.language);
      return { ok: true };
    }
    case "feedback": {
      const input = z.object({ answer: z.enum(["yes", "no"]) }).parse(body);
      await saveFeedback(key, token, input.answer);
      return { ok: true };
    }
    case "confirm": {
      const input = z.object({ toolCallId: z.string().uuid(), confirm: z.boolean() }).parse(body);
      await confirmTool(key, token, input.toolCallId, input.confirm);
      return { ok: true };
    }
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
});
