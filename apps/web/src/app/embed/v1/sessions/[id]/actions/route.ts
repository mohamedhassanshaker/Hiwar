import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import type { Action } from "@/features/engage/protocol";
import { sendAction, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/actions`: a chip, a button or a field (widget specification 6.4). */

export const instant = false;

const step = z.string().max(200).nullable().optional();
const actionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("postback"), payload: z.object({ text: z.string().max(4000) }), step }),
  z.object({ type: z.literal("start_scenario"), scenario: z.string().trim().min(1).max(64), step }),
  z.object({ type: z.literal("field_submit"), field: z.string().max(200), value: z.string().max(20000), step }),
  z.object({ type: z.literal("edit_field"), field: z.string().max(200), step }),
  z.object({ type: z.literal("confirm"), token: z.string().max(200).optional(), step }),
  z.object({ type: z.literal("cancel"), step }),
  z.object({ type: z.literal("handoff"), reason: z.string().max(64), step }),
  z.object({ type: z.literal("load_more"), list: z.string().max(64), page: z.number().int().min(0), step }),
  z.object({ type: z.literal("restart") }),
  z.object({ type: z.literal("back"), step }),
  z.object({ type: z.literal("main_menu"), step }),
  z.object({ type: z.literal("show_example"), field: z.string().max(200), step }),
]);

/**
 * Applies one action to the session named by the token, which must be for this conversation, and
 * answers with the new view. 400 when the action is not one of the listed shapes.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = actionInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "That action could not be read.", "تعذّرت قراءة هذا الإجراء.", 400);
    return sendAction(claims, parsed.data as Action);
  });
}
