import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { CLIENT_EVENTS, clientEvent, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/events`: what the widget itself sees (widget specification 15). */

export const instant = false;

const eventInput = z.object({ name: z.enum(CLIENT_EVENTS), props: z.record(z.string(), z.unknown()).default({}) });

/** Records one widget event for the token's conversation; 204, or 400 for an unknown event name. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = eventInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "That event could not be read.", "تعذّرت قراءة هذا الحدث.", 400);
    await clientEvent(claims, parsed.data.name, parsed.data.props);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
