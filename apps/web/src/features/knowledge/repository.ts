import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm } from "@/db/search";
import { CHAT_ROUTE_KINDS } from "@/db/schema/enums";
import type { CollectionConfig, RouteChoices } from "./types";
import type { Collection, KnowledgeSource, RetrievalResult } from "./types";

/** The only module in `knowledge` that touches Drizzle. */

const documentCount = sql<number>`(
  select coalesce(sum(ks.document_count), 0) from ai.knowledge_source ks where ks.collection_id = ${s.knowledgeCollection.id}
)::int`;

const chunkCount = sql<number>`(
  select coalesce(sum(kd.chunk_count), 0)
  from ai.knowledge_document kd join ai.knowledge_source ks on ks.id = kd.source_id
  where ks.collection_id = ${s.knowledgeCollection.id}
)::int`;

const runningProgress = sql<number | null>`(
  select ij.progress from ai.ingestion_job ij
  where ij.collection_id = ${s.knowledgeCollection.id} and ij.status = 'Running'
  order by ij.started_at desc limit 1
)`;

/**
 * Every collection with its document, chunk and entity counts, the running ingestion's
 * progress, and its configuration read from the stored JSON with defaults for absent keys;
 * by English name.
 */
export async function listCollections(): Promise<Collection[]> {
  const rows = await dbRo()
    .select({
      id: s.knowledgeCollection.collectionId,
      n: s.knowledgeCollection.nameEn,
      nAr: s.knowledgeCollection.nameAr,
      st: s.knowledgeCollection.status,
      why: s.knowledgeCollection.lastError,
      ents: s.knowledgeCollection.entityCount,
      syncedAt: s.knowledgeCollection.lastSyncAt,
      indexConfig: s.knowledgeCollection.indexConfigJson,
      chunkingConfig: s.knowledgeCollection.chunkingConfigJson,
      modelsConfig: s.knowledgeCollection.modelsConfigJson,
      retrievalConfig: s.knowledgeCollection.retrievalConfigJson,
      p: s.project.key,
      vis: s.knowledgeCollection.visibility,
      docs: documentCount,
      chunks: chunkCount,
      progress: runningProgress,
    })
    .from(s.knowledgeCollection)
    .leftJoin(s.project, eq(s.project.id, s.knowledgeCollection.projectId))
    .orderBy(asc(s.knowledgeCollection.nameEn));

  return rows.map((row) => {
    // The same stored names the configuration screen writes and reads. Two sets of names
    // for one record meant every card fell back to its defaults the moment anybody saved.
    const index = (row.indexConfig ?? {}) as Record<string, unknown>;
    const chunking = (row.chunkingConfig ?? {}) as Record<string, unknown>;
    const models = (row.modelsConfig ?? {}) as Record<string, unknown>;
    const retrieval = (row.retrievalConfig ?? {}) as Record<string, unknown>;
    const indexType = text(index, "type", "Hybrid");
    return {
      id: row.id,
      n: row.n,
      nAr: row.nAr,
      st: row.st,
      why: row.why,
      docs: row.docs,
      chunks: row.chunks,
      ents: row.ents,
      syncedAt: row.syncedAt?.toISOString() ?? null,
      progress: row.progress,
      idx: indexType,
      chunk: text(chunking, "technique", "Recursive"),
      size: number(chunking, "size", 800),
      overlap: number(chunking, "overlap", 80),
      emb: text(models, "embeddingRoute", ""),
      ext: text(models, "extractionRoute", "—"),
      rr: flag(retrieval, "rerank", true),
      k: number(retrieval, "topK", 8),
      // Where the index lives follows from what kind it is, rather than being stored
      // beside it and drifting from it.
      store: storeOf(indexType),
      p: row.p ?? "",
      vis: row.vis,
    };
  });
}

/**
 * One page of one collection's sources, newest first, with the total that match: `q` matches
 * words in the source's name.
 */
