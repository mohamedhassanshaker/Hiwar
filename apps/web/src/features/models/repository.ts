import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { connectionSecretKey, connectionSecretName } from "@/agentgateway/secrets";
import { db, dbRo, schema as s } from "@/db/client";
import { decrypt, encrypt } from "@/lib/crypto";
import type { ModelProbe } from "@/lib/model-probe";
import { ENGINE_LABELS, connectionHealth, type ModelRoute, type Provider, type ProviderConnection, type RouteStep } from "./types";

/** The only module in `models` that touches Drizzle. */

/** The six chart colours the provider cards cycle through. */
const COLOURS = [
  "var(--chart-series-5)",
  "var(--chart-series-6)",
  "var(--chart-series-1)",
  "var(--chart-series-4)",
  "var(--chart-series-3)",
  "var(--chart-series-2)",
];

/**
 * Every provider in creation order, with its card initial and colour, engine label, the models
 * its connections allow, and each connection's allowed models, kinds and health from its last test.
 */
export async function listProviders(): Promise<Provider[]> {
  const providers = await dbRo()
    .select({
      id: s.modelProvider.id,
      n: s.modelProvider.nameEn,
      kind: s.modelProvider.kind,
      engine: s.modelProvider.engine,
      on: s.modelProvider.isActive,
    })
    .from(s.modelProvider)
    .orderBy(asc(s.modelProvider.createdAt), asc(s.modelProvider.nameEn));

  const ids = providers.map((provider) => provider.id);
  const connections = ids.length
    ? await dbRo()
        .select({
          id: s.providerConnection.id,
          providerId: s.providerConnection.providerId,
          n: s.providerConnection.name,
          ep: s.providerConnection.baseUrl,
          auth: s.providerConnection.authType,
          region: s.providerConnection.region,
          on: s.providerConnection.isActive,
          lastTestAt: s.providerConnection.lastTestAt,
          lastTestResultJson: s.providerConnection.lastTestResultJson,
        })
        .from(s.providerConnection)
        .where(inArray(s.providerConnection.providerId, ids))
        .orderBy(asc(s.providerConnection.name))
    : [];

  const allowed = connections.length
    ? await dbRo()
        .select({
          connectionId: s.connectionAllowedModel.connectionId,
          modelName: s.connectionAllowedModel.modelName,
          modalities: s.connectionAllowedModel.modalities,
          kind: s.connectionAllowedModel.kind,
          contextWindow: s.connectionAllowedModel.contextWindow,
        })
        .from(s.connectionAllowedModel)
        .where(inArray(s.connectionAllowedModel.connectionId, connections.map((connection) => connection.id)))
        .orderBy(asc(s.connectionAllowedModel.modelName))
    : [];

  return providers.map((provider, index) => {
    const conns: ProviderConnection[] = connections
      .filter((connection) => connection.providerId === provider.id)
      .map((connection) => {
        const stored = connection.lastTestResultJson as { results?: ModelProbe[] } | null;
        const lastTest = stored ? (stored.results ?? []) : null;
        return {
          id: connection.id,
          n: connection.n,
          ep: connection.ep ?? "",
          auth: connection.auth,
          region: connection.region ?? "",
          on: connection.on,
          allow: allowed.filter((model) => model.connectionId === connection.id).map((model) => model.modelName),
          realtime: allowed
            .filter((model) => model.connectionId === connection.id && model.modalities.includes("audio"))
            .map((model) => model.modelName),
          kinds: Object.fromEntries(
            allowed
              .filter((model) => model.connectionId === connection.id && model.kind !== "Chat")
              .map((model) => [model.modelName, model.kind]),
          ),
          windows: Object.fromEntries(
            allowed
              .filter((model) => model.connectionId === connection.id && model.contextWindow !== null)
              .map((model) => [model.modelName, model.contextWindow as number]),
          ),
          st: connectionHealth(connection.on, lastTest),
          checkedAt: connection.lastTestAt?.toISOString() ?? null,
          lastTest: lastTest ?? [],
        };
      });
    return {
      id: provider.id,
      n: provider.n,
      ini: provider.n.charAt(0).toUpperCase(),
      c: COLOURS[index % COLOURS.length],
      kind: provider.kind,
      engine: provider.engine ? (ENGINE_LABELS[provider.engine] ?? provider.engine) : undefined,
      on: provider.on,
      models: [...new Set(conns.flatMap((connection) => connection.allow))].sort(),
      conns,
    };
  });
}

