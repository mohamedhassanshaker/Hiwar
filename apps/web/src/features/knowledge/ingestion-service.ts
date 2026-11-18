import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { splitReference } from "@/lib/objects";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { KnowledgeRejected } from "./errors";

/**
 * `UC-57.1-05`: takes documents out of the vector store and the graph, or a whole collection
 * when `docIds` is `"all"`, before their rows go (D258). Refuses rather than half-removing:
 * the rows stay while their passages could still answer a search, so the person can try again.
 */
export async function removeFromIndex(collectionId: string, docIds: string[] | "all"): Promise<void> {
  const agentServiceUrl = env().AGENT_SERVICE_URL;
  if (!agentServiceUrl) {
    throw new KnowledgeRejected(
      "The agent service is not configured, so the index cannot be cleared. Nothing was removed.",
      "خدمة الوكلاء غير مهيأة، فلا يمكن تفريغ الفهرس. لم يُحذف شيء.",
    );
  }
  if (docIds !== "all" && docIds.length === 0) return;
  const collection = `${agentServiceUrl}/ingestion/collections/${encodeURIComponent(collectionId)}`;
  let status: number;
  try {
    const response =
      docIds === "all"
        ? await fetch(collection, { method: "DELETE" })
        : await fetch(`${collection}/removals`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ doc_ids: docIds }),
          });
    status = response.status;
    if (response.ok) return;
  } catch (problem) {
    logger().warn({ collectionId, problem: String(problem) }, "the knowledge index could not be reached");
    throw new KnowledgeRejected(
      "The knowledge index could not be reached. Nothing was removed; try again.",
      "تعذّر الوصول إلى فهرس المعرفة. لم يُحذف شيء؛ حاول مرة أخرى.",
    );
  }
  if (status === 409) {
    throw new KnowledgeRejected(
      "The collection is being indexed. Nothing was removed; try again when indexing has finished.",
      "تجري فهرسة المجموعة. لم يُحذف شيء؛ حاول مرة أخرى بعد انتهاء الفهرسة.",
    );
  }
  throw new KnowledgeRejected(
    `The knowledge index refused the removal (${status}). Nothing was removed; try again.`,
    `رفض فهرس المعرفة الحذف (${status}). لم يُحذف شيء؛ حاول مرة أخرى.`,
  );
}

/** What an ingestion run reported, which is what the collection's status then says. */
/** Whether an ingestion run started, or why it did not, in both languages. */
export type IngestionOutcome = { started: boolean; reason: string | null; reasonAr: string | null };

/**
 * `UC-57.1-01`, `-04` and `-06`: index or re-index a collection.
 *
 * The work itself is the agent service's ingestion workflow, which owns the parsing, the
 * chunking, the embeddings and the graph. The console hands it the collection's own
 * configuration, so what is indexed is what the configuration screen saved.
 */
