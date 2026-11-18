import { z } from "zod";

import { answer, bodyOf, sessionOf } from "@/features/engage/widget-http";
import { uploadForStep, WidgetRefused } from "@/features/engage/widget-session";

/** `POST /embed/v1/sessions/{id}/files`: a file for the current file step. Returns its id. */

export const instant = false;

const fileInput = z.object({ name: z.string().trim().min(1).max(200), dataUrl: z.string().min(1).max(40_000_000) });

/** Stores a data-URL file for the current file step; 201 with its id and the view, 400 when unreadable. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    const parsed = fileInput.safeParse(await bodyOf(request));
    if (!parsed.success) throw new WidgetRefused("VALIDATION_FAILED", "That file could not be read.", "تعذّرت قراءة هذا الملف.", 400);
    return uploadForStep(claims, parsed.data.name, parsed.data.dataUrl);
  }, 201);
}
