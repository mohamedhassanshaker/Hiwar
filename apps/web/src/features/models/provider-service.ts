import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import { publishRoute } from "@/agentgateway/publish";
import { publishConnectionSecret } from "@/agentgateway/secrets";
import {
  discoverModels,
  probeModels,
  untestableReason,
  type ModelProbe,
} from "@/lib/model-probe";
import * as repository from "./repository";
import type { AddCloudProviderInput, SaveConnectionInput, TestConnectionDraftInput } from "./schema";
import { CLOUD_PROVIDER_ENDPOINT, ENGINE_VALUES } from "./types";
import { ModelsRejected } from "./errors";

/**
 * `UC-59.1-04`: turn a provider off, and take its steps out of the gateway.
 *
 * The database says the provider is off the moment this returns; the gateway has to be
 * told, or every route through it goes on calling a provider the platform has disabled.
 * Each route it was a step of is republished without that step, which is what makes the
 * route fall back instead of fail.
 */
export async function setProviderActive(providerId: string, active: boolean): Promise<void> {
  const session = await requirePermission("models:write");
  await repository.setProviderActive(providerId, active, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:write",
    objectType: "ModelProvider",
    objectId: providerId,
    detail: { active },
  });

  for (const alias of await repository.routesUsingProvider(providerId)) {
    const renderable = await repository.readRouteForGateway(alias);
    if (renderable) await publishRoute(renderable);
  }
}

/**
 * `UC-59.1-03` and `UC-59.1-08`: send a short completion to each allowed model, and store
 * the results and the time on the connection, which is what its health is read from.
 *
 * Per model, not per connection: a key that is right for one deployment and wrong for
 * another is a real state, and one verdict for the connection would hide it. An untestable
 * connection stores nothing, because no test ran.
 */
export async function testConnection(connectionId: string): Promise<{
  results: ModelProbe[];
  untestable: string | null;
}> {
  const session = await requirePermission("models:write");

  const connection = await repository.readConnectionForProbe(connectionId);
  if (!connection) throw new ModelsRejected("That connection no longer exists.", "لم يعد هذا الاتصال موجوداً.");
  // `UC-59.1-07`: nothing to test, and no route can use it either.
  if (connection.models.length === 0) {
    throw new ModelsRejected("No models are allowed on this connection, so no route can use it.", "لا نماذج مسموح بها على هذا الاتصال، فلا يمكن لأي مسار استخدامه.");
  }

  const untestable = untestableReason(connection.provider, connection.authType);
  if (untestable) return { results: [], untestable };
  const results = await probeModels(connection);
  await repository.recordConnectionTest(connectionId, results, session.personId);
  return { results, untestable: null };
}

/**
 * `UC-59.1-03`: the same test, against what the editor holds right now rather than what was
 * last saved — so a wrong endpoint or model surfaces before Save, not after. It stores
 * nothing: the result describes a configuration that may never be saved.
 */
export async function testConnectionDraft(input: TestConnectionDraftInput): Promise<{
  results: ModelProbe[];
  untestable: string | null;
}> {
  await requirePermission("models:write");

  // `UC-59.1-07`: nothing to test, and no route could use it either.
  if (input.models.length === 0) {
    throw new ModelsRejected("No models are allowed on this connection, so no route can use it.", "لا نماذج مسموح بها على هذا الاتصال، فلا يمكن لأي مسار استخدامه.");
  }

  const untestable = untestableReason(input.provider, input.authType);
  if (untestable) return { results: [], untestable };

  // A blank secret while editing means "unchanged", not "none" — the same rule saving holds.
  const secret = input.secret ?? (input.connectionId ? await repository.storedSecret(input.connectionId) : null);
  return {
    results: await probeModels({ provider: input.provider, baseUrl: input.baseUrl, authType: input.authType, secret, models: input.models }),
    untestable: null,
  };
}

/**
 * `UC-59.1-05`: ask an engine which models it serves.
 *
 * @throws {ModelsRejected} when it cannot be reached or lists none — `UC-59.1-06`, after
 *   which the admin enters the names themselves.
 */
export async function discoverEngineModels(input: {
  baseUrl: string;
  authType: string;
  secret?: string;
}): Promise<string[]> {
  await requirePermission("models:write");
  try {
    return await discoverModels({ ...input, secret: input.secret ?? null });
  } catch (problem) {
    throw new ModelsRejected(
      problem instanceof Error ? problem.message : "The engine could not be reached.",
      problem instanceof Error ? problem.message : "تعذّر الوصول إلى المحرك.",
    );
  }
}