export async function listSources(
  collectionCode: string,
  filters: { q?: string },
  page: { limit: number; offset: number },
): Promise<{ sources: KnowledgeSource[]; total: number }> {
  const term = filters.q?.trim();
  const where = and(
    eq(s.knowledgeCollection.collectionId, collectionCode),
    term ? containsTerm(sql`public.awp_normalise(${s.knowledgeSource.name})`, term) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        id: s.knowledgeSource.id,
        n: s.knowledgeSource.name,
        kind: s.knowledgeSource.type,
        docs: s.knowledgeSource.documentCount,
        st: s.knowledgeSource.status,
        why: s.knowledgeSource.lastError,
        at: s.knowledgeSource.updatedAt,
      })
      .from(s.knowledgeSource)
      .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.knowledgeSource.collectionId))
      .where(where)
      .orderBy(desc(s.knowledgeSource.createdAt), desc(s.knowledgeSource.id))
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.knowledgeSource)
      .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.knowledgeSource.collectionId))
      .where(where),
  ]);
  return {
    sources: rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    total: counted?.total ?? 0,
  };
}

/** The most recent retrieval test, which S-58 replays as its example result. */
export async function lastRetrievalTest(collectionCode?: string): Promise<RetrievalResult | null> {
  const query = dbRo()
    .select({
      query: s.retrievalTest.query,
      mode: s.retrievalTest.mode,
      durationMs: s.retrievalTest.durationMs,
      results: s.retrievalTest.resultsJson,
    })
    .from(s.retrievalTest)
    .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.retrievalTest.collectionId))
    .orderBy(desc(s.retrievalTest.runAt))
    .limit(1);
  const [row] = collectionCode ? await query.where(eq(s.knowledgeCollection.collectionId, collectionCode)) : await query;
  if (!row) return null;
  const results = (row.results ?? {}) as {
    passages?: { ref: string; text: string }[];
    facts?: { subject: string; predicate: string; object: string }[];
  };
  return {
    query: row.query,
    mode: row.mode,
    durationMs: row.durationMs,
    passages: results.passages ?? [],
    facts: results.facts ?? [],
  };
}

/** One document a source carries, as the service has already stored it. */
export type NewKnowledgeDocument = { title: string; rawRef: string; checksum: string; sizeBytes: number };

/**
 * Adds a document source with the documents it carries, and queues the ingestion.
 *
 * `UC-57.1-01`: a source is listed with a document count, and the run reads those
 * documents — so the rows are created here rather than left for something else to invent.
 */
