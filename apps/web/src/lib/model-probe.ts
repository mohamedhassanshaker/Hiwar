import { FormData, fetch as proxiedFetch } from "undici";

import { DECISIONS_PATH } from "@/db/schema/enums";
import { egressDispatcher } from "./egress";

/**
 * Calling a model provider where it lives, to prove a connection works (`UC-59.1-03`).
 *
 * This is deliberately not a call through agentgateway. The gateway serves *routes*, and a
 * connection that no route uses yet is exactly the one an admin needs to test before they
 * build a route on it. So the console calls the provider itself, with the credential it
 * stored, through the one workload allowed out of the cluster.
 *
 * What it does not do is pretend. A provider whose credentials are a workload identity —
 * an IAM role, an Entra ID — has nothing here to authenticate with, because the identity
 * belongs to the gateway's pod and not to this one. That is reported as untestable rather
 * than as a pass.
 */

/** What one model answered, as the Connections drawer lists it. */
export type ModelProbe = {
  model: string;
  ok: boolean;
  /** A kind the console has no request to test with; it says nothing about the connection. */
  untestable?: true;
  /** The reason, when it failed, or the latency when it did not. */
  detail: string;
  ms: number;
};

/** The providers the console can speak to directly, by the gateway's name for them. */
const OPENAI_COMPATIBLE = new Set(["OpenAI", "Anthropic", "Custom", "Groq", "Mistral", "Together"]);

/** A bearer `authorization` header for a key, token or OAuth secret; no header for any other credential. */
export function authHeaders(authType: string, secret: string | null): Record<string, string> {
  if (!secret) return {};
  if (authType === "ApiKey" || authType === "BearerToken" || authType === "OAuth") {
    return { authorization: `Bearer ${secret}` };
  }
  return {};
}

/** The reason a connection cannot be tested from here, or null when it can. */
export function untestableReason(provider: string, authType: string): string | null {
  if (authType === "IamRole" || authType === "EntraId") {
    return "This connection authenticates as the gateway's own workload identity, which the console does not hold.";
  }
  if (!OPENAI_COMPATIBLE.has(provider)) {
    return `${provider} does not speak the OpenAI wire format, so only the gateway can call it.`;
  }
  return null;
}

/** Calls the provider through the egress proxy when one is configured, and returns its status and body text. */
export async function callProvider(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData; timeoutMs: number },
): Promise<{ status: number; body: string }> {
  const proxy = egressDispatcher();
  const response = await proxiedFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    // Omitted rather than undefined: naming the key hands undici an explicit "no
    // dispatcher" instead of letting it use the global one.
    ...(proxy ? { dispatcher: proxy } : {}),
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  return { status: response.status, body: await response.text() };
}

/** A one-sample silent WAV, computed rather than hand-encoded: just enough bytes for a
 * transcription endpoint to accept as a real audio file. */
function silentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const dataSize = 2; // one 16-bit sample, zero: silence.
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  return buffer;
}

/** What a kind cannot be probed with here, for the kinds no wire format is common enough
 * across providers to send a request against. */
const UNTESTABLE_KIND: Record<string, string> = {
  Audio: "Audio generation has no wire format common enough across providers to test directly. Save it and try it from a route instead.",
  Video: "Video generation has no wire format common enough across providers to test directly. Save it and try it from a route instead.",
};

type Probe = { untestable: string } | { url: string; headers?: Record<string, string>; body: string | FormData };

/**
 * Where to call a model and what to send it, by what kind it is.
 *
 * A decisions endpoint is not a sibling of `/chat/completions` under the connection's base
 * path — OpenRouter serves it at `/api/alpha/decisions` off the bare origin, not under
 * `/api/v1` — so it is resolved from the origin, and everything else from the base URL.
 */
