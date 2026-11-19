import { GATEWAY_PROVIDERS, MODEL_KINDS } from "@/db/schema/enums";
import type { ModelProbe } from "@/lib/model-probe";

/** Model providers, connections and routes (S-59, S-60). */

/** The largest context window a model can be given: ten million tokens, above any model offered today. */
export const MAX_CONTEXT_WINDOW = 10_000_000;

export type ProviderConnection = {
  id: string;
  n: string;
  ep: string;
  /** ApiKey, EntraId, IamRole, BearerToken, OAuth or None. */
  auth: string;
  region: string;
  on: boolean;
  allow: string[];
  /**
   * The allowed models that carry audio, which is what a realtime voice route may use
   * (`UC-60.1-05`). A text-only model in a speech-to-speech route cannot serve a call.
   */
  realtime: string[];
  /**
   * What each allowed model answers at, keyed by model name (`MODEL_KINDS`). A model with no
   * entry is `Chat`, the wire format every OpenAI-compatible server speaks by default.
   */
  kinds: Record<string, string>;
  /**
   * `UC-60.1-05`: each allowed model's context window in tokens, keyed by model name. A model
   * with no entry has none recorded, and nothing can be said about what fits in it.
   */
  windows: Record<string, number>;
  st: ConnectionHealth;
  /** When the saved connection was last tested, or null when it never has been. */
  checkedAt: string | null;
  /** Each allowed model's result in that test. */
  lastTest: ModelProbe[];
};

/**
 * What a connection's last test found. `Disabled` when it is switched off, `NotChecked` until
 * a test of the saved connection has run, then `Healthy` when every model answered and
 * `Failed` when any did not.
 */
export type ConnectionHealth = "Disabled" | "NotChecked" | "Healthy" | "Failed";

/** The tag each health reads as: tone, English, Arabic. */
export const CONNECTION_HEALTH: Record<ConnectionHealth, [tone: string, en: string, ar: string]> = {
  Disabled: ["neutral", "Disabled", "معطّل"],
  NotChecked: ["neutral", "Not checked", "لم يُفحص"],
  Healthy: ["success", "Healthy", "سليم"],
  Failed: ["danger", "Failed", "فشل"],
};

/** A connection's health from its switch and its stored test. */
export function connectionHealth(on: boolean, lastTest: ModelProbe[] | null): ConnectionHealth {
  if (!on) return "Disabled";
  // A model the console cannot test says nothing either way.
  const tested = (lastTest ?? []).filter((one) => !one.untestable);
  if (tested.length === 0) return "NotChecked";
  return tested.every((one) => one.ok) ? "Healthy" : "Failed";
}

/**
 * A provider card's one tag: `Disabled` when the provider or every connection is off,
 * otherwise the worst of its live connections, with `Failed` above `NotChecked`.
 */
export function providerHealth(provider: Pick<Provider, "on" | "conns">): ConnectionHealth {
  const live = provider.on ? provider.conns.filter((connection) => connection.on) : [];
  if (live.length === 0) return "Disabled";
  if (live.some((connection) => connection.st === "Failed")) return "Failed";
  if (live.some((connection) => connection.st === "NotChecked")) return "NotChecked";
  return "Healthy";
}

export type Provider = {
  id: string;
  n: string;
  /** The avatar letter, taken from the name. */
  ini: string;
  /** The chart colour the card uses, assigned by position. */
  c: string;
  kind: string;
  engine?: string;
  on: boolean;
  /** Every model any of its connections allows. */
  models: string[];
  conns: ProviderConnection[];
};

/** `[provider id, connection id, model]` */
export type RouteStep = [string, string, string];

export type ModelRoute = {
  a: string;
  use: [string, string];
  /** Standard, Typesafe or Voice — what the editor opens on and what the gateway serves. */
  kind: string;
  schema?: string;
  voice?: string;
  /** `UC-60.1-03`: the contract a typesafe route holds its answers to. */
  typesafe?: { schema: string; threshold: number | null; retries: number | null };
  /** `UC-60.1-04` and `-05`: how a voice route is put together. */
  voiceSettings?: {
    mode: string;
    stt: string;
    tts: string;
    languages: string[];
    bargeIn: boolean;
    maxCallMinutes: number | null;
  };
  chain: RouteStep[];
  agents: number;
};

/** The self-hosted engines a custom provider can speak to (stack specification section 6).
 * Each URL is the engine's OpenAI-compatible base, which the probe and the gateway append
 * `/models` and `/chat/completions` to; Ollama and TGI serve that API under `/v1`. */
