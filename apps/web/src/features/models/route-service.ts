import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import { publishRoute } from "@/agentgateway/publish";
import * as repository from "./repository";
import type { SaveRouteInput } from "./schema";
import { ModelsRejected } from "./errors";

/**
 * `UC-60.1-02`, `-03`, `-04`, `-06`, `-07`, `-08`: write a route and apply it.
 *
 * Everything the editor offers is checked again here. The chain is what agents call, and a
 * step naming a model its connection does not allow is a route that typechecks, saves, and
 * fails on the first call.
 */
export async function saveRoute(input: SaveRouteInput): Promise<void> {
  const session = await requirePermission("models:write");

  // `UC-60.1-06`: an alias is how an agent names a route, so two routes cannot share one.
  if (await repository.aliasTaken(input.alias, input.originalAlias)) {
    throw new ModelsRejected("That alias is already in use.", "هذا الاسم المستعار مستخدم بالفعل.");
  }

  let outputSchema: Record<string, unknown> | null = null;
  if (input.kind === "Typesafe") {
    // `UC-60.1-06`: the schema is the contract the route holds its answers to, so it has
    // to be a schema rather than something that merely parses.
    if (!input.outputSchema?.trim()) throw new ModelsRejected("A typesafe route needs an output schema.", "المسار المُقيَّد بالنوع يحتاج إلى مخطط مخرجات.");
    try {
      outputSchema = JSON.parse(input.outputSchema) as Record<string, unknown>;
    } catch {
      throw new ModelsRejected("The output schema is not valid JSON.", "مخطط المخرجات ليس JSON صالحاً.");
    }
    if (
      typeof outputSchema !== "object" ||
      outputSchema === null ||
      Array.isArray(outputSchema) ||
      !("type" in outputSchema || "properties" in outputSchema || "$ref" in outputSchema)
    ) {
      throw new ModelsRejected("The output schema is not a JSON Schema.", "مخطط المخرجات ليس JSON Schema.");
    }
  }

  for (const [index, step] of input.chain.entries()) {
    const allowed = await repository.allowedModels(step.connectionId);
    const model = allowed.find((candidate) => candidate.name === step.modelName);
    // `UC-60.1-07`: a model the connection does not allow is not the route's to use.
    if (!model) {
      throw new ModelsRejected(
        `Step ${index + 1}: ${step.modelName} is not allowed on that connection.`,
        `الخطوة ${index + 1}: ${step.modelName} غير مسموح به على هذا الاتصال.`,
      );
    }
    // D290: a decision model answers only at the provider's decisions endpoint, which only a
    // Decision route renders to, and a Decision route can call nothing else.
    if ((model.kind === "Decision") !== (input.kind === "Decision")) {
      throw new ModelsRejected(
        input.kind === "Decision"
          ? `Step ${index + 1}: ${step.modelName} is not a decision model.`
          : `Step ${index + 1}: ${step.modelName} is a decision model, which only a Decision route can call.`,
        input.kind === "Decision"
          ? `الخطوة ${index + 1}: ${step.modelName} ليس نموذج قرار.`
          : `الخطوة ${index + 1}: ${step.modelName} نموذج قرار، ولا يستدعيه إلا مسار من نوع قرار.`,
      );
    }
    // `UC-60.1-05`: speech-to-speech needs a model that carries audio, not one that a
    // pipeline would reach through a separate speech-to-text step.
    if (input.kind === "Voice" && input.voiceMode === "Realtime" && !model.modalities.includes("audio")) {
      throw new ModelsRejected(
        `Step ${index + 1}: ${step.modelName} does not support realtime audio.`,
        `الخطوة ${index + 1}: ${step.modelName} لا يدعم الصوت الفوري.`,
      );
    }
  }

  await repository.saveRoute({ ...input, outputSchema }, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:route",
    objectType: "Route",
    objectLabel: input.alias,
    // `UC-60.1-08`: an edit applies to new calls and is audited with what changed.
    detail: { steps: input.chain.length, kind: input.kind, renamedFrom: input.originalAlias },
  });

  // Stack specification 6.1: a saved route is a route the gateway serves. The database is
  // the record, so the save stands even when the apply does not; the caller is told, and
  // the next save applies the whole chain again.
  const renderable = await repository.readRouteForGateway(input.alias);
  if (renderable) await publishRoute(renderable);
}

/**
 * `UC-60.1-09`: remove a route, unless an agent or a collection still calls it.
 *
 * An agent pinned to a route that no longer exists cannot run at all, so the users are
 * named and nothing is removed until they are moved.
 */
export async function removeRoute(alias: string): Promise<void> {
  const session = await requirePermission("models:write");

  const users = await repository.routeUsers(alias);
  if (users.length > 0) throw new ModelsRejected("This route is still in use.", "لا يزال هذا المسار مستخدماً.", users);

  await repository.removeRoute(alias);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "models:route",
    objectType: "Route",
    objectLabel: alias,
    detail: { removed: true },
  });
}

/**
 * Reconcile the gateway against the database.
 *
 * The gateway is a projection of Models & routes, not a second record (stack specification
 * 6.1). A projection has to be rebuildable, because the thing it lives in is not: a cluster
 * recreated from scratch, or a database seeded into an empty install, leaves the gateway
 * holding nothing while every screen shows routes that agents cannot call.
 *
 * Publishing each route is idempotent — the same resources, server-side applied — so this
 * is safe to run on every deploy and every seed.
 *
 * Returns the aliases published and the ones that failed, so a caller can report rather
 * than guess. Does nothing where there is no service account to apply with.
 */
export async function republishRoutes(): Promise<{ published: string[]; failed: string[] }> {
  const published: string[] = [];
  const failed: string[] = [];

  for (const alias of await repository.listRouteAliases()) {
    const renderable = await repository.readRouteForGateway(alias);
    if (!renderable) continue;
    try {
      await publishRoute(renderable);
      published.push(alias);
    } catch {
      // One route the gateway refuses must not stop the rest; the caller reports both lists.
      failed.push(alias);
    }
  }
  return { published, failed };
}