export async function addSource(
  collectionCode: string,
  type: string,
  name: string,
  documents: NewKnowledgeDocument[],
  personId: string,
): Promise<{ id: string }> {
  return db().transaction(async (tx) => {
    const [collection] = await tx
      .select({ id: s.knowledgeCollection.id })
      .from(s.knowledgeCollection)
      .where(eq(s.knowledgeCollection.collectionId, collectionCode))
      .limit(1);
    if (!collection) throw new Error(`No collection ${collectionCode}.`);
    const [source] = await tx
      .insert(s.knowledgeSource)
      .values({ collectionId: collection.id, type, name, documentCount: documents.length, status: "Indexing", createdBy: personId, updatedBy: personId })
      .returning({ id: s.knowledgeSource.id });
    if (documents.length > 0) {
      await tx.insert(s.knowledgeDocument).values(
        documents.map((document) => ({
          sourceId: source.id,
          title: document.title,
          rawRef: document.rawRef,
          checksum: document.checksum,
          sizeBytes: document.sizeBytes,
          // A document the run has not read yet is Indexing, which is what the source says
          // too: the three states a document has are Indexing, Indexed and Error.
          status: "Indexing",
          chunkCount: 0,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }
    await tx.insert(s.ingestionJob).values({
      collectionId: collection.id,
      sourceId: source.id,
      kind: "Ingest",
      progress: 0,
      status: "Queued",
      createdBy: personId,
      updatedBy: personId,
    });
    await tx.update(s.knowledgeCollection).set({ status: "Ingesting", updatedAt: new Date(), updatedBy: personId }).where(eq(s.knowledgeCollection.id, collection.id));
    return { id: source.id };
  });
}

/**
 * `UC-57.1-08`: what a source says when it could not be read.
 *
 * The reason is kept with the status: "Error" on its own tells somebody to look in a log
 * they have no reason to open.
 */
export async function setSourceStatus(
  sourceId: string,
  status: string,
  reason: string | null,
  personId: string,
): Promise<void> {
  await db()
    .update(s.knowledgeSource)
    .set({ status, lastError: reason, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.knowledgeSource.id, sourceId));
}

/**
 * Queues a re-index of one source: marks it Indexing with no error and adds a `Reindex`
 * ingestion job, in one transaction. Throws when the source does not exist.
 */
export async function reindex(sourceId: string, personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [source] = await tx.select({ collectionId: s.knowledgeSource.collectionId }).from(s.knowledgeSource).where(eq(s.knowledgeSource.id, sourceId)).limit(1);
    if (!source) throw new Error("No such source.");
    // A re-index clears the last reason: what it says now is what this attempt did.
    await tx.update(s.knowledgeSource).set({ status: "Indexing", lastError: null, updatedAt: new Date(), updatedBy: personId }).where(eq(s.knowledgeSource.id, sourceId));
    await tx.insert(s.ingestionJob).values({
      collectionId: source.collectionId,
      sourceId,
      kind: "Reindex",
      progress: 0,
      status: "Queued",
      createdBy: personId,
      updatedBy: personId,
    });
  });
}

/** Creates a collection with the default index, chunking, model and retrieval settings. */
export async function createCollection(
  input: { collectionId: string; nameEn: string; nameAr: string; projectKey: string; visibility: string },
  personId: string,
): Promise<void> {
  const [project] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.projectKey)).limit(1);
  await db().insert(s.knowledgeCollection).values({
    collectionId: input.collectionId,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    projectId: project?.id ?? null,
    visibility: input.visibility,
    status: "Ready",
    indexConfigJson: { mode: "Hybrid", graph: true, store: "pgvector · Neo4j" },
    chunkingConfigJson: { strategy: "Semantic", size: 800, overlap: 120 },
    modelsConfigJson: { embeddingRoute: "embedding-default", extractionRoute: null },
    retrievalConfigJson: { rerank: true, k: 8 },
    createdBy: personId,
    updatedBy: personId,
  });
}

/** Whether a collection with this id exists. */
export async function collectionExists(collectionId: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.knowledgeCollection.id })
    .from(s.knowledgeCollection)
    .where(eq(s.knowledgeCollection.collectionId, collectionId))
    .limit(1);
  return !!row;
}

/** How much a collection holds, so a delete confirmation can say what it would take with it. */
export async function collectionCounts(collectionId: string): Promise<{ sources: number; documents: number }> {
  const [row] = await dbRo()
    .select({
      sources: sql<number>`(select count(*) from ai.knowledge_source src where src.collection_id = ${outer(s.knowledgeCollection.id)})::int`,
      documents: sql<number>`(select count(*) from ai.knowledge_document d
        join ai.knowledge_source src on src.id = d.source_id where src.collection_id = ${outer(s.knowledgeCollection.id)})::int`,
    })
    .from(s.knowledgeCollection)
    .where(eq(s.knowledgeCollection.collectionId, collectionId))
    .limit(1);
  return row ?? { sources: 0, documents: 0 };
}

/**
 * Removes a knowledge collection. Nothing else in the platform is blocked by one — its
 * sources, documents, ingestion history, retrieval tests and the agents granted access to it
 * all cascade away with it, which is the whole reason the counts above are worth showing
 * before this runs rather than after.
 */
export async function deleteCollection(collectionId: string): Promise<void> {
  await db().delete(s.knowledgeCollection).where(eq(s.knowledgeCollection.collectionId, collectionId));
}