function probeRequest(base: string, model: { name: string; kind: string }): Probe {
  if (model.kind in UNTESTABLE_KIND) return { untestable: UNTESTABLE_KIND[model.kind] };

  if (model.kind === "Embedding") {
    return { url: `${base}/embeddings`, body: JSON.stringify({ model: model.name, input: "ping" }) };
  }
  if (model.kind === "Image") {
    return { url: `${base}/images/generations`, body: JSON.stringify({ model: model.name, prompt: "ping", n: 1 }) };
  }
  if (model.kind === "Speech") {
    // OpenAI's own text-to-speech endpoint names a voice; "alloy" is the one every
    // OpenAI-compatible implementation that speaks this shape accepts.
    return { url: `${base}/audio/speech`, body: JSON.stringify({ model: model.name, input: "ping", voice: "alloy" }) };
  }
  if (model.kind === "Transcription") {
    const form = new FormData();
    form.append("model", model.name);
    form.append("file", new Blob([silentWav()], { type: "audio/wav" }), "ping.wav");
    // No content-type here: undici sets the multipart boundary itself from the FormData body.
    return { url: `${base}/audio/transcriptions`, body: form };
  }
  if (model.kind === "Rerank") {
    return {
      url: `${base}/rerank`,
      body: JSON.stringify({ model: model.name, query: "ping", documents: ["ping"] }),
    };
  }
  if (model.kind === "Decision") {
    return {
      url: `${new URL(base).origin}${DECISIONS_PATH}`,
      // A trivial yes/no question: enough to prove the credential and the model name without
      // claiming to know what a real caller would ask it.
      body: JSON.stringify({
        model: model.name,
        state: { ping: true },
        questions: { ping: { type: "noul", instructions: "ping" } },
      }),
    };
  }
  return {
    url: `${base}/chat/completions`,
    // One token is enough to prove the credential, the model name and the way out.
    body: JSON.stringify({ model: model.name, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
  };
}

/**
 * `UC-59.1-03` and `UC-59.1-08`: one short call per model, at the endpoint its kind answers.
 *
 * Each model is reported on its own, because a key that is right for one deployment and
 * wrong for another is a real state and "the connection failed" would hide it.
 */
export async function probeModels(input: {
  provider: string;
  baseUrl: string;
  authType: string;
  secret: string | null;
  models: { name: string; kind: string }[];
}): Promise<ModelProbe[]> {
  const base = input.baseUrl.replace(/\/$/, "");
  const auth = authHeaders(input.authType, input.secret);

  return Promise.all(
    input.models.map(async (model) => {
      const started = Date.now();
      const probe = probeRequest(base, model);
      if ("untestable" in probe) return { model: model.name, ok: false, untestable: true, detail: probe.untestable, ms: 0 };
      // JSON unless the request named its own content-type (multipart sets its own boundary).
      const headers = { ...(typeof probe.body === "string" ? { "content-type": "application/json" } : {}), ...auth, ...probe.headers };
      try {
        const { status, body: responseBody } = await callProvider(probe.url, { method: "POST", headers, body: probe.body, timeoutMs: 20_000 });
        const ms = Date.now() - started;
        if (status === 401 || status === 403) {
          return { model: model.name, ok: false, detail: `Authentication failed (${status}).`, ms };
        }
        if (status >= 400) return { model: model.name, ok: false, detail: `${status}: ${responseBody.slice(0, 200)}`, ms };
        return { model: model.name, ok: true, detail: `${ms} ms`, ms };
      } catch (problem) {
        return {
          model: model.name,
          ok: false,
          detail: problem instanceof Error ? problem.message : "The provider could not be reached.",
          ms: Date.now() - started,
        };
      }
    }),
  );
}

/**
 * `UC-59.1-05`: the models an engine says it serves.
 *
 * @throws {Error} when the engine cannot be reached or lists none, which `UC-59.1-06`
 *   turns into "enter the model names yourself".
 */
export async function discoverModels(input: {
  baseUrl: string;
  authType: string;
  secret: string | null;
}): Promise<string[]> {
  const base = input.baseUrl.replace(/\/$/, "");
  const url = `${base}/models`;
  const { status, body } = await callProvider(url, {
    method: "GET",
    headers: authHeaders(input.authType, input.secret),
    timeoutMs: 20_000,
  });
  if (status >= 400) throw new Error(`The engine answered ${status} at ${url}.`);

  const parsed = JSON.parse(body || "{}") as { data?: { id?: string }[] };
  const models = (parsed.data ?? []).map((item) => item.id).filter((id): id is string => !!id);
  if (models.length === 0) throw new Error("The engine listed no models.");
  return models;
}
