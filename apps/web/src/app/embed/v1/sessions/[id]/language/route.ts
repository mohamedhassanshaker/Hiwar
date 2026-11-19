import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { setLanguage, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/language`: the widget's language for the rest of the session. */

export const instant = false;

const languageInput = z.object({ lang: z.enum(["en", "ar"]) });

/** Sets the session's language to `en` or `ar` and answers with the view; 400 for anything else. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = languageInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("BAD_REQUEST", "Choose English or Arabic.", "اختر الإنجليزية أو العربية.", 400);
    return setLanguage(claims, parsed.data.lang);
  });
}
