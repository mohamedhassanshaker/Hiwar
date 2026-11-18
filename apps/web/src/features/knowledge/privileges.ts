import { fieldRulesTable, type FieldRule } from "@/lib/field-rules";

import type { UpdateKnowledgeCollectionInput } from "./schema";

/**
 * The field rules of a knowledge collection: what each editable field needs, and whether
 * an agent may set it without a person agreeing first.
 *
 * The **privilege** applies to whoever asks, the console included; **sensitivity** is only
 * about an agent acting unattended, because a person clicking Save is already the decision.
 *
 * A collection is read by every agent granted it, so the two fields that decide who sees
 * what — the visibility and the preprocessing that masks personal data before it is
 * indexed — are the decisions here. The embedding route is the third: vectors produced by
 * two different models cannot be compared, so changing it discards the index the
 * collection already has.
 */
export const KNOWLEDGE_COLLECTION_FIELD_RULES: Record<KnowledgeCollectionField, FieldRule> = {
  visibility: {
    privilege: "knowledge:write",
    sensitive: true,
    reason: "The visibility decides who may read everything indexed in the collection.",
  },
  indexType: { privilege: "knowledge:write", sensitive: false },
  chunking: { privilege: "knowledge:write", sensitive: false },
  preprocessing: {
    privilege: "knowledge:write",
    sensitive: true,
    reason: "The block is replaced whole, so dropping PII masking puts unmasked personal data into the index.",
  },
  embeddingRoute: {
    privilege: "knowledge:write",
    sensitive: true,
    reason: "Vectors from two routes are not comparable, so this discards the index and re-reads every document.",
  },
  extractionRoute: { privilege: "knowledge:write", sensitive: false },
  retrieval: { privilege: "knowledge:write", sensitive: false },
  syncSchedule: { privilege: "knowledge:write", sensitive: false },
  maximumSizeMb: { privilege: "knowledge:write", sensitive: false },
};

export type KnowledgeCollectionField =
  | "visibility"
  | "indexType"
  | "chunking"
  | "preprocessing"
  | "embeddingRoute"
  | "extractionRoute"
  | "retrieval"
  | "syncSchedule"
  | "maximumSizeMb";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateKnowledgeCollectionInput): KnowledgeCollectionField[] {
  return (Object.keys(KNOWLEDGE_COLLECTION_FIELD_RULES) as KnowledgeCollectionField[]).filter(
    (field) => field in patch,
  );
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateKnowledgeCollectionInput): KnowledgeCollectionField[] {
  return fieldsIn(patch).filter((field) => KNOWLEDGE_COLLECTION_FIELD_RULES[field].sensitive);
}

/** The module's field rules as a table, for review. */
export function knowledgeFieldRulesTable(): string {
  return fieldRulesTable("knowledge_collection", KNOWLEDGE_COLLECTION_FIELD_RULES);
}