/* ------------------------------------- S-57: the configuration, the sources and the sizes */


/** Where a collection's index lives, which follows from the kind of index it is. */
const storeOf = (indexType: string): string =>
  indexType === "Vector" ? "pgvector" : indexType === "Graph" ? "Neo4j" : "pgvector · Neo4j";

const number = (source: Record<string, unknown>, key: string, fallback: number): number =>
  typeof source[key] === "number" ? (source[key] as number) : fallback;

const text = (source: Record<string, unknown>, key: string, fallback: string): string =>
  typeof source[key] === "string" ? (source[key] as string) : fallback;

const flag = (source: Record<string, unknown>, key: string, fallback: boolean): boolean =>
  typeof source[key] === "boolean" ? (source[key] as boolean) : fallback;

/**
 * One collection's configuration as the configuration screen edits it, read from the stored
 * JSON with defaults for absent keys, plus its stored size in MB; null when the id names no
 * collection.
 */
export async function readCollectionConfig(collectionId: string): Promise<CollectionConfig | null> {
  const [row] = await dbRo()
    .select({
      id: s.knowledgeCollection.id,
      collectionId: s.knowledgeCollection.collectionId,
      projectKey: s.project.key,
      visibility: s.knowledgeCollection.visibility,
      status: s.knowledgeCollection.status,
      version: s.knowledgeCollection.version,
      index: s.knowledgeCollection.indexConfigJson,
      chunking: s.knowledgeCollection.chunkingConfigJson,
      models: s.knowledgeCollection.modelsConfigJson,
      retrieval: s.knowledgeCollection.retrievalConfigJson,
      sizeMb: sql<number>`coalesce((
        select sum(d.size_bytes) from ai.knowledge_document d
        join ai.knowledge_source src on src.id = d.source_id
        where src.collection_id = ${s.knowledgeCollection.id}
      ), 0)::float8 / 1048576`,
    })
    .from(s.knowledgeCollection)
    .leftJoin(s.project, eq(s.project.id, s.knowledgeCollection.projectId))
    .where(eq(s.knowledgeCollection.collectionId, collectionId))
    .limit(1);
  if (!row) return null;

  const index = (row.index ?? {}) as Record<string, unknown>;
  const chunking = (row.chunking ?? {}) as Record<string, unknown>;
  const models = (row.models ?? {}) as Record<string, unknown>;
  const retrieval = (row.retrieval ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    collectionId: row.collectionId,
    projectKey: row.projectKey,
    visibility: row.visibility,
    status: row.status,
    version: row.version,
    indexType: text(index, "type", "Hybrid"),
    chunking: {
      technique: text(chunking, "technique", "Recursive"),
      size: number(chunking, "size", 800),
      overlap: number(chunking, "overlap", 80),
    },
    preprocessing: {
      ocr: flag(chunking, "ocr", false),
      arabicNormalisation: flag(chunking, "arabicNormalisation", true),
      stripHeadersFooters: flag(chunking, "stripHeadersFooters", true),
      maskPii: flag(chunking, "maskPii", true),
    },
    embeddingRoute: text(models, "embeddingRoute", ""),
    extractionRoute: text(models, "extractionRoute", "reasoning-default"),
    retrieval: {
      topK: number(retrieval, "topK", 8),
      minimumScore: number(retrieval, "minimumScore", 0.35),
      rerank: flag(retrieval, "rerank", true),
    },
    syncSchedule: text(index, "syncSchedule", "Manual"),
    maximumSizeMb: number(index, "maximumSizeMb", 1024),
    currentSizeMb: Math.round(row.sizeMb * 100) / 100,
  };
}

/**
 * `UC-57.2-01` … `-03`: the configuration, written as a whole, with the version in the
 * `WHERE`.
 *
 * Each block is stored as one JSON column, so the caller sends every block whether the
 * patch named it or not — a partial write here would default the fields it left out.
 * Visibility is its own column and is the one thing that may be left alone.
 *
 * Returns false when no row is at `expectedVersion`, which is a concurrent save.
 */