const routeAgents = sql<number>`(
  select count(*) from ai.agent_version av
  where av.primary_route_id = ${s.route.id} and av.is_active
)::int`;

/**
 * Every route by alias, with its use label, typed or voice settings, its step chain and how many
 * active agent versions use it.
 */
export async function listRoutes(): Promise<ModelRoute[]> {
  const routes = await dbRo()
    .select({
      id: s.route.id,
      a: s.route.alias,
      kind: s.route.kind,
      schema: s.route.outputSchemaJson,
      threshold: s.route.confidenceThreshold,
      retries: s.route.maxRetriesOnInvalid,
      voiceMode: s.route.voiceMode,
      sttModel: s.route.sttModel,
      ttsVoice: s.route.ttsVoice,
      languages: s.route.languages,
      bargeIn: s.route.bargeIn,
      maxCallMinutes: s.route.maxCallMinutes,
      agents: routeAgents,
    })
    .from(s.route)
    .orderBy(asc(s.route.alias));

  const steps = routes.length
    ? await dbRo()
        .select({
          routeId: s.routeStep.routeId,
          providerId: s.routeStep.providerId,
          connectionId: s.routeStep.connectionId,
          modelName: s.routeStep.modelName,
          sortOrder: s.routeStep.sortOrder,
        })
        .from(s.routeStep)
        .where(inArray(s.routeStep.routeId, routes.map((route) => route.id)))
        .orderBy(asc(s.routeStep.sortOrder))
    : [];

  return routes.map((route) => {
    const schema = (route.schema ?? {}) as { title?: string };
    // The use label comes from the kind, then from the well-known seeded aliases.
    const use: [string, string] =
      route.kind === "Typesafe"
        ? ["Classification (typed output)", "التصنيف (مخرجات مضبوطة النوع)"]
        : route.kind === "Voice"
          ? ["Voice (speech-to-speech)", "الصوت (كلام إلى كلام)"]
          : route.kind === "Embedding"
            ? ["Embedding", "تضمين"]
            : route.a === "vision"
              ? ["Auxiliary", "مساعد"]
              : route.a === "local-private"
                ? ["Restricted data", "بيانات مقيدة"]
                : route.a === "small-fast"
                  ? ["Main (interactive)", "رئيسي (تفاعلي)"]
                  : ["Main", "رئيسي"];
    return {
      a: route.a,
      use,
      kind: route.kind,
      schema: schema.title,
      typesafe:
        route.kind === "Typesafe"
          ? {
              schema: JSON.stringify(route.schema ?? {}, null, 2),
              threshold: route.threshold,
              retries: route.retries,
            }
          : undefined,
      voiceSettings:
        route.kind === "Voice"
          ? {
              mode: route.voiceMode ?? "Pipeline",
              stt: route.sttModel ?? "",
              tts: route.ttsVoice ?? "",
              languages: route.languages ?? [],
              bargeIn: route.bargeIn ?? false,
              maxCallMinutes: route.maxCallMinutes,
            }
          : undefined,
      voice:
        route.voiceMode === null
          ? undefined
          : `STT ${route.sttModel} · TTS ${route.ttsVoice} · ${(route.languages ?? []).map((language) => language.toUpperCase()).join("/")}`,
      chain: steps
        .filter((step) => step.routeId === route.id)
        .map<RouteStep>((step) => [step.providerId ?? "", step.connectionId ?? "", step.modelName]),
      agents: route.agents,
    };
  });
}

/** Switches a provider on or off. */
export async function setProviderActive(providerId: string, active: boolean, personId: string): Promise<void> {
  await db().update(s.modelProvider).set({ isActive: active, updatedAt: new Date(), updatedBy: personId }).where(eq(s.modelProvider.id, providerId));
}

/**
 * Saves a provider connection. The secret is sealed with the app KEK before it is stored
 * and is never read back (specification section 9, Secrets); the caller is responsible for
 * also putting the plaintext in the Kubernetes Secret agentgateway reads, with the id this
 * returns.
 */