/** `UC-59.1-05`: add a self-hosted engine as a provider with one connection. */
export async function addCustomProvider(input: {
  name: string;
  engine: string;
  baseUrl: string;
  authType: string;
  secret?: string;
  models: string[];
}): Promise<{ providerId: string }> {
  const session = await requirePermission("models:write");

  if (await repository.providerNameTaken(input.name)) {
    throw new ModelsRejected("A provider with that name already exists.", "يوجد مزوّد بهذا الاسم بالفعل.");
  }
  if (!/^https?:\/\//.test(input.baseUrl)) {
    throw new ModelsRejected("The base URL must be an http or https URL.", "يجب أن يكون العنوان الأساسي بصيغة http أو https.");
  }
  // The screen offers the engine's display name (`ENGINES`); the database holds its own
  // identity (`MODEL_ENGINES`), which is what `ENGINE_VALUES` translates between.
  const engine = ENGINE_VALUES[input.engine];
  if (!engine) {
    throw new ModelsRejected("That engine is not recognised.", "هذا المحرك غير معروف.");
  }

  const providerId = await repository.createCustomProvider(
    { nameEn: input.name, nameAr: input.name, engine },
    session.personId,
  );
  const connectionId = await repository.saveConnection(
    {
      providerId,
      name: input.name,
      baseUrl: input.baseUrl,
      authType: input.authType,
      secret: input.secret,
      active: true,
      allowedModels: input.models,
    },
    session.personId,
  );
  await publishConnectionSecret(connectionId, input.secret);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:write",
    objectType: "ModelProvider",
    objectId: providerId,
    objectLabel: input.name,
    detail: { engine: input.engine, models: input.models.length },
  });
  return { providerId };
}

/**
 * Add a provider agentgateway already speaks to natively — Anthropic, OpenAI, Bedrock and
 * the rest — directly from the console, rather than only through seed data.
 */
export async function addCloudProvider(input: AddCloudProviderInput): Promise<{ providerId: string }> {
  const session = await requirePermission("models:write");

  if (await repository.providerNameTaken(input.name)) {
    throw new ModelsRejected("A provider with that name already exists.", "يوجد مزوّد بهذا الاسم بالفعل.");
  }
  const endpointSpec = CLOUD_PROVIDER_ENDPOINT[input.gatewayProvider];
  if (endpointSpec && !input.endpoint?.trim()) {
    throw new ModelsRejected(
      `${input.gatewayProvider} needs its ${endpointSpec.label.toLowerCase()}.`,
      `يحتاج ${input.gatewayProvider} إلى ${endpointSpec.labelAr}.`,
    );
  }

  const providerId = await repository.createCloudProvider(
    { nameEn: input.name, nameAr: input.name, gatewayProvider: input.gatewayProvider },
    session.personId,
  );
  const connectionId = await repository.saveConnection(
    {
      providerId,
      name: input.name,
      baseUrl: input.endpoint ?? "",
      authType: input.authType,
      secret: input.secret,
      active: true,
      allowedModels: input.models,
    },
    session.personId,
  );
  await publishConnectionSecret(connectionId, input.secret);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:write",
    objectType: "ModelProvider",
    objectId: providerId,
    objectLabel: input.name,
    detail: { gatewayProvider: input.gatewayProvider, models: input.models.length },
  });
  return { providerId };
}

/**
 * `UC-59.1-10`: remove a connection, unless a route still runs through it.
 *
 * Removing it anyway would leave the route with a step naming a connection that no longer
 * exists — a route that looks configured and cannot serve. The routes are named so the
 * admin can decide what to do with them first.
 */
export async function removeConnection(connectionId: string): Promise<void> {
  const session = await requirePermission("models:write");

  const routes = await repository.routesUsingConnection(connectionId);
  if (routes.length > 0) {
    throw new ModelsRejected("Routes still use this connection.", "لا تزال مسارات تستخدم هذا الاتصال.", routes);
  }

  await repository.removeConnection(connectionId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:write",
    objectType: "ProviderConnection",
    objectId: connectionId,
    detail: { removed: true },
  });
}

/**
 * `UC-59.1-05`: remove a provider, with the connections and allowed models under it.
 *
 * Refused while a route still chains through it — the same rule `removeConnection` holds
 * one level down, so a provider cannot be pulled out from under a route by deleting it from
 * the other end instead.
 */
export async function removeProvider(providerId: string): Promise<void> {
  const session = await requirePermission("models:write");

  const routes = await repository.routesUsingProvider(providerId);
  if (routes.length > 0) {
    throw new ModelsRejected("Routes still use this provider.", "لا تزال مسارات تستخدم هذا المزوّد.", routes);
  }

  await repository.removeProvider(providerId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:write",
    objectType: "ModelProvider",
    objectId: providerId,
    detail: { removed: true },
  });
}

/**
 * Adds or edits a provider connection and audits it as `models:connection`, naming only whether
 * the secret changed. Requires `models:write`. A given secret is also written to the gateway's
 * Secret; on an edit, every route through the connection is republished to the gateway.
 */
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  const session = await requirePermission("models:write");
  const connectionId = await repository.saveConnection(input, session.personId);
  await publishConnectionSecret(connectionId, input.secret);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:connection",
    objectType: "ProviderConnection",
    objectLabel: input.name,
    // The secret is never audited, only the fact that one was set.
    detail: { authType: input.authType, secretChanged: input.secret !== undefined },
  });

  // Turning a connection off, or taking a model off its allow-list, changes which steps can
  // serve. The gateway holds the chain, so it has to be told or a route goes on calling a
  // step the platform no longer permits.
  if (input.connectionId) {
    for (const alias of await repository.routesUsingConnection(input.connectionId)) {
      const renderable = await repository.readRouteForGateway(alias);
      if (renderable) await publishRoute(renderable);
    }
  }
}
