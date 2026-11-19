/** Knowledge collections and their sources (S-56 to S-58). */

export type Collection = {
  id: string;
  n: string;
  nAr: string;
  /** Ready, Ingesting or Error. */
  st: string;
  /** `UC-56.2-04`: what the last run could not read, when it says Error. */
  why: string | null;
  docs: number;
  chunks: number;
  ents: number;
  /** When the collection last synced, ISO-8601. */
  syncedAt: string | null;
  /** How far the running ingestion has got, 0–100, or null when nothing is running. */
  progress: number | null;
  idx: string;
  chunk: string;
  size: number;
  overlap: number;
  emb: string;
  ext: string;
  rr: boolean;
  k: number;
  store: string;
  p: string;
  vis: string;
};

export type KnowledgeSource = {
  id: string;
  n: string;
  /** Upload, UrlCrawl or McpResource. */
  kind: string;
  docs: number;
  st: string;
  /** `UC-57.1-08`: why it says Error, when it does. */
  why: string | null;
  at: string;
};

/** The last retrieval test run against a collection (S-58). */
export type RetrievalResult = {
  query: string;
  mode: string;
  durationMs: number | null;
  passages: { ref: string; text: string }[];
  facts: { subject: string; predicate: string; object: string }[];
};

/** One collection as the configuration screen edits it. */
/** The routes a collection may embed with and extract its graph with (D257). */
export type RouteChoices = { embedding: string[]; chat: string[] };

export type CollectionConfig = {
  id: string;
  collectionId: string;
  projectKey: string | null;
  visibility: string;
  status: string;
  /** The row version an edit has to name back, so a concurrent save is refused. */
  version: number;
  indexType: string;
  chunking: { technique: string; size: number; overlap: number };
  preprocessing: { ocr: boolean; arabicNormalisation: boolean; stripHeadersFooters: boolean; maskPii: boolean };
  embeddingRoute: string;
  extractionRoute: string;
  retrieval: { topK: number; minimumScore: number; rerank: boolean };
  syncSchedule: string;
  maximumSizeMb: number;
  /** What the collection holds now, against the ceiling it was given. */
  currentSizeMb: number;
};