export async function saveConnection(
  input: {
    providerId: string;
    connectionId?: string;
    name: string;
    region?: string;
    baseUrl: string;
    authType: string;
    secret?: string;
    active: boolean;
    allowedModels: string[];
    /** What each allow-listed model answers at, keyed by model name. A model missing here is
     * `Chat`. */
    modelKinds?: Record<string, string>;
    /** Each allow-listed model's context window in tokens, keyed by model name. A model
     * missing here has none recorded. */
    contextWindows?: Record<string, number>;
  },
  personId: string,
): Promise<string> {
  return await db().transaction(async (tx) => {
    const values = {
      providerId: input.providerId,
      name: input.name,
      region: input.region ?? null,
      baseUrl: input.baseUrl,
      authType: input.authType,
      isActive: input.active,
      ...(input.secret ? { secretRef: encrypt(input.secret) } : {}),
      updatedAt: new Date(),
      updatedBy: personId,
    };
    const connectionId = input.connectionId
      ? // An edited connection is not the one its last test was of, so it reads Not checked again.
        (await tx.update(s.providerConnection).set({ ...values, lastTestAt: null, lastTestResultJson: null }).where(eq(s.providerConnection.id, input.connectionId)).returning({ id: s.providerConnection.id }))[0].id
      : (await tx.insert(s.providerConnection).values({ ...values, createdBy: personId }).returning({ id: s.providerConnection.id }))[0].id;

    await tx.delete(s.connectionAllowedModel).where(eq(s.connectionAllowedModel.connectionId, connectionId));
    if (input.allowedModels.length > 0) {
      const modelKinds = input.modelKinds ?? {};
      const contextWindows = input.contextWindows ?? {};
      await tx.insert(s.connectionAllowedModel).values(
        input.allowedModels.map((modelName) => ({
          connectionId,
          modelName,
          modalities: ["text"],
          kind: modelKinds[modelName] ?? "Chat",
          contextWindow: contextWindows[modelName] ?? null,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }
    return connectionId;
  });
}

/**
 * Requirement 46: the route list is what agentgateway is configured from, so saving a
 * route replaces its whole fallback chain in one transaction.
 */
export async function saveRoute(
  input: {
    alias: string;
    originalAlias?: string;
    kind: string;
    outputSchema?: Record<string, unknown> | null;
    confidenceThreshold?: number | null;
    maxRetries?: number | null;
    voiceMode?: string | null;
    sttModel?: string | null;
    ttsVoice?: string | null;
    languages?: string[] | null;
    bargeIn?: boolean | null;
    maxCallMinutes?: number | null;
    chain: { providerId: string; connectionId: string; modelName: string }[];
  },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    const settings = {
      alias: input.alias,
      kind: input.kind,
      // A route that is no longer typesafe or no longer voice keeps no settings from what
      // it was: a stale schema on a Standard route is a contract nothing enforces.
      outputSchemaJson: input.kind === "Typesafe" ? (input.outputSchema ?? null) : null,
      confidenceThreshold: input.kind === "Typesafe" ? (input.confidenceThreshold ?? null) : null,
      maxRetriesOnInvalid: input.kind === "Typesafe" ? (input.maxRetries ?? null) : null,
      voiceMode: input.kind === "Voice" ? (input.voiceMode ?? null) : null,
      sttModel: input.kind === "Voice" ? (input.sttModel ?? null) : null,
      ttsVoice: input.kind === "Voice" ? (input.ttsVoice ?? null) : null,
      languages: input.kind === "Voice" ? (input.languages ?? null) : null,
      bargeIn: input.kind === "Voice" ? (input.bargeIn ?? null) : null,
      maxCallMinutes: input.kind === "Voice" ? (input.maxCallMinutes ?? null) : null,
      updatedAt: new Date(),
      updatedBy: personId,
    };

    const [existing] = await tx
      .select({ id: s.route.id })
      .from(s.route)
      .where(eq(s.route.alias, input.originalAlias ?? input.alias))
      .limit(1);
    const routeId = existing
      ? existing.id
      : (
          await tx
            .insert(s.route)
            .values({ ...settings, createdBy: personId })
            .returning({ id: s.route.id })
        )[0].id;
    if (existing) await tx.update(s.route).set(settings).where(eq(s.route.id, routeId));

    await tx.delete(s.routeStep).where(eq(s.routeStep.routeId, routeId));
    await tx.insert(s.routeStep).values(
      input.chain.map((step, index) => ({
        routeId,
        sortOrder: index,
        providerId: step.providerId,
        connectionId: step.connectionId,
        modelName: step.modelName,
        createdBy: personId,
        updatedBy: personId,
      })),
    );
    await tx
      .update(s.route)
      .set({ routeVersion: sql`${s.route.routeVersion} + 1` })
      .where(eq(s.route.id, routeId));
  });
}

/** Whether an alias is already another route's. */
export async function aliasTaken(alias: string, exceptAlias?: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ alias: s.route.alias })
    .from(s.route)
    .where(eq(s.route.alias, alias))
    .limit(1);
  return !!row && row.alias !== exceptAlias;
}

