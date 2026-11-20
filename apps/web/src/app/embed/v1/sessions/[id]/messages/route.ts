import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { sendMessage, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/messages`: text the visitor typed (widget specification 14). */

// The 4000-character limit is `sendMessage`'s rule, applied to the trimmed text, so it answers
// `VALIDATION_FAILED` with the reason; a length cap here would pre-empt it with `BAD_REQUEST`.
const messageInput = z.object({
  text: z.string(),
  clientMessageId: z.string().trim().max(64).nullable().default(null),
});

/**
 * Takes a visitor's text, up to 4000 characters, as the conversation's next turn and answers with
 * the view. A repeated `clientMessageId` is taken once.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = messageInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "The request could not be read.", "تعذّرت قراءة الطلب.", 400);
    return sendMessage(claims, parsed.data.text, parsed.data.clientMessageId);
  });
}
