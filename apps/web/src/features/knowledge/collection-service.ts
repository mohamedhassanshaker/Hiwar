import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { NotPermitted, can, requirePermission } from "@/lib/session";
import { KNOWLEDGE_COLLECTION_FIELD_RULES, fieldsIn, sensitiveFieldsIn } from "./privileges";
import * as repository from "./repository";
import type { CreateCollectionInput, SaveCollectionConfigInput, UpdateKnowledgeCollectionInput } from "./schema";
import { KnowledgeRejected } from "./errors";
import { removeFromIndex } from "./ingestion-service";
import type { RouteChoices } from "./types";

/**
 * Creates a knowledge collection with the default index, chunking, model and retrieval
 * settings, and audits it as `knowledge:write`. Requires `knowledge:write`. An id already
 * taken fails at the database's unique key.
 */
export async function createCollection(input: CreateCollectionInput): Promise<void> {
  const session = await requirePermission("knowledge:write");
  await repository.createCollection(input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:write",
    objectType: "KnowledgeCollection",
    objectLabel: input.collectionId,
  });
}

/** What deleting a collection would take with it, for the confirmation to name before it runs. */
export async function collectionCounts(collectionId: string): Promise<{ sources: number; documents: number }> {
  await requirePermission("knowledge:read");
  return repository.collectionCounts(collectionId);
}

/**
 * Deletes a knowledge collection. Nothing blocks it — its sources, documents, ingestion
 * history, retrieval tests and the agents granted access to it all go with it, which is why
 * the caller is expected to have shown `collectionCounts` first rather than finding out after.
 */
export async function deleteCollection(collectionId: string): Promise<void> {
  const session = await requirePermission("knowledge:write");
  if (!(await repository.collectionExists(collectionId))) {
    throw new KnowledgeRejected("That collection no longer exists.", "لم تعد هذه المجموعة موجودة.");
  }
  const counts = await repository.collectionCounts(collectionId);
  await removeFromIndex(collectionId, "all");
  await repository.deleteCollection(collectionId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:delete",
    objectType: "KnowledgeCollection",
    objectLabel: collectionId,
    detail: counts,
  });
}

/* ------------------------------------------- S-57 the configuration, S-58 the retrieval test */

/**
 * The routes a new collection may embed and extract with, independent of any collection
 * already existing — the first collection an install ever creates has none to borrow from.
 */
export async function routeAliases(): Promise<RouteChoices> {
  await requirePermission("knowledge:read");
  return repository.routeChoices();
}

/** A route that does not embed gives the collection nothing to index with (D257). */
async function requireEmbeddingRoute(alias: string): Promise<void> {
  if (!(await repository.routeChoices()).embedding.includes(alias)) {
    throw new KnowledgeRejected(
      `${alias} is not an embedding route. Choose a route whose kind is Embedding.`,
      `${alias} ليس مسار تضمين. اختر مساراً من نوع التضمين.`,
    );
  }
}

/** `UC-57.2-06`: the configuration as the screen edits it, and whether this person may. */
export async function loadCollection(collectionId: string) {
  await requirePermission("knowledge:read");
  const [config, routes, mayWrite] = await Promise.all([
    repository.readCollectionConfig(collectionId),
    repository.routeChoices(),
    can("knowledge:write"),
  ]);
  if (!config) return null;
  return { config, routes, mayWrite };
}

/**
 * `UC-57.2-01` … `-04`: save the collection's configuration.
 *
 * An overlap at or above the chunk size is refused rather than stored: every chunk would
 * contain the whole of the one before it, which is not a chunking at all. Changing the
 * embedding route re-indexes the collection, because vectors from two different models
 * cannot be compared — so the caller is told, and the re-index is what carries it out.
 */
export async function saveCollectionConfig(input: SaveCollectionConfigInput): Promise<{ reindexNeeded: boolean }> {
  const current = await repository.readCollectionConfig(input.collectionId);
  if (!current) throw new KnowledgeRejected("That collection no longer exists.", "لم تعد هذه المجموعة موجودة.");
  const diff = await updateKnowledgeCollection({
    collectionId: input.collectionId,
    expectedVersion: current.version,
    visibility: input.visibility,
    indexType: input.indexType,
    chunking: input.chunking,
    preprocessing: input.preprocessing,
    embeddingRoute: input.embeddingRoute,
    extractionRoute: input.extractionRoute,
    retrieval: input.retrieval,
    syncSchedule: input.syncSchedule,
    maximumSizeMb: input.maximumSizeMb,
  });
  return { reindexNeeded: diff.cascade.reindexRequired };
}