export async function saveCollectionConfig(
  collectionId: string,
  expectedVersion: number,
  config: Omit<CollectionConfig, "id" | "collectionId" | "projectKey" | "status" | "version" | "visibility" | "currentSizeMb"> & {
    visibility?: string;
  },
  personId: string,
): Promise<boolean> {
  const rows = await db()
    .update(s.knowledgeCollection)
    .set({
      ...(config.visibility === undefined ? {} : { visibility: config.visibility }),
      indexConfigJson: {
        type: config.indexType,
        syncSchedule: config.syncSchedule,
        maximumSizeMb: config.maximumSizeMb,
      },
      chunkingConfigJson: {
        technique: config.chunking.technique,
        size: config.chunking.size,
        overlap: config.chunking.overlap,
        ocr: config.preprocessing.ocr,
        arabicNormalisation: config.preprocessing.arabicNormalisation,
        stripHeadersFooters: config.preprocessing.stripHeadersFooters,
        maskPii: config.preprocessing.maskPii,
      },
      modelsConfigJson: { embeddingRoute: config.embeddingRoute, extractionRoute: config.extractionRoute },
      retrievalConfigJson: {
        topK: config.retrieval.topK,
        minimumScore: config.retrieval.minimumScore,
        rerank: config.retrieval.rerank,
      },
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(
      and(
        eq(s.knowledgeCollection.collectionId, collectionId),
        eq(s.knowledgeCollection.version, expectedVersion),
      ),
    )
    .returning({ id: s.knowledgeCollection.id });
  return rows.length > 0;
}

/**
 * The routes a collection may be given, by the kind each route declares in Models & routes
 * (D257): an Embedding route embeds, and a Standard or Typesafe one extracts the graph's
 * entities. A Voice route does neither.
 */
export async function routeChoices(): Promise<RouteChoices> {
  const rows = await dbRo().select({ alias: s.route.alias, kind: s.route.kind }).from(s.route).orderBy(asc(s.route.alias));
  return {
    embedding: rows.filter((row) => row.kind === "Embedding").map((row) => row.alias),
    chat: rows.filter((row) => (CHAT_ROUTE_KINDS as readonly string[]).includes(row.kind)).map((row) => row.alias),
  };
}

/** `UC-57.1-05`: a source and everything it put into every store. */
export async function removeSource(sourceId: string): Promise<{ documents: number } | null> {
  return db().transaction(async (tx) => {
    const [source] = await tx
      .select({ id: s.knowledgeSource.id, documents: s.knowledgeSource.documentCount })
      .from(s.knowledgeSource)
      .where(eq(s.knowledgeSource.id, sourceId))
      .limit(1);
    if (!source) return null;
    // The ingestion jobs name the source, and they are the record that it was indexed; they
    // go with it rather than keeping a row nothing can reach.
    await tx.delete(s.ingestionJob).where(eq(s.ingestionJob.sourceId, sourceId));
    // The chunks and the graph entities hang off the documents, which cascade from here.
    await tx.delete(s.knowledgeSource).where(eq(s.knowledgeSource.id, sourceId));
    return { documents: source.documents };
  });
}

/** The documents a source put in, by the id their passages carry as `doc_id`. */
export async function documentIdsOfSource(sourceId: string): Promise<string[]> {
  const rows = await db()
    .select({ id: s.knowledgeDocument.id })
    .from(s.knowledgeDocument)
    .where(eq(s.knowledgeDocument.sourceId, sourceId));
  return rows.map((row) => row.id);
}

/** One source with the collection it belongs to, for the acts that name a source alone. */
export async function readSource(sourceId: string): Promise<{
  id: string;
  name: string;
  type: string;
  status: string;
  collectionId: string;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.knowledgeSource.id,
      name: s.knowledgeSource.name,
      type: s.knowledgeSource.type,
      status: s.knowledgeSource.status,
      collectionId: s.knowledgeCollection.collectionId,
    })
    .from(s.knowledgeSource)
    .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.knowledgeSource.collectionId))
    .where(eq(s.knowledgeSource.id, sourceId))
    .limit(1);
  return row ?? null;
}

