import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { can, requirePermission } from "@/lib/session";
import { isFeatureEnabled } from "@/features/governance/service";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import * as repository from "./repository";

export { KnowledgeRejected } from "./errors";
export {
  type IngestionOutcome,
  reindexCollection,
  ingestionProgress,
  recordIngestionOutcome,
  type IngestionOutcomeRecorded,
} from "./ingestion-service";
export { reindex, type SourceOutcome, addSource, crawlRefusal, removeSource } from "./source-service";
export {
  createCollection,
  collectionCounts,
  deleteCollection,
  routeAliases,
  loadCollection,
  saveCollectionConfig,
  type KnowledgeCollectionDiff,
  updateKnowledgeCollection,
} from "./collection-service";
export { type RetrievalOutcome, searchKnowledge, testRetrieval } from "./retrieval-service";

/** S-56 the collections, S-57 one collection, S-58 the retrieval test. */

/**
 * The Knowledge screen: every collection, and for the one `open` names (a collection id) one
 * page of its sources, newest first, with their total. Requires `knowledge:read`.
 */
export async function loadKnowledge(
  open?: string,
  filters: { q?: string } = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  await requirePermission("knowledge:read");
  const [collections, listed, lastTest, graphRetrieval, mayReadLogs] = await Promise.all([
    repository.listCollections(),
    open ? repository.listSources(open, filters, page) : Promise.resolve({ sources: [], total: 0 }),
    repository.lastRetrievalTest(),
    // `UC-75.3-03`: with graph retrieval off, the Graph and Hybrid modes are not offered
    // and retrieval is vector-only.
    isFeatureEnabled(FEATURE_FLAGS.graphRetrieval),
    // A failed run links to its own log lines, which is only an offer to somebody who may
    // open the Logs screen at all.
    can("logs:read"),
  ]);
  return {
    collections,
    // D349: only the opened collection's sources, one page of them.
    sources: open ? { [open]: listed.sources } : {},
    sourceTotal: listed.total,
    lastTest,
    graphRetrieval,
    mayReadLogs,
    logService: repository.INGESTION_SERVICE,
  };
}
