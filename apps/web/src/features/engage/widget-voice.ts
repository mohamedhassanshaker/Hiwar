import { transcribe, TranscriptionRefused } from "@/features/models/transcription-service";
import { withinRate } from "@/lib/rate-window";
import * as repository from "./repository";
import { WidgetRefused, type SessionClaims } from "./widget-session";

/**
 * `POST /embed/v1/sessions/{id}/transcriptions` (D386): a visitor's recording, as text for the
 * composer. Only where the deployment has Voice input on; counted per visitor against the
 * deployment's own per-minute message limit, since each recording costs a provider call.
 */

/**
 * The text spoken in one recording, for the visitor's composer.
 *
 * @throws {WidgetRefused} SESSION_EXPIRED for a conversation that is not the visitor's,
 *   VALIDATION_FAILED where Voice input is off or the audio cannot be read, RATE_LIMITED past
 *   the limit, TOOL_UNAVAILABLE when no transcription model answers.
 */
export async function transcribeForVisitor(claims: SessionClaims, audio: Uint8Array, contentType: string | null): Promise<{ text: string }> {
  const conversation = await repository.readConversation(claims.conversationId);
  if (!conversation || conversation.visitorKey !== claims.visitorKey) {
    throw new WidgetRefused("SESSION_EXPIRED", "This conversation belongs to somebody else.", "هذه المحادثة تخص شخصاً آخر.", 403);
  }
  const deployment = await repository.readRunnableDeployment(conversation.deploymentCode);
  if (!deployment?.voiceInput) {
    throw new WidgetRefused("VALIDATION_FAILED", "Voice input is off for this assistant.", "الإدخال الصوتي متوقف لهذا المساعد.", 403);
  }
  if (!(await withinRate(`stt:visitor:${deployment.id}:${claims.visitorKey}`, deployment.rateLimitPerVisitor, 60))) {
    throw new WidgetRefused("RATE_LIMITED", "You are recording faster than we can listen. Please wait a moment.", "تسجّل أسرع مما يمكننا الاستماع. انتظر لحظة من فضلك.", 429, 60);
  }
  try {
    return { text: await transcribe({ audio, contentType, language: claims.lang }) };
  } catch (problem) {
    if (!(problem instanceof TranscriptionRefused)) throw problem;
    const code = problem.status === 400 ? "VALIDATION_FAILED" : "TOOL_UNAVAILABLE";
    throw new WidgetRefused(code, problem.message, problem.messageAr, problem.status);
  }
}