/** The documents of one collection, as the ingestion run needs them. */
export async function documentsOf(collectionId: string): Promise<
  { docId: string; key: string; source: string; filename: string }[]
> {
  const rows = await dbRo()
    .select({
      docId: s.knowledgeDocument.id,
      key: s.knowledgeDocument.rawRef,
      source: s.knowledgeSource.name,
      filename: s.knowledgeDocument.title,
    })
    .from(s.knowledgeDocument)
    .innerJoin(s.knowledgeSource, eq(s.knowledgeSource.id, s.knowledgeDocument.sourceId))
    .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.knowledgeSource.collectionId))
    .where(eq(s.knowledgeCollection.collectionId, collectionId));
  return rows;
}

/** `UC-56.2-03` and `-04`: what the collection is doing, written back by the console. */
export async function setCollectionStatus(collectionId: string, status: string, personId: string): Promise<void> {
  await db()
    .update(s.knowledgeCollection)
    .set({ status, updatedAt: new Date(), updatedBy: personId })
    .where(eq(s.knowledgeCollection.collectionId, collectionId));
}

/** The service an ingestion run writes its log lines under, and the Logs screen filters by. */
export const INGESTION_SERVICE = "ingestion";

/** One stored reason per line, which is how the Knowledge screen lists them. */
const SEP = "\n";

/**
 * `UC-56.2-04` and `UC-57.1-01`: what a finished ingestion run leaves behind.
 *
 * The run's totals belong to the collection, and its documents stop saying Indexing. A run
 * that could not read some of its documents still indexed the rest, so only the documents
 * named in `failures` say Error and the rest keep what the run got for them.
 *
 * The reasons are kept where they are read: on the document's own source, on the
 * collection, and as service-log lines the Logs screen finds by the collection's id.
 * "Error" on its own tells somebody to look in a log that has nothing in it.
 */