/** The models one connection allows, for checking a step the console was sent. */
export async function allowedModels(connectionId: string): Promise<{ name: string; modalities: string[]; kind: string }[]> {
  const rows = await dbRo()
    .select({
      name: s.connectionAllowedModel.modelName,
      modalities: s.connectionAllowedModel.modalities,
      kind: s.connectionAllowedModel.kind,
    })
    .from(s.connectionAllowedModel)
    .where(eq(s.connectionAllowedModel.connectionId, connectionId));
  return rows;
}

/** `UC-60.1-09`: what would stop serving if this route went — agents, then collections. */
export async function routeUsers(alias: string): Promise<string[]> {
  const [route] = await dbRo().select({ id: s.route.id }).from(s.route).where(eq(s.route.alias, alias)).limit(1);
  if (!route) return [];

  // A version holds the route as primary or as fallback, and a budget can name it as the
  // cheaper route to switch to; the database refuses to delete a route any of them still
  // points at, so each is a user that has to be named instead.
  const agents = await dbRo()
    .select({ code: s.agent.code })
    .from(s.agentVersion)
    .innerJoin(s.agent, eq(s.agent.id, s.agentVersion.agentId))
    .where(or(eq(s.agentVersion.primaryRouteId, route.id), eq(s.agentVersion.fallbackRouteId, route.id)));
  const budgets = await dbRo()
    .select({ code: s.agent.code })
    .from(s.agentBudget)
    .innerJoin(s.agent, eq(s.agent.id, s.agentBudget.agentId))
    .where(eq(s.agentBudget.cheaperRouteId, route.id));

  // A collection names its routes by alias, in its models configuration.
  const collections = await dbRo()
    .select({ code: s.knowledgeCollection.collectionId })
    .from(s.knowledgeCollection)
    .where(
      sql`${s.knowledgeCollection.modelsConfigJson} ->> 'embeddingRoute' = ${alias}
        or ${s.knowledgeCollection.modelsConfigJson} ->> 'extractionRoute' = ${alias}`,
    );

  return [...new Set([...agents, ...budgets, ...collections].map((row) => row.code))].sort();
}

/** `UC-60.1-09`: remove a route and the chain behind it. */
export async function removeRoute(alias: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [route] = await tx.select({ id: s.route.id }).from(s.route).where(eq(s.route.alias, alias)).limit(1);
    if (!route) return;
    await tx.delete(s.routeStep).where(eq(s.routeStep.routeId, route.id));
    await tx.delete(s.route).where(eq(s.route.id, route.id));
  });
}

/** `UC-59.1-04`: the routes one provider is a step of, so a toggle republishes them. */
export async function routesUsingProvider(providerId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ alias: s.route.alias })
    .from(s.routeStep)
    .innerJoin(s.route, eq(s.route.id, s.routeStep.routeId))
    .where(eq(s.routeStep.providerId, providerId))
    .orderBy(asc(s.route.alias));
  return [...new Set(rows.map((row) => row.alias))];
}

/** Every alias the database holds, for reconciling the gateway against it. */
export async function listRouteAliases(): Promise<string[]> {
  const rows = await dbRo().select({ alias: s.route.alias }).from(s.route).orderBy(asc(s.route.alias));
  return rows.map((row) => row.alias);
}

/**
 * A route as the gateway renders it: its steps in order through active providers and
 * connections only, each with the Secret holding its credential. Null when no step can serve.
 * The provider key itself is never read: the gateway holds it (stack specification 6.1).
 */
