import { z } from "zod";

import { MODEL_KINDS, PROVIDER_AUTH_TYPES, ROUTE_KINDS, VOICE_MODES } from "@/db/schema/enums";
import { MAX_CONTEXT_WINDOW, NATIVE_CLOUD_PROVIDERS } from "./types";

/** Requirement 32: the model-provider and route action inputs. */

export const setProviderActiveInput = z.object({ providerId: z.uuid(), active: z.boolean() });

export const providerIdInput = z.object({ providerId: z.uuid() });

export const saveConnectionInput = z.object({
  providerId: z.uuid(),
  connectionId: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  region: z.string().trim().max(80).optional(),
  baseUrl: z.string().trim().min(1).max(300),
  authType: z.enum(PROVIDER_AUTH_TYPES),
  /** Specification section 9: a provider key is write-only and never read back. */
  secret: z.string().min(1).optional(),
  active: z.boolean(),
  allowedModels: z.array(z.string().trim().min(1)).default([]),
  /** What each allowed model answers at, keyed by model name. A model missing here is `Chat`. */
  modelKinds: z.record(z.string(), z.enum(MODEL_KINDS)).default({}),
  /** `UC-60.1-05`: each allowed model's context window in tokens, keyed by model name. A model
   * missing here has none recorded. */
  contextWindows: z.record(z.string(), z.number().int().min(1).max(MAX_CONTEXT_WINDOW)).default({}),
});

export const saveRouteInput = z.object({
  alias: z
    .string()
    .trim()
    .min(1)
    .max(60)
    // `params.ar` is the Arabic half of the rule, read by `inputRefusal`.
    .refine((alias) => /^[a-z0-9-]+$/.test(alias), {
      message: "Use lowercase letters, digits and hyphens.",
      params: { ar: "استخدم أحرفًا لاتينية صغيرة وأرقامًا وشرطات فقط." },
    }),
  /** The alias this route had before an edit renamed it. */
  originalAlias: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(ROUTE_KINDS).default("Standard"),
  /** `UC-60.1-03`: JSON Schema as the editor holds it; parsed and judged in the service. */
  outputSchema: z.string().max(20_000).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  voiceMode: z.enum(VOICE_MODES).optional(),
  sttModel: z.string().trim().max(120).optional(),
  ttsVoice: z.string().trim().max(120).optional(),
  languages: z.array(z.string().trim().min(2).max(10)).max(20).optional(),
  bargeIn: z.boolean().optional(),
  maxCallMinutes: z.number().int().min(1).max(600).optional(),
  // `UC-60.1-06`: a route with no chain has nothing to call.
  chain: z
    .array(z.object({ providerId: z.uuid(), connectionId: z.uuid(), modelName: z.string().min(1) }))
    .min(1),
});

/** Which route an action is about. */
export const routeAliasInput = z.object({ alias: z.string().trim().min(1).max(60) });

/** A provider agentgateway already speaks to natively, not only a self-hosted engine. */
export const addCloudProviderInput = z.object({
  name: z.string().trim().min(2).max(80),
  gatewayProvider: z.enum(NATIVE_CLOUD_PROVIDERS),
  /** Azure's resource name, Bedrock's region host, or Vertex AI's project id. Unused, and
   * optional, for every other native provider. */
  endpoint: z.string().trim().max(300).optional(),
  authType: z.enum(PROVIDER_AUTH_TYPES).default("ApiKey"),
  secret: z.string().min(1).optional(),
  models: z.array(z.string().trim().min(1)).min(1).max(200),
});

export type SaveConnectionInput = z.infer<typeof saveConnectionInput>;
export type SaveRouteInput = z.infer<typeof saveRouteInput>;
export type AddCloudProviderInput = z.infer<typeof addCloudProviderInput>;
export type TestConnectionDraftInput = z.infer<typeof testConnectionDraftInput>;

/** `UC-59.1-03`: which connection to test. */
export const connectionIdInput = z.object({ connectionId: z.uuid() });

/**
 * `UC-59.1-03`: test a connection as the editor currently holds it, before it is saved.
 *
 * `secret` is omitted, not blanked, when editing an existing connection the admin has not
 * typed a new key for — the same "leave blank to keep the stored one" rule `saveConnection`
 * holds, so a test run while editing proves the credential that would actually be used.
 */
export const testConnectionDraftInput = z.object({
  connectionId: z.uuid().optional(),
  /** The gateway's own identity for the provider (`GATEWAY_PROVIDERS`, or `Custom`). */
  provider: z.string().min(1),
  baseUrl: z.string().trim().min(1).max(300),
  authType: z.enum(PROVIDER_AUTH_TYPES),
  secret: z.string().min(1).optional(),
  models: z.array(z.object({ name: z.string().trim().min(1), kind: z.enum(MODEL_KINDS) })).min(1),
});

/** `UC-59.1-05`: what to ask an engine for its models. */
export const discoverModelsInput = z.object({
  baseUrl: z.string().trim().url().max(300),
  authType: z.enum(PROVIDER_AUTH_TYPES).default("None"),
  secret: z.string().min(1).optional(),
});

/** `UC-59.1-05`: a self-hosted engine as a provider of its own. */
export const addCustomProviderInput = z.object({
  name: z.string().trim().min(2).max(80),
  engine: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url().max(300),
  authType: z.enum(PROVIDER_AUTH_TYPES).default("None"),
  secret: z.string().min(1).optional(),
  models: z.array(z.string().trim().min(1)).min(1).max(200),
});
