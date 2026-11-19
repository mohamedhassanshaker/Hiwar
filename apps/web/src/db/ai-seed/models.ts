import { ENGINE_VALUES } from "@/features/models/types";
import type { Database } from "../client";
import * as s from "../schema";
import { DECISION_MODELS, PROV_SEED, ROUTES0 } from "./data/models";
import { ids } from "./ids";

/**
 * Data model section 15: model providers, their connections, the models each connection
 * allows, and the routes agentgateway is configured from.
 */

/**
 * The variable each cloud provider's credential arrives in, which is also the key the
 * gateway reads it under (`scripts/secrets-from-env.sh`).
 */
const KEY_VARIABLE: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  azure: "AZURE_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** Whether this install holds the credential a provider needs to answer at all. */
function reachable(providerCode: string): boolean {
  const variable = KEY_VARIABLE[providerCode];
  // A provider with no entry here authenticates some other way — a workload identity, or
  // nothing at all for an engine inside the cluster.
  if (!variable) return true;
  return (process.env[variable] ?? "").trim().length > 0;
}

/**
 * The demo organisation's route chains, ordered by what this install can actually reach.
 *
 * A chain is configuration an organisation sets in Models & routes, and the sensible
 * configuration differs by install. A provider whose key is absent answers 401 — a client
 * error, which is correctly *not* a reason to fail over — so a chain that leads with one is
 * dead end to end. The steps whose credentials are present lead; the local engine follows as
 * the fallback that always answers; the rest stay in the chain, last, because they are the
 * configuration an organisation with those keys would want.
 *
 * Deciding it here, from the environment the seed runs in, keeps it visible: the Models
 * screen shows the order that is really in force, rather than one that only works elsewhere.
 */
export function orderedChain<T extends [string, string, string]>(chain: T[]): T[] {
  const keyed = chain.filter(([code]) => code !== "hiwar-local" && reachable(code));
  const local = chain.filter(([code]) => code === "hiwar-local");
  const rest = chain.filter(([code]) => code !== "hiwar-local" && !reachable(code));
  return [...keyed, ...local, ...rest] as T[];
}

/**
 * What agentgateway calls each seeded provider (`GATEWAY_PROVIDERS`). A custom engine is
 * always `Custom`; this maps only the cloud ones, whose display names differ from the
 * gateway's own identities ("Azure OpenAI" is `Azure`, "AWS Bedrock" is `Bedrock`).
 */
const GATEWAY: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  azure: "Azure",
  gemini: "Gemini",
  bedrock: "Bedrock",
  mistral: "Mistral",
  cohere: "Cohere",
  groq: "Groq",
  deepseek: "Deepseek",
};

/** The prototype's connection auth words, mapped to `PROVIDER_AUTH_TYPES`. */
const AUTH: Record<string, string> = {
  "API key": "ApiKey",
  "Entra ID": "EntraId",
  "IAM role": "IamRole",
  "Bearer token": "BearerToken",
  None: "None",
};

/** The typed-output and voice settings the two special routes carry (data model section 15). */
const TYPED_SCHEMA = {
  type: "object",
  required: ["category", "confidence"],
  properties: {
    category: { type: "string", enum: ["expense", "purchase", "leave", "bug", "vendor", "other"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/**
 * Inserts the seeded providers, their connections with no stored credential, each connection's
 * allowed models (Decision for `DECISION_MODELS`, Chat otherwise), the routes, and each route's
 * steps in the order `orderedChain` gives for the credentials this environment holds.
 */
export async function seedModels(db: Database): Promise<void> {
  await db.insert(s.modelProvider).values(
    PROV_SEED.map((p) => ({
      id: ids.modelProvider(p.id),
      nameEn: p.n,
      nameAr: p.n,
      kind: p.kind,
      gatewayProvider: p.kind === "Custom" ? "Custom" : (GATEWAY[p.id] ?? "Custom"),
      engine: p.engine ? ENGINE_VALUES[p.engine] : null,
      isActive: p.on,
    })),
  );

  const connections = PROV_SEED.flatMap((p) => p.conns.map((c) => ({ provider: p, connection: c })));

  await db.insert(s.providerConnection).values(
    connections.map(({ provider, connection }) => ({
      id: ids.providerConnection(connection.id),
      providerId: ids.modelProvider(provider.id),
      name: connection.n,
      region: connection.region,
      baseUrl: connection.ep,
      authType: AUTH[connection.auth],
      secretRef: null,
      isActive: connection.on,
    })),
  );

  await db.insert(s.connectionAllowedModel).values(
    connections.flatMap(({ connection }) =>
      connection.allow.map((modelName) => ({
        id: ids.allowedModel(`${connection.id}:${modelName}`),
        connectionId: ids.providerConnection(connection.id),
        modelName,
        kind: DECISION_MODELS.includes(modelName) ? "Decision" : "Chat",
        modalities: modelName.includes("embedding") ? ["text"] : modelName.includes("realtime") ? ["text", "audio"] : ["text", "image"],
        contextWindow: modelName.includes("embedding") ? 8192 : 200000,
        priceIn: 3,
        priceOut: 15,
      })),
    ),
  );

  await db.insert(s.route).values(
    ROUTES0.map((r) => ({
      id: ids.route(r.a),
      alias: r.a,
      kind: r.schema ? "Typesafe" : r.voice ? "Voice" : r.embedding ? "Embedding" : r.decision ? "Decision" : "Standard",
      outputSchemaJson: r.schema ? { title: r.schema, ...TYPED_SCHEMA } : null,
      confidenceThreshold: r.schema ? 0.72 : null,
      maxRetriesOnInvalid: r.schema ? 2 : null,
      voiceMode: r.voice ? "Realtime" : null,
      sttModel: r.voice ? "gpt-4o-transcribe" : null,
      ttsVoice: r.voice ? "gpt-4o-mini-tts" : null,
      languages: r.voice ? ["ar", "en"] : null,
      bargeIn: r.voice ? true : null,
      maxCallMinutes: r.voice ? 15 : null,
    })),
  );

  await db.insert(s.routeStep).values(
    ROUTES0.flatMap((r) =>
      orderedChain(r.chain).map(([providerCode, connectionCode, modelName], index) => ({
        id: ids.routeStep(`${r.a}:${index}`),
        routeId: ids.route(r.a),
        sortOrder: index,
        providerId: ids.modelProvider(providerCode),
        connectionId: ids.providerConnection(connectionCode),
        modelName,
      })),
    ),
  );
}
