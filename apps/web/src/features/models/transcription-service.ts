import { logger } from "@/lib/logger";
import { untestableReason } from "@/lib/model-probe";
import { Rejected } from "@/lib/rejection";
import { AUDIO_TYPES, MAX_AUDIO_BYTES, TranscriptionFailed, transcribeAudio } from "@/lib/transcription";
import * as repository from "./repository";

/**
 * D386: spoken input for the composers of discussion rooms, the AI Assistant panel and the
 * embedded widget. A recording becomes text the person edits before sending.
 *
 * The model is the first Transcription model allowed on an active connection that the console
 * can call itself (an OpenAI-compatible provider with a header credential). Nothing is stored:
 * neither the audio nor the transcript is kept here; the transcript is kept only once it is sent.
 */

/** Refused in words the person reads, in both languages; `status` is the HTTP status to answer with. */
export class TranscriptionRefused extends Rejected {
  constructor(
    message: string,
    messageAr: string,
    readonly status: number,
  ) {
    super(message, messageAr);
    this.name = "TranscriptionRefused";
  }
}

/** The bare MIME type a browser recorded in, or null when it is not one a provider reads. */
export function audioTypeOf(contentType: string | null): string | null {
  const bare = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return AUDIO_TYPES.has(bare) ? bare : null;
}

/**
 * The text spoken in one recording.
 *
 * @param input.contentType the request's `content-type`, e.g. `audio/webm;codecs=opus`.
 * @param input.language the speaker's language, `ar` or `en`.
 * @returns the transcript; empty when nothing was said.
 * @throws {TranscriptionRefused} 400 for audio that is empty, too large or of another type;
 *   503 when no model is set up or the provider failed.
 */
export async function transcribe(input: { audio: Uint8Array; contentType: string | null; language: "ar" | "en" }): Promise<string> {
  const mimeType = audioTypeOf(input.contentType);
  if (!mimeType) throw new TranscriptionRefused("That recording is not in an audio format the platform reads.", "هذا التسجيل ليس بصيغة صوتية تقرؤها المنصة.", 400);
  if (input.audio.byteLength === 0) throw new TranscriptionRefused("The recording is empty.", "التسجيل فارغ.", 400);
  if (input.audio.byteLength > MAX_AUDIO_BYTES) {
    throw new TranscriptionRefused("The recording is too long. Speak for up to two minutes.", "التسجيل طويل جداً. تحدّث لمدة دقيقتين على الأكثر.", 400);
  }

  const target = (await repository.readTranscriptionModels()).find((one) => untestableReason(one.provider, one.authType) === null);
  if (!target) {
    throw new TranscriptionRefused(
      "Voice input is not set up: no Transcription model is allowed on a connection the platform can call. An admin adds one in Models & routes.",
      "الإدخال الصوتي غير مُعدّ: لا يوجد نموذج تفريغ صوتي مسموح به على اتصال تستطيع المنصة استدعاءه. يضيفه المسؤول في النماذج والمسارات.",
      503,
    );
  }

  const started = Date.now();
  try {
    const text = await transcribeAudio({ ...target, audio: input.audio, mimeType, language: input.language });
    // Size and time only: what was said is the person's, and is not logged.
    logger().info({ model: target.model, bytes: input.audio.byteLength, ms: Date.now() - started }, "speech.transcribed");
    return text;
  } catch (problem) {
    if (!(problem instanceof TranscriptionFailed)) throw problem;
    logger().warn({ model: target.model, status: problem.status, reason: problem.message }, "speech.transcription_failed");
    throw new TranscriptionRefused("Your speech could not be turned into text. Try again, or type instead.", "تعذّر تحويل كلامك إلى نص. حاول مرة أخرى أو اكتب بدلاً من ذلك.", 503);
  }
}