/**
 * What one collection edit changed: the fields it touched, as they were and as they are,
 * and what the change takes with it.
 *
 * The cascade is part of the diff because it is part of the change: a new embedding route
 * makes every vector the collection holds incomparable with a query vector, so the
 * documents behind them have to be read again before the collection answers anything. An
 * approver agreeing to the patch is agreeing to that work too.
 */
export type KnowledgeCollectionDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  cascade: { reindexRequired: boolean; reindexDocuments: number };
  version: number;
};

/**
 * `UC-57.2`: edit one knowledge collection as a patch — the one write path for a collection.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply. Each configuration block
 * is stored as a whole, so an omitted block is written back exactly as it was read rather
 * than defaulted.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {KnowledgeRejected} when the collection is gone, the patch is not a usable
 * configuration, or somebody saved it since the caller read it.
 */
export async function updateKnowledgeCollection(
  input: UpdateKnowledgeCollectionInput,
): Promise<KnowledgeCollectionDiff> {
  const session = await requirePermission("knowledge:write");

  for (const field of fieldsIn(input)) {
    const needed = KNOWLEDGE_COLLECTION_FIELD_RULES[field].privilege;
    if (!(await can(needed))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // A sensitive field set by an agent waits for a person, unless one has already agreed to
  // exactly these fields — which the MCP boundary establishes by spending a bound approval
  // before the call reaches here (D20, D49). Refused before anything is written.
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "knowledge_collection_edit",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => KNOWLEDGE_COLLECTION_FIELD_RULES[field].reason ?? ""),
    });
  }

  const current = await repository.readCollectionConfig(input.collectionId);
  if (!current) throw new KnowledgeRejected("That collection no longer exists.", "لم تعد هذه المجموعة موجودة.");

  const chunking = input.chunking ?? current.chunking;
  if (chunking.overlap >= chunking.size) {
    throw new KnowledgeRejected(
      "The overlap has to be smaller than the chunk size.",
      "يجب أن يكون التداخل أصغر من حجم المقطع.",
    );
  }
  const embeddingRoute = input.embeddingRoute ?? current.embeddingRoute;
  if (embeddingRoute === "") throw new KnowledgeRejected("Choose an embedding route.", "اختر مسار التضمين.");
  if (embeddingRoute !== current.embeddingRoute) await requireEmbeddingRoute(embeddingRoute);

  // Read before the write: once the route has changed, what the old one indexed is no
  // longer what the collection will answer from, and the diff still has to say how much.
  const reindexNeeded = embeddingRoute !== current.embeddingRoute;
  const cascade = {
    reindexRequired: reindexNeeded,
    reindexDocuments: reindexNeeded ? (await repository.collectionCounts(input.collectionId)).documents : 0,
  };

  const written = await repository.saveCollectionConfig(
    input.collectionId,
    input.expectedVersion,
    {
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      indexType: input.indexType ?? current.indexType,
      chunking,
      preprocessing: input.preprocessing ?? current.preprocessing,
      embeddingRoute,
      extractionRoute: input.extractionRoute ?? current.extractionRoute,
      retrieval: input.retrieval ?? current.retrieval,
      syncSchedule: input.syncSchedule ?? current.syncSchedule,
      maximumSizeMb: input.maximumSizeMb ?? current.maximumSizeMb,
    },
    session.personId,
  );
  if (!written) {
    throw new KnowledgeRejected(
      `That collection was version ${current.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كانت هذه المجموعة بالإصدار ${current.version} وليس ${input.expectedVersion}. أعد قراءتها ثم حاول مجدداً.`,
    );
  }

  const touched = fieldsIn(input);
  const was: Record<string, unknown> = current;
  const diff: KnowledgeCollectionDiff = {
    before: Object.fromEntries(touched.map((field) => [field, was[field]])),
    after: Object.fromEntries(touched.map((field) => [field, input[field]])),
    cascade,
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:write",
    objectType: "KnowledgeCollection",
    objectId: current.id,
    objectLabel: input.collectionId,
    // One pair per field the patch touched, so the log says what a value changed from as
    // well as what it changed to.
    detail: {
      ...Object.fromEntries(
        touched.flatMap((field) => [
          [`${field}From`, diff.before[field]],
          [`${field}To`, diff.after[field]],
        ]),
      ),
      cascade,
    },
  });
  return diff;
}