export async function readRouteForGateway(alias: string): Promise<{
  alias: string;
  decision: boolean;
  steps: Array<{
    provider: string;
    baseUrl?: string;
    endpoint?: string;
    model: string;
    secretName: string;
    secretKey: string;
    authType?: string;
  }>;
} | null> {
  const rows = await dbRo()
    .select({
      alias: s.route.alias,
      kind: s.route.kind,
      order: s.routeStep.sortOrder,
      model: s.routeStep.modelName,
      connectionId: s.routeStep.connectionId,
      providerKind: s.modelProvider.kind,
      gatewayProvider: s.modelProvider.gatewayProvider,
      baseUrl: s.providerConnection.baseUrl,
      authType: s.providerConnection.authType,
    })
    .from(s.route)
    .innerJoin(s.routeStep, eq(s.routeStep.routeId, s.route.id))
    .innerJoin(s.modelProvider, eq(s.modelProvider.id, s.routeStep.providerId))
    .innerJoin(s.providerConnection, eq(s.providerConnection.id, s.routeStep.connectionId))
    // `UC-59.1-04`: a provider or connection that is off is skipped, so the chain the
    // gateway holds is the chain that can actually serve — which is what makes the route
    // fall back to its next step rather than fail on the first.
    .where(
      and(
        eq(s.route.alias, alias),
        eq(s.modelProvider.isActive, true),
        eq(s.providerConnection.isActive, true),
      ),
    )
    .orderBy(asc(s.routeStep.sortOrder));

  if (rows.length === 0) return null;
  return {
    alias: rows[0].alias,
    decision: rows[0].kind === "Decision",
    steps: rows.map((row) => ({
      provider: row.gatewayProvider,
      // A custom provider is an OpenAI-compatible URL the connection names (§7.4.8).
      baseUrl: row.providerKind === "Custom" ? (row.baseUrl ?? undefined) : undefined,
      // `base_url` is the connection's real address for every provider, and the only
      // authoritative one: the `region` column is a human label ("UAE North"), not an
      // identity. Azure reads its resource name out of this, Bedrock its region. Only a
      // custom provider also turns it into a `baseURL` override.
      endpoint: row.baseUrl ?? undefined,
      model: row.model,
      // The connection's own Secret — named by its id, not by the provider's editable
      // display name — is what `publishConnectionSecret` writes the credential into when
      // the connection is saved.
      secretName: connectionSecretName(row.connectionId ?? ""),
      secretKey: connectionSecretKey(),
      authType: row.authType,
    })),
  };
}

/**
 * One connection as a probe needs it, with its credential decrypted.
 *
 * The plaintext leaves this module only to be put in an `Authorization` header by
 * `lib/model-probe.ts`; nothing returns it to a caller or writes it to a log
 * (specification section 9, Secrets).
 */
export async function readConnectionForProbe(connectionId: string): Promise<{
  provider: string;
  baseUrl: string;
  authType: string;
  secret: string | null;
  models: { name: string; kind: string }[];
} | null> {
  const [row] = await dbRo()
    .select({
      provider: s.modelProvider.gatewayProvider,
      baseUrl: s.providerConnection.baseUrl,
      authType: s.providerConnection.authType,
      secretRef: s.providerConnection.secretRef,
    })
    .from(s.providerConnection)
    .innerJoin(s.modelProvider, eq(s.modelProvider.id, s.providerConnection.providerId))
    .where(eq(s.providerConnection.id, connectionId))
    .limit(1);
  if (!row) return null;

  const models = await dbRo()
    .select({ modelName: s.connectionAllowedModel.modelName, kind: s.connectionAllowedModel.kind })
    .from(s.connectionAllowedModel)
    .where(eq(s.connectionAllowedModel.connectionId, connectionId))
    .orderBy(asc(s.connectionAllowedModel.modelName));

  return {
    provider: row.provider,
    baseUrl: row.baseUrl ?? "",
    authType: row.authType,
    secret: row.secretRef ? decrypt(row.secretRef) : null,
    models: models.map((model) => ({ name: model.modelName, kind: model.kind })),
  };
}

/**
 * A connection's own stored credential, decrypted — what Test, inside the editor, falls back
 * to when the admin has not typed a new one (`UC-59.1-03`: a draft test against an unsaved
 * change must still prove the credential already on file).
 */
export async function storedSecret(connectionId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ secretRef: s.providerConnection.secretRef })
    .from(s.providerConnection)
    .where(eq(s.providerConnection.id, connectionId))
    .limit(1);
  return row?.secretRef ? decrypt(row.secretRef) : null;
}