export async function recordIngestionOutcome(
  collectionId: string,
  outcome: { documents: number; chunks: number; entities: number; failures: string[] },
  personId: string,
): Promise<void> {
  const failed = outcome.failures.length > 0;
  // The workflow writes one line per document it could not read, as `<title>: <problem>`.
  const reasonOf = new Map(
    outcome.failures.map((failure) => {
      const at = failure.indexOf(": ");
      return at === -1 ? ["", failure] : [failure.slice(0, at), failure.slice(at + 2)];
    }),
  );

  await db().transaction(async (tx) => {
    const [collection] = await tx
      .select({ id: s.knowledgeCollection.id })
      .from(s.knowledgeCollection)
      .where(eq(s.knowledgeCollection.collectionId, collectionId))
      .limit(1);
    if (!collection) return;

    await tx
      .update(s.knowledgeCollection)
      .set({
        status: failed ? "Error" : "Ready",
        lastError: failed ? outcome.failures.join(SEP) : null,
        entityCount: outcome.entities,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(eq(s.knowledgeCollection.id, collection.id));

    // The chunks are the run's, spread over the documents it read, so the figures the
    // screen adds up are the run's figures rather than a guess per document.
    const documents = await tx
      .select({ id: s.knowledgeDocument.id, title: s.knowledgeDocument.title, sourceId: s.knowledgeDocument.sourceId })
      .from(s.knowledgeDocument)
      .innerJoin(s.knowledgeSource, eq(s.knowledgeSource.id, s.knowledgeDocument.sourceId))
      .where(eq(s.knowledgeSource.collectionId, collection.id));
    const each = documents.length > 0 ? Math.round(outcome.chunks / documents.length) : 0;

    /** The reasons that belong to each source, by the documents of its own that failed. */
    const bySource = new Map<string, string[]>();
    for (const document of documents) {
      const reason = reasonOf.get(document.title);
      if (reason !== undefined) bySource.set(document.sourceId, [...(bySource.get(document.sourceId) ?? []), reason]);
      await tx
        .update(s.knowledgeDocument)
        .set({ status: reason === undefined ? "Indexed" : "Error", chunkCount: each, updatedBy: personId })
        .where(eq(s.knowledgeDocument.id, document.id));
    }

    const sources = await tx
      .select({ id: s.knowledgeSource.id })
      .from(s.knowledgeSource)
      .where(eq(s.knowledgeSource.collectionId, collection.id));
    for (const source of sources) {
      const reasons = bySource.get(source.id);
      // A run that failed without naming a document — the workflow itself stopped — leaves
      // every source of the collection saying so, because none of them was indexed.
      const unattributed = failed && bySource.size === 0 ? outcome.failures : null;
      const why = reasons?.join(SEP) ?? unattributed?.join(SEP) ?? null;
      await tx
        .update(s.knowledgeSource)
        .set({
          status: why === null ? "Indexed" : "Error",
          lastError: why,
          documentCount: documents.filter((document) => document.sourceId === source.id).length,
          updatedAt: new Date(),
          updatedBy: personId,
        })
        .where(eq(s.knowledgeSource.id, source.id));
    }

    // `UC-74.1-03`: the Logs screen finds these by the collection's id, which is what the
    // Knowledge screen links to when it says a run failed.
    if (failed) {
      await tx.insert(s.logEntry).values(
        outcome.failures.map((failure) => ({
          level: "Error",
          service: INGESTION_SERVICE,
          message: failure,
          contextJson: { collection: collectionId },
          correlationId: collectionId,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }
  });
}

/** `UC-58.1-05`: the collections this person may run a retrieval test against. */
export async function collectionIdsVisibleTo(visibleProjects: string[] | null): Promise<string[] | null> {
  if (visibleProjects === null) return null;
  const rows = await dbRo()
    .select({ collectionId: s.knowledgeCollection.collectionId, projectId: s.knowledgeCollection.projectId })
    .from(s.knowledgeCollection);
  const reachable = new Set(visibleProjects);
  // A collection with no project is the organisation's own, which anybody who may read
  // knowledge may test against.
  return rows.filter((row) => row.projectId === null || reachable.has(row.projectId)).map((row) => row.collectionId);
}

/** Records what a retrieval test returned, which is what the screen shows on its next open. */
export async function recordRetrievalTest(input: {
  collectionId: string | null;
  query: string;
  mode: string;
  durationMs: number;
  passages: { ref: string; text: string; score: number }[];
  facts: { subject: string; predicate: string; object: string }[];
  personId: string;
}): Promise<void> {
  const [collection] = input.collectionId
    ? await dbRo()
        .select({ id: s.knowledgeCollection.id })
        .from(s.knowledgeCollection)
        .where(eq(s.knowledgeCollection.collectionId, input.collectionId))
        .limit(1)
    : [undefined];
  await db().insert(s.retrievalTest).values({
    collectionId: collection?.id ?? null,
    query: input.query,
    mode: input.mode,
    durationMs: input.durationMs,
    resultsJson: { passages: input.passages, facts: input.facts },
    createdBy: input.personId,
    updatedBy: input.personId,
  });
}

/** The collections a run's agent version is granted, by collection id (D31). */
export async function collectionIdsGrantedToRun(runId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ collectionId: s.knowledgeCollection.collectionId })
    .from(s.run)
    .innerJoin(s.agentKnowledgeAccess, eq(s.agentKnowledgeAccess.agentVersionId, s.run.agentVersionId))
    .innerJoin(s.knowledgeCollection, eq(s.knowledgeCollection.id, s.agentKnowledgeAccess.collectionId))
    .where(eq(s.run.id, runId));
  return rows.map((row) => row.collectionId);
}
