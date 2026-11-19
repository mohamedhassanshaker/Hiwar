import { answer, sessionOf } from "@/features/engage/widget-http";
import { transcribeForVisitor } from "@/features/engage/widget-voice";
import { WidgetRefused } from "@/features/engage/widget-session";
import { MAX_AUDIO_BYTES } from "@/lib/transcription";

/** `POST /embed/v1/sessions/{id}/transcriptions`: the raw recording as the body (`audio/*`); `{ text }` back (D386). */

export const instant = false;

/** Turns a visitor's recording into text for the composer; 400 for unreadable audio, 403 where Voice input is off. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return answer(async () => {
    const claims = await sessionOf(request, id);
    // Refused before the body is read, when the sender says it is too large.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) {
      throw new WidgetRefused("VALIDATION_FAILED", "The recording is too long. Speak for up to two minutes.", "التسجيل طويل جداً. تحدّث لمدة دقيقتين على الأكثر.", 400);
    }
    const audio = new Uint8Array(await request.arrayBuffer());
    return transcribeForVisitor(claims, audio, request.headers.get("content-type"));
  });
}