/**
 * D386: every Transcription model allowed on an active connection of an active provider, with
 * the connection's credential decrypted, in a stable order (provider, connection, model).
 *
 * The plaintext leaves this module only to be put in an `Authorization` header by
 * `lib/transcription.ts`, as `readConnectionForProbe`'s does.
 */
export async function readTranscriptionModels(): Promise<{
  provider: string;
  baseUrl: string;
  authType: string;
  secret: string | null;
  model: string;
}[]> {
  const rows = await dbRo()
    .select({
      provider: s.modelProvider.gatewayProvider,
      baseUrl: s.providerConnection.baseUrl,
      authType: s.providerConnection.authType,
      secretRef: s.providerConnection.secretRef,
      model: s.connectionAllowedModel.modelName,
    })
    .from(s.connectionAllowedModel)
    .innerJoin(s.providerConnection, eq(s.providerConnection.id, s.connectionAllowedModel.connectionId))
    .innerJoin(s.modelProvider, eq(s.modelProvider.id, s.providerConnection.providerId))
    .where(and(eq(s.connectionAllowedModel.kind, "Transcription"), eq(s.providerConnection.isActive, true), eq(s.modelProvider.isActive, true)))
    .orderBy(asc(s.modelProvider.nameEn), asc(s.providerConnection.name), asc(s.connectionAllowedModel.modelName));
  return rows.map((row) => ({
    provider: row.provider,
    baseUrl: row.baseUrl ?? "",
    authType: row.authType,
    secret: row.secretRef ? decrypt(row.secretRef) : null,
    model: row.model,
  }));
}

/** The outcome of testing a saved connection, and when; what its health is read from. */
export async function recordConnectionTest(connectionId: string, results: ModelProbe[], personId: string): Promise<void> {
  await db()
    .update(s.providerConnection)
    .set({ lastTestAt: new Date(), lastTestResultJson: { results }, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.providerConnection.id, connectionId));
}

/** `UC-59.1-10`: the route aliases a connection is a step of. */
export async function routesUsingConnection(connectionId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ alias: s.route.alias })
    .from(s.routeStep)
    .innerJoin(s.route, eq(s.route.id, s.routeStep.routeId))
    .where(eq(s.routeStep.connectionId, connectionId))
    .orderBy(asc(s.route.alias));
  return [...new Set(rows.map((row) => row.alias))];
}

/** `UC-59.1-10`: remove a connection and the models allowed on it. */
export async function removeConnection(connectionId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.connectionAllowedModel).where(eq(s.connectionAllowedModel.connectionId, connectionId));
    await tx.delete(s.providerConnection).where(eq(s.providerConnection.id, connectionId));
  });
}

/** `UC-59.1-05`: a self-hosted engine as a provider of its own. */
export async function createCustomProvider(
  input: { nameEn: string; nameAr: string; engine: string },
  personId: string,
): Promise<string> {
  const [row] = await db()
    .insert(s.modelProvider)
    .values({
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      kind: "Custom",
      // Every engine the screen offers is OpenAI-compatible, which is what the gateway's
      // `Custom` provider means.
      gatewayProvider: "Custom",
      engine: input.engine,
      isActive: true,
      createdBy: personId,
      updatedBy: personId,
    })
    .returning({ id: s.modelProvider.id });
  return row.id;
}

/** A provider agentgateway already speaks to natively, without seed data. */
export async function createCloudProvider(
  input: { nameEn: string; nameAr: string; gatewayProvider: string },
  personId: string,
): Promise<string> {
  const [row] = await db()
    .insert(s.modelProvider)
    .values({
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      kind: "Cloud",
      gatewayProvider: input.gatewayProvider,
      engine: null,
      isActive: true,
      createdBy: personId,
      updatedBy: personId,
    })
    .returning({ id: s.modelProvider.id });
  return row.id;
}

/** `UC-59.1-05`: a provider and the connections and allowed models under it. */
export async function removeProvider(providerId: string): Promise<void> {
  await db().delete(s.modelProvider).where(eq(s.modelProvider.id, providerId));
}

/** Whether a provider name is already taken, so two cards cannot be told apart. */
export async function providerNameTaken(nameEn: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.modelProvider.id })
    .from(s.modelProvider)
    .where(sql`lower(${s.modelProvider.nameEn}) = lower(${nameEn})`)
    .limit(1);
  return !!row;
}