export async function reindexCollection(collectionId: string): Promise<IngestionOutcome> {
  const session = await requirePermission("knowledge:write");

  const config = await repository.readCollectionConfig(collectionId);
  if (!config) throw new KnowledgeRejected("That collection no longer exists.", "لم تعد هذه المجموعة موجودة.");

  const agentServiceUrl = env().AGENT_SERVICE_URL;
  if (!agentServiceUrl) {
    return { started: false, reason: "The agent service is not configured.", reasonAr: "خدمة الوكلاء غير مهيأة." };
  }

  const documents = await repository.documentsOf(collectionId);
  try {
    const response = await fetch(`${agentServiceUrl}/ingestion/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collection_id: collectionId,
        // `document.key` is `bucket/key`, as `putObject` returned it when the document was
        // stored — the ingestion activity's own `key` is bucket-relative, so the two parts
        // have to be sent apart or it looks for the bucket's name twice over.
        documents: documents.map((document) => {
          const { bucket, key } = splitReference(document.key);
          return { doc_id: document.docId, bucket, key, source: document.source, filename: document.filename };
        }),
        config: {
          collection_id: collectionId,
          chunking: {
            technique: config.chunking.technique,
            size: config.chunking.size,
            overlap: config.chunking.overlap,
          },
          ocr: config.preprocessing.ocr,
          mask_pii: config.preprocessing.maskPii,
          extract_graph: config.indexType !== "Vector",
          embedding_route: config.embeddingRoute,
        },
        extraction_route: config.extractionRoute,
      }),
    });
    if (!response.ok) {
      await repository.setCollectionStatus(collectionId, "Error", session.personId);
      return {
        started: false,
        reason: `The ingestion service refused the run (${response.status}).`,
        reasonAr: `رفضت خدمة الفهرسة التشغيل (${response.status}).`,
      };
    }
  } catch (problem) {
    // `UC-56.2-04`: the collection says Error with the reason rather than Ingesting for ever.
    await repository.setCollectionStatus(collectionId, "Error", session.personId);
    logger().warn({ collection: collectionId, problem: String(problem) }, "an ingestion run did not start");
    return { started: false, reason: "The ingestion service did not answer.", reasonAr: "لم تستجب خدمة الفهرسة." };
  }

  await repository.setCollectionStatus(collectionId, "Ingesting", session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:reindex",
    objectType: "KnowledgeCollection",
    objectLabel: collectionId,
    detail: { documents: documents.length },
  });
  return { started: true, reason: null, reasonAr: null };
}

/** `UC-56.2-03`: how far the running ingestion has got, from the run itself. */
export async function ingestionProgress(collectionId: string): Promise<{ stage: string; done: number; total: number }> {
  await requirePermission("knowledge:read");
  const agentServiceUrl = env().AGENT_SERVICE_URL;
  if (!agentServiceUrl) return { stage: "unknown", done: 0, total: 0 };
  try {
    const response = await fetch(`${agentServiceUrl}/ingestion/runs/${encodeURIComponent(collectionId)}`);
    if (!response.ok) return { stage: "unknown", done: 0, total: 0 };
    const progress = (await response.json()) as { stage?: string; done?: number; total?: number };
    return { stage: progress.stage ?? "unknown", done: progress.done ?? 0, total: progress.total ?? 0 };
  } catch {
    return { stage: "unknown", done: 0, total: 0 };
  }
}

/**
 * `UC-56.2-04` and `UC-57.1-01`: take what the finished run produced and record it.
 *
 * The agent service owns the workflow and this application owns the data, so the totals
 * come back over the same API the progress does and are written here. Without it a
 * collection stayed at Ingesting for ever and its documents never said Indexed.
 *
 * Returns what was recorded, or null when there is no finished run to record.
 */
export async function recordIngestionOutcome(collectionId: string): Promise<IngestionOutcomeRecorded | null> {
  const session = await requirePermission("knowledge:write");

  const agentServiceUrl = env().AGENT_SERVICE_URL;
  if (!agentServiceUrl) return null;

  let outcome: { documents?: number; chunks?: number; entities?: number; failures?: string[] };
  try {
    const response = await fetch(
      `${agentServiceUrl}/ingestion/runs/${encodeURIComponent(collectionId)}/result`,
    );
    // 404 is "no run to read", which is the ordinary case between runs.
    if (!response.ok) return null;
    outcome = (await response.json()) as typeof outcome;
  } catch (problem) {
    logger().warn({ collection: collectionId, problem: String(problem) }, "an ingestion result could not be read");
    return null;
  }

  const recorded = {
    documents: outcome.documents ?? 0,
    chunks: outcome.chunks ?? 0,
    entities: outcome.entities ?? 0,
    failures: outcome.failures ?? [],
  };
  await repository.recordIngestionOutcome(collectionId, recorded, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "knowledge:reindex",
    objectType: "KnowledgeCollection",
    objectLabel: collectionId,
    detail: { documents: recorded.documents, chunks: recorded.chunks, entities: recorded.entities, failures: recorded.failures.length },
  });
  return recorded;
}

/** What a finished ingestion run left behind. */
export type IngestionOutcomeRecorded = {
  documents: number;
  chunks: number;
  entities: number;
  /** `UC-56.2-04`: the documents the run could not read, in its own words. */
  failures: string[];
};
