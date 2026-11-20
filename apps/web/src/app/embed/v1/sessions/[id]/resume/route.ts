import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { resume, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/resume`: continue a saved scenario, or start over. */

const resumeInput = z.object({ choice: z.enum(["continue", "start_over"]) });

/** Continues the saved scenario or starts a new conversation, as `choice` says; answers with the view. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = resumeInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "Choose to continue or to start over.", "اختر المتابعة أو البدء من جديد.", 400);
    return resume(claims, parsed.data.choice);
  });
}
