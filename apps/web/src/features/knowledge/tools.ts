import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import { sensitiveFieldsIn } from "./privileges";
import {
  addSourceInput,
  collectionListInput,
  createCollectionInput,
  deleteCollectionInput,
  readCollectionInput,
  reindexInput,
  removeSourceInput,
  updateKnowledgeCollectionInput,
} from "./schema";
import * as service from "./service";

/**
 * S-56 to S-58 as tools: what the Knowledge screens do, offered to an agent working on
 * someone's behalf.
 *
 * A collection is where an agent's own grounding comes from, so an agent setting one up
 * can do the whole thing — create it, point it at its sources, tune how it is chunked and
 * retrieved, and then ask it a question to see what comes back.
 *
 * Ingestion is not a verb in the catalogue: adding a source and changing the embedding
 * route both start a run on their own, so there is nothing an agent has to remember to do
 * afterwards.
 */
export const KNOWLEDGE_TOOLS: PlatformTool[] = [
  action({
    subject: "knowledge_collection",
    operation: "list",
    description:
      "Every knowledge collection the acting person may see, with its status, what it " +
      "holds and how it is indexed and retrieved. Name a `collectionId` to have one page of " +
      "its sources too, newest first, with their total; `q` matches words in a source's name. " +
      "Call this first: the collection id is how every other tool names a collection.",
    input: collectionListInput,
    permission: "knowledge:read",
    run: ({ collectionId, q, limit, offset }) => service.loadKnowledge(collectionId, { q }, { limit, offset }),
  }),

  action({
    subject: "knowledge_collection",
    operation: "get",
    description:
      "One collection's configuration as its screen reads it: visibility, index type, " +
      "chunking, preprocessing, routes, retrieval settings, sync schedule, size and " +
      "ceiling, with the routes it may embed with and its version. The version is what an " +
      "edit has to name back.",
    input: readCollectionInput,
    permission: "knowledge:read",
    run: async ({ collectionId }) => {
      const loaded = await service.loadCollection(collectionId);
      if (!loaded) throw new Error(`There is no knowledge collection ${collectionId}.`);
      return loaded;
    },
  }),

  action({
    subject: "knowledge_collection",
    operation: "create",
    description:
      "Create an empty knowledge collection in a project, with its id, bilingual names " +
      "and visibility. The id is lowercase letters, digits and hyphens, and is what every " +
      "other tool names it by. It holds nothing until a source is added.",
    input: createCollectionInput,
    permission: "knowledge:write",
    run: async (input) => {
      await service.createCollection(input);
      return { collectionId: input.collectionId };
    },
  }),

  action({
    subject: "knowledge_collection",
    operation: "edit",
    description:
      "Change a collection: its visibility, index type, chunking, preprocessing, " +
      "embedding and extraction routes, retrieval settings, sync schedule and size " +
      "ceiling. Name only the fields to change; anything omitted is left alone, and each " +
      "configuration block is replaced whole by the one sent. `expectedVersion` is the " +
      "version last read — a collection somebody has saved since is refused, so read it " +
      "again and retry. Returns what changed, before and after, and how many documents a " +
      "changed embedding route makes the collection read again.",
    input: updateKnowledgeCollectionInput,
    permission: "knowledge:write",
    // T1 to retune chunking, a decision when it changes who may read the collection or
    // what is masked before it is indexed: the server reads the payload and escalates (D58).
    escalates: (input) => sensitiveFieldsIn(input),
    run: (input) => service.updateKnowledgeCollection(input),
  }),

  action({
    subject: "knowledge_collection",
    operation: "delete",
    description:
      "Delete a knowledge collection. Nothing blocks it: its sources, documents, " +
      "ingestion history, retrieval tests and the agents granted access to it all go with " +
      "it. Read the collection first — what it holds is not recoverable.",
    input: deleteCollectionInput,
    permission: "knowledge:write",
    run: async ({ collectionId }) => {
      await service.deleteCollection(collectionId);
      return { deleted: collectionId };
    },
  }),

  action({
    subject: "knowledge_source",
    operation: "create",
    description:
      "Give a collection a source of documents: an upload, a URL crawl or an MCP " +
      "resource. A file type the parser cannot read, a start URL the platform may not " +
      "fetch and a collection at its size ceiling are each refused with the reason rather " +
      "than left indexing for ever. Adding a source starts the ingestion run. An upload's " +
      "files are either `documents` as `data:` URLs or `heldFiles`: a file or artifact the " +
      "platform already holds, by id, such as one the person attached in the assistant panel.",
    input: addSourceInput,
    permission: "knowledge:write",
    run: (input) => service.addSource(input),
  }),

  action({
    subject: "knowledge_source_reindex",
    operation: "create",
    description:
      "Index one source of a collection again, as its Re-index button does: its documents are " +
      "read, chunked and embedded again. Says whether the ingestion run started, and why not.",
    input: reindexInput,
    permission: "knowledge:write",
    run: ({ sourceId }) => service.reindex(sourceId),
  }),

  action({
    subject: "knowledge_collection_reindex",
    operation: "create",
    description:
      "Index every source of a collection again, as Re-index all does, for example after its " +
      "embedding route changed. Says whether the ingestion run started, and why not.",
    input: readCollectionInput,
    permission: "knowledge:write",
    run: ({ collectionId }) => service.reindexCollection(collectionId),
  }),

  action({
    subject: "knowledge_source",
    operation: "delete",
    description:
      "Remove a source from its collection, with every document, chunk and vector it put " +
      "into the stores.",
    input: removeSourceInput,
    permission: "knowledge:write",
    run: async ({ sourceId }) => {
      await service.removeSource(sourceId);
      return { deleted: sourceId };
    },
  }),

];
