"use client";

import { Ic } from "@/components/ui/icon";
import { useAwp } from "@/hooks/use-awp";
import { useVoiceInput } from "@/hooks/use-voice-input";

/**
 * D386: the console's microphone button, beside the attach button in a discussion room and the
 * AI Assistant panel. Press to record, press again to stop; the text arrives through `onText`.
 */

/**
 * Sends a recording to `/api/speech` in the console's language.
 *
 * @throws {Error} carrying the platform's refusal in that language.
 */
async function transcribeInConsole(audio: Blob, lang: "en" | "ar"): Promise<string> {
  const response = await fetch(`/api/speech?lang=${lang}`, { method: "POST", headers: { "content-type": audio.type }, body: audio });
  const body = (await response.json().catch(() => ({}))) as { text?: string; message?: string; messageAr?: string };
  if (!response.ok) {
    const fallback = lang === "ar" ? "تعذّر تحويل كلامك إلى نص." : "Your speech could not be turned into text.";
    throw new Error((lang === "ar" ? body.messageAr : body.message) ?? fallback);
  }
  return body.text ?? "";
}

/** The microphone button; `className` sizes it for the composer it sits in. */
export function VoiceButton({
  onText,
  onProblem,
  disabled = false,
  className = "",
}: {
  onText: (text: string) => void;
  onProblem: (message: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t, lang } = useAwp();
  const { state, toggle } = useVoiceInput({ transcribe: (audio) => transcribeInConsole(audio, lang), onText, onProblem, t });
  const label =
    state === "recording"
      ? t("Stop recording", "إيقاف التسجيل")
      : state === "transcribing"
        ? t("Turning your speech into text", "جارٍ تحويل كلامك إلى نص")
        : t("Speak your message", "تحدّث برسالتك");
  return (
    <button
      type="button"
      className={`awp-iconbtn awp-voice${state === "idle" ? "" : ` is-${state}`} ${className}`.trim()}
      disabled={disabled || state === "transcribing"}
      aria-pressed={state === "recording"}
      aria-busy={state === "transcribing"}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <Ic n="MicL" s={18} c={state === "recording" ? "var(--feedback-danger-text)" : undefined} />
    </button>
  );
}
