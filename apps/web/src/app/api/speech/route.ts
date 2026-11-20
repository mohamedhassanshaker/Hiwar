import { transcribe, TranscriptionRefused } from "@/features/models/transcription-service";
import { withinRate } from "@/lib/rate-window";
import { getSession } from "@/lib/session";
import { MAX_AUDIO_BYTES } from "@/lib/transcription";

/**
 * D386: a signed-in person's recording, from a discussion room or the AI Assistant panel, as
 * text for their composer. The body is the raw recording (`audio/*`); `?lang=ar|en` is the
 * language spoken. Answers `{ text }`, or `{ message, messageAr }` with the refusal's status.
 *
 * Any signed-in person may dictate: the text goes nowhere until they send it, and sending is
 * checked where it lands. Thirty recordings a minute per person keep a stuck client from
 * running up provider cost.
 */

const PER_MINUTE = 30;

/** A refusal the composer shows as it is, in both languages. */
function refused(status: number, message: string, messageAr: string): Response {
  return Response.json({ message, messageAr }, { status, headers: { "cache-control": "no-store" } });
}

/** Transcribes one recording; 401 without a session, 400 for unreadable audio, 429 past the limit, 503 when no model answers. */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return refused(401, "Sign in again to use voice input.", "سجّل الدخول مجدداً لاستخدام الإدخال الصوتي.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) {
    return refused(400, "The recording is too long. Speak for up to two minutes.", "التسجيل طويل جداً. تحدّث لمدة دقيقتين على الأكثر.");
  }
  if (!(await withinRate(`stt:person:${session.personId}`, PER_MINUTE, 60))) {
    return refused(429, "You are recording faster than we can listen. Please wait a moment.", "تسجّل أسرع مما يمكننا الاستماع. انتظر لحظة من فضلك.");
  }

  const language = new URL(request.url).searchParams.get("lang") === "ar" ? "ar" : "en";
  try {
    const text = await transcribe({ audio: new Uint8Array(await request.arrayBuffer()), contentType: request.headers.get("content-type"), language });
    return Response.json({ text }, { headers: { "cache-control": "no-store" } });
  } catch (problem) {
    if (problem instanceof TranscriptionRefused) return refused(problem.status, problem.message, problem.messageAr);
    throw problem;
  }
}
