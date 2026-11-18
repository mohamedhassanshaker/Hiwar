"use client";

import { useEffect, useRef, useState } from "react";

/**
 * D386: speaking a message instead of typing it, in the room composer, the AI Assistant panel
 * and the embedded widget. The browser records; the caller's `transcribe` sends the recording
 * to the platform, which asks the configured Transcription model; the text lands in the
 * composer beside any attached files, to be edited and sent like typed text.
 */

export type VoiceState = "idle" | "recording" | "transcribing";

/** A recording stops itself after two minutes, which keeps it under the server's 5 MB limit. */
export const MAX_RECORDING_MS = 120_000;

/** What to record in, best first: Chromium and Firefox record WebM/Opus, Safari MP4. */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

type Options = {
  /** Sends one recording to the platform and returns its text; throws an Error whose message the person reads. */
  transcribe: (audio: Blob) => Promise<string>;
  /** The text heard, to add to the composer. */
  onText: (text: string) => void;
  /** Why nothing was added, in the person's language; `cause` is what `transcribe` threw, when it threw. */
  onProblem: (message: string, cause?: unknown) => void;
  t: (en: string, ar: string) => string;
};

/** A draft with spoken text added at its end, a space between them. */
export function withSpoken(draft: string, spoken: string): string {
  return draft.trim() ? `${draft.trimEnd()} ${spoken}` : spoken;
}

/** Why the microphone could not be opened, in words the person can act on. */
function microphoneProblem(problem: unknown, t: Options["t"]): string {
  if (problem instanceof DOMException && problem.name === "NotAllowedError") {
    return t("Allow this site to use the microphone, then try again.", "اسمح لهذا الموقع باستخدام الميكروفون ثم حاول مرة أخرى.");
  }
  return t("No microphone could be used.", "تعذّر استخدام أي ميكروفون.");
}

/**
 * The recorder behind a microphone button: `toggle` starts a recording, and stops it to have
 * it transcribed. Callbacks are read when the recording ends, so the latest ones are used.
 */
export function useVoiceInput(options: Options): { state: VoiceState; toggle: () => void } {
  const [state, setState] = useState<VoiceState>("idle");
  const latest = useRef(options);
  const recorder = useRef<MediaRecorder | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set while the browser asks for the microphone, so a second press does not open it twice.
  const opening = useRef(false);

  useEffect(() => {
    latest.current = options;
  });
  // Leaving the screen mid-recording releases the microphone.
  useEffect(
    () => () => {
      if (limit.current) clearTimeout(limit.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const finish = async (audio: Blob) => {
    const { transcribe, onText, onProblem, t } = latest.current;
    setState("transcribing");
    try {
      const text = await transcribe(audio);
      if (text) onText(text);
      else onProblem(t("No speech was heard. Try again.", "لم يُسمع أي كلام. حاول مرة أخرى."));
    } catch (problem) {
      onProblem(problem instanceof Error ? problem.message : t("Your speech could not be turned into text.", "تعذّر تحويل كلامك إلى نص."), problem);
    } finally {
      setState("idle");
    }
  };

  const start = async () => {
    const { onProblem, t } = latest.current;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onProblem(t("This browser cannot record audio.", "لا يستطيع هذا المتصفح تسجيل الصوت."));
      return;
    }
    let stream: MediaStream;
    opening.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (problem) {
      onProblem(microphoneProblem(problem, t));
      return;
    } finally {
      opening.current = false;
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (limit.current) clearTimeout(limit.current);
      recorder.current = null;
      const audio = new Blob(chunks, { type: media.mimeType || mimeType || "audio/webm" });
      if (audio.size > 0) void finish(audio);
      else setState("idle");
    };
    recorder.current = media;
    media.start();
    setState("recording");
    limit.current = setTimeout(() => media.stop(), MAX_RECORDING_MS);
  };

  const toggle = () => {
    if (state === "recording") recorder.current?.stop();
    else if (state === "idle" && !opening.current) void start();
  };

  return { state, toggle };
}