export const ENGINES: [string, string][] = [
  ["Ollama", "http://localhost:11434/v1"],
  ["vLLM", "http://host:8000/v1"],
  ["LM Studio", "http://localhost:1234/v1"],
  ["Hugging Face TGI", "http://host:8080/v1"],
  ["llama.cpp server", "http://host:8080/v1"],
  ["LocalAI", "http://host:8080/v1"],
  ["NVIDIA Triton / NIM", "http://host:8000/v1"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["OpenAI-compatible (other)", "https://"],
];

/** The database's engine identity for each self-hosted choice (`MODEL_ENGINES`). An engine
 * that is an aggregator over many vendors' models — OpenRouter chief among them — still
 * speaks the OpenAI wire format, which is what makes it offerable here at all; it is not a
 * native agentgateway provider identity the way Anthropic or Bedrock is. */
export const ENGINE_VALUES: Record<string, string> = {
  Ollama: "Ollama",
  vLLM: "VLlm",
  "LM Studio": "LmStudio",
  "Hugging Face TGI": "Tgi",
  "llama.cpp server": "LlamaCpp",
  LocalAI: "LocalAi",
  "NVIDIA Triton / NIM": "TritonNim",
  OpenRouter: "OpenAiCompatible",
  "OpenAI-compatible (other)": "OpenAiCompatible",
};

/** The name a person reads for each stored engine; `OpenAiCompatible` is the general one. */
export const ENGINE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ENGINE_VALUES)
    .filter(([label]) => label !== "OpenRouter")
    .map(([label, value]) => [value, label]),
);

/** Display names for the providers agentgateway has native support for. */
const CLOUD_PROVIDER_NAMES: Partial<Record<(typeof GATEWAY_PROVIDERS)[number], string>> = {
  OpenAI: "OpenAI",
  Anthropic: "Anthropic",
  Azure: "Azure OpenAI",
  Bedrock: "AWS Bedrock",
  Gemini: "Google Gemini",
  VertexAI: "Google Vertex AI",
  Mistral: "Mistral AI",
  Cohere: "Cohere",
  Groq: "Groq",
  Deepseek: "DeepSeek",
};

/**
 * The cloud providers this install has already proven agentgateway speaks to natively —
 * the ones the demo seed configures with no base URL at all (`db/seed/models.ts`'s own
 * `GATEWAY` map), plus the three `render.ts` has dedicated handling for (Azure, Bedrock,
 * Vertex AI). `GATEWAY_PROVIDERS` names several more aggregators and smaller platforms, but
 * nothing in this codebase confirms agentgateway's adapter for them is wired correctly, and
 * for at least one — OpenRouter — the seed itself proves the opposite: it is an
 * OpenAI-compatible aggregator, not a distinct wire protocol, so it belongs with the
 * self-hosted engines above instead, where a base URL and a working "Test" button exist.
 */
export const NATIVE_CLOUD_PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Azure",
  "Bedrock",
  "Gemini",
  "VertexAI",
  "Mistral",
  "Cohere",
  "Groq",
  "Deepseek",
] as const satisfies readonly (typeof GATEWAY_PROVIDERS)[number][];

export const CLOUD_PROVIDERS: [gatewayProvider: string, displayName: string][] = NATIVE_CLOUD_PROVIDERS.map(
  (provider) => [provider, CLOUD_PROVIDER_NAMES[provider] ?? provider],
);

/**
 * The providers whose connection needs a special-shaped endpoint instead of a plain base
 * URL — Azure derives its host from a resource name, Bedrock from a region, Vertex AI names
 * a project directly (`render.ts`'s `providerBlock`). Every other native provider needs none.
 */
export const CLOUD_PROVIDER_ENDPOINT: Record<string, { label: string; labelAr: string; placeholder: string }> = {
  Azure: { label: "Resource name", labelAr: "اسم المورد", placeholder: "hiwar-uaen.openai.azure.com" },
  Bedrock: { label: "Region host", labelAr: "مضيف المنطقة", placeholder: "bedrock-runtime.me-central-1" },
  VertexAI: { label: "Project ID", labelAr: "معرّف المشروع", placeholder: "my-gcp-project" },
};

/** `MODEL_KINDS`, as the "Allowed models" select offers them. */
export const MODEL_KIND_LABELS: Record<(typeof MODEL_KINDS)[number], [string, string]> = {
  Chat: ["Chat", "محادثة"],
  Embedding: ["Embedding", "تضمين"],
  Image: ["Image generation", "توليد صور"],
  Speech: ["Speech (text to audio)", "كلام (نص إلى صوت)"],
  Transcription: ["Transcription (audio to text)", "تفريغ صوتي (صوت إلى نص)"],
  Rerank: ["Rerank", "إعادة ترتيب"],
  Decision: ["Decision", "قرار"],
  Audio: ["Audio (other)", "صوت (أخرى)"],
  Video: ["Video", "فيديو"],
};

/** How a connection authenticates, as the console writes it. */
export const PROVIDER_AUTH: Record<string, [string, string]> = {
  ApiKey: ["API key", "مفتاح API"],
  EntraId: ["Entra ID", "Entra ID"],
  IamRole: ["IAM role", "دور IAM"],
  BearerToken: ["Bearer token", "رمز حامل"],
  OAuth: ["OAuth 2.1", "OAuth 2.1"],
  None: ["None", "بدون"],
};
