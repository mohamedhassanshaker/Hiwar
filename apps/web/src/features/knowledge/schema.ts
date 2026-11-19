import { z } from "zod";

import { KNOWLEDGE_SOURCE_TYPES, RETRIEVAL_MODES, SENSITIVITIES } from "@/db/schema/enums";

/** Requirement 32: the knowledge action inputs. */

export const addSourceInput = z.object({
  collectionCode: z.string().min(1),
  type: z.enum(KNOWLEDGE_SOURCE_TYPES),
  /** A file name, a start URL or a connector resource path, by type. */
  name: z.string().trim().min(1).max(300),
  /** `UC-57.1-07`: what an uploaded file claims to be, checked against what can be parsed. */
  mimeType: z.string().trim().max(120).optional(),
  /**
   * `UC-57.1-01`: the files an upload carries, as the `data:` URLs a file input produces.
   *
   * A source with no documents has nothing for the ingestion run to read, so an upload
   * brings its files with it rather than naming them.
   */
  documents: z
    .array(z.object({ name: z.string().trim().min(1).max(300), dataUrl: z.string().min(1) }))
    .max(50)
    .default([]),
  /** Files or artifacts the platform already holds, copied by id (D266). */
  heldFiles: z
    .array(z.object({ kind: z.enum(["File", "Artifact"]), id: z.uuid() }))
    .max(50)
    .default([]),
});

export const reindexInput = z.object({ sourceId: z.uuid() });

export const deleteCollectionInput = z.object({ collectionId: z.string().min(1) });

export const createCollectionInput = z.object({
  collectionId: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens."),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  // Hiwar has no projects, so a collection may belong to none.
  projectKey: z.string().min(1).optional(),
  visibility: z.enum(SENSITIVITIES),
});

/**
 * What a caller provides, rather than what the schema returns: `documents` has a default,
 * so a source with no files of its own says nothing about them.
 */
export type AddSourceInput = z.input<typeof addSourceInput>;
export type CreateCollectionInput = z.infer<typeof createCollectionInput>;

const chunking = z.object({
  technique: z.string().trim().min(1).max(40),
  size: z.number().int().min(100).max(8000),
  overlap: z.number().int().min(0).max(4000),
});

const preprocessing = z.object({
  ocr: z.boolean(),
  arabicNormalisation: z.boolean(),
  stripHeadersFooters: z.boolean(),
  maskPii: z.boolean(),
});

const retrieval = z.object({
  topK: z.number().int().min(1).max(50),
  minimumScore: z.number().min(0).max(1),
  rerank: z.boolean(),
});

const syncSchedule = z.enum(["Manual", "Daily", "Weekly"]);

/** `UC-57.2-01` … `-04`: the collection's configuration, saved as a whole. */
export const saveCollectionConfigInput = z.object({
  collectionId: z.string().trim().min(1),
  visibility: z.enum(SENSITIVITIES),
  indexType: z.enum(RETRIEVAL_MODES),
  chunking,
  preprocessing,
  embeddingRoute: z.string().trim().max(60),
  extractionRoute: z.string().trim().min(1).max(60),
  retrieval,
  syncSchedule,
  maximumSizeMb: z.number().int().min(1).max(100000),
});

/**
 * `UC-57.2`: one knowledge collection as a patch — the one write path for a collection.
 *
 * Name the fields to change and nothing else: an omitted field is left alone, and each of
 * the three configuration blocks is replaced whole when it is named, because that is what
 * a block of settings is. `expectedVersion` is the version last read and goes in the SQL
 * `WHERE`, so a collection somebody has saved since is refused rather than overwritten.
 */
export const updateKnowledgeCollectionInput = z
  .object({
    collectionId: z.string().trim().min(1),
    expectedVersion: z.number().int().positive(),
    /** Sensitive: it decides who may read everything indexed in the collection. */
    visibility: z.enum(SENSITIVITIES).optional(),
    indexType: z.enum(RETRIEVAL_MODES).optional(),
    chunking: chunking.optional(),
    preprocessing: preprocessing.optional(),
    embeddingRoute: z.string().trim().max(60).optional(),
    extractionRoute: z.string().trim().min(1).max(60).optional(),
    retrieval: retrieval.optional(),
    syncSchedule: syncSchedule.optional(),
    maximumSizeMb: z.number().int().min(1).max(100000).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      [
        "visibility",
        "indexType",
        "chunking",
        "preprocessing",
        "embeddingRoute",
        "extractionRoute",
        "retrieval",
        "syncSchedule",
        "maximumSizeMb",
      ].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  );

export type UpdateKnowledgeCollectionInput = z.infer<typeof updateKnowledgeCollectionInput>;

/** `UC-58.1-01` … `-03`: one retrieval test. */
export const testRetrievalInput = z.object({
  query: z.string().trim().min(1).max(500),
  /** Absent means every collection this person may read. */
  collectionId: z.string().trim().min(1).optional(),
  mode: z.enum(RETRIEVAL_MODES),
  limit: z.number().int().min(1).max(50).default(8),
});

export type SaveCollectionConfigInput = z.infer<typeof saveCollectionConfigInput>;
export type TestRetrievalInput = z.infer<typeof testRetrievalInput>;

/** `UC-57.2-06`: one collection's configuration, read before it is edited. */
export const readCollectionInput = z.object({ collectionId: z.string().trim().min(1) });

/** The collection list as a tool asks for it: one collection's sources, at most 200, 50 unless asked. */
export const collectionListInput = z.object({
  collectionId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `UC-57.1-05`: one source and everything it put into every store. */
export const removeSourceInput = z.object({ sourceId: z.uuid() });
