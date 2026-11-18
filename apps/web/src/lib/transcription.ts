import { FormData } from "undici";

import { authHeaders, callProvider } from "./model-probe";

/**
 * Sending recorded speech to a provider's OpenAI-compatible `/audio/transcriptions` (D386).
 *
 * Not through agentgateway: its formats are completions, embeddings, messages, realtime,
 * rerank and responses, so a transcription has no route to take. The console calls the
 * provider itself, with the credential the connection stores, through the egress proxy —
 * the same way a connection test reaches it.
 */

/** The audio types a browser records in, with the file extension the provider reads the type from. */
export const AUDIO_TYPES: ReadonlyMap<string, string> = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "mp4"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
]);

/** A recording longer than about two minutes is cut by the browser before it gets this big. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Why a provider did not answer with text; `status` is the provider's, or 0 when it could not be reached. */
export class TranscriptionFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TranscriptionFailed";
  }
}

/**
 * The text a provider heard in one recording.
 *
 * @param input.mimeType one of `AUDIO_TYPES`, parameters such as `;codecs=opus` removed.
 * @param input.language `ar` or `en`, the language the person speaks; a hint, not a filter.
 * @returns the transcript, trimmed; empty when the recording held no speech.
 * @throws {TranscriptionFailed} when the provider refuses, cannot be reached, or answers without text.
 */
export async function transcribeAudio(input: {
  baseUrl: string;
  authType: string;
  secret: string | null;
  model: string;
  audio: Uint8Array;
  mimeType: string;
  language: "ar" | "en";
}): Promise<string> {
  const form = new FormData();
  form.append("model", input.model);
  form.append("language", input.language);
  form.append("response_format", "json");
  const extension = AUDIO_TYPES.get(input.mimeType) ?? "webm";
  form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), `speech.${extension}`);

  let reply: { status: number; body: string };
  try {
    reply = await callProvider(`${input.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: authHeaders(input.authType, input.secret),
      body: form,
      timeoutMs: 60_000,
    });
  } catch (problem) {
    throw new TranscriptionFailed(problem instanceof Error ? problem.message : "The provider could not be reached.", 0);
  }
  if (reply.status >= 400) throw new TranscriptionFailed(`${reply.status}: ${reply.body.slice(0, 200)}`, reply.status);

  try {
    const text = (JSON.parse(reply.body) as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();
  } catch {
    // Falls through: a body that is not JSON carries no transcript.
  }
  throw new TranscriptionFailed("The provider answered without a transcript.", reply.status);
}
