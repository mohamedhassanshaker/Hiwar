import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { feedback, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/feedback`: thumbs on one message, or the rating at the end. */

export const instant = false;

const feedbackInput = z.object({
  messageId: z.string().max(32).optional(),
  value: z.enum(["up", "down"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

/** Records a thumbs value or a 1 to 5 rating for the token's conversation and answers with the view. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = feedbackInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("VALIDATION_FAILED", "That feedback could not be read.", "تعذّرت قراءة هذا التقييم.", 400);
    return feedback(claims, parsed.data);
  });
}
