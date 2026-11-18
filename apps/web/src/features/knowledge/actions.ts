"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  addSourceInput,
  createCollectionInput,
  deleteCollectionInput,
  reindexInput,
  saveCollectionConfigInput,
  testRetrievalInput,
} from "./schema";
import * as service from "./service";
import type { RouteChoices } from "./types";

/** S-56 to S-58 mutations. */

/** `UC-57.1-01` … `-03`: a source of documents, or why it cannot be one. */
export async function addSource(input: unknown): Promise<Outcome<service.SourceOutcome>> {
  const outcome = await attempt(() => service.addSource(addSourceInput.parse(input)));
  if (outcome.ok && outcome.value.added) revalidatePath("/knowledge");
  return outcome;
}

/** `UC-57.1-04`: re-read one source, and say whether its indexing started. */
export async function reindex(input: unknown): Promise<Outcome<service.IngestionOutcome>> {
  const outcome = await attempt(() => service.reindex(reindexInput.parse(input).sourceId));
  revalidatePath("/knowledge");
  return outcome;
}

/**
 * `UC-56.2-02`: create a collection with the default settings through `service.createCollection`
 * and revalidate `/knowledge`. The New collection dialog saves its configuration next.
 */
export async function createCollection(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.createCollection(createCollectionInput.parse(input)));
  revalidatePath("/knowledge");
  return outcome;
}

/** What deleting a collection would take with it, to show before the confirmation. */
export async function collectionCounts(collectionId: string): Promise<{ sources: number; documents: number }> {
  return service.collectionCounts(collectionId);
}

/** Deletes a collection: its sources, documents and ingestion history go with it. */
export async function deleteCollection(input: unknown): Promise<Outcome<void>> {
  const { collectionId } = deleteCollectionInput.parse(input);
  const outcome = await attempt(() => service.deleteCollection(collectionId));
  revalidatePath("/knowledge");
  return outcome;
}

/** `UC-57.2-01` … `-04`: save the collection's configuration. */
export async function saveCollectionConfig(input: unknown): Promise<Outcome<{ reindexNeeded: boolean }>> {
  const outcome = await attempt(() => service.saveCollectionConfig(saveCollectionConfigInput.parse(input)));
  revalidatePath("/knowledge");
  return outcome;
}

/** `UC-57.1-05`: remove a source and everything it put into every store. */
export async function removeSource(sourceId: string): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.removeSource(sourceId));
  revalidatePath("/knowledge");
  return outcome;
}

/** `UC-57.1-06`: re-index the whole collection. */
export async function reindexCollection(collectionId: string): Promise<Outcome<service.IngestionOutcome>> {
  const outcome = await attempt(() => service.reindexCollection(collectionId));
  revalidatePath("/knowledge");
  return outcome;
}

/** `UC-56.2-03`: how far the running ingestion has got. */
export async function ingestionProgress(collectionId: string): Promise<{ stage: string; done: number; total: number }> {
  return service.ingestionProgress(collectionId);
}

/** `UC-56.2-04`: record what the finished run produced, once the screen sees it stop. */
export async function recordIngestionOutcome(
  collectionId: string,
): Promise<Outcome<service.IngestionOutcomeRecorded | null>> {
  const outcome = await attempt(() => service.recordIngestionOutcome(collectionId));
  revalidatePath("/knowledge");
  return outcome;
}

/** `UC-58.1-01` … `-06`: run a retrieval test. */
export async function testRetrieval(input: unknown): Promise<service.RetrievalOutcome> {
  return service.testRetrieval(testRetrievalInput.parse(input));
}

/** `UC-56.1-02`: the collection's configuration, as its screen edits it. */
export async function loadCollection(collectionId: string) {
  return service.loadCollection(collectionId);
}

/** `UC-56.2-02`: the route aliases a new collection may embed with. */
export async function routeAliases(): Promise<RouteChoices> {
  return service.routeAliases();
}
