import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { requirePermission, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";
import type { TestRetrievalInput } from "./schema";

/** What a retrieval test found, or why it could not run. */
export type RetrievalOutcome =
  | { ok: true; mode: string; durationMs: number; passages: { ref: string; text: string; score: number }[]; facts: { subject: string; predicate: string; object: string }[] }
  | { ok: false; reason: string };

/**
 * `UC-58.1-01` … `-06`: run a retrieval test.
 *
 * All collections means every collection this person may see, which is what keeps one they
 * cannot out of a result set that looks like everything. A mode the platform is not
 * configured for is refused with the reason rather than returning nothing and looking like
 * a query that matched nothing.
 */
export async function testRetrieval(input: TestRetrievalInput): Promise<RetrievalOutcome> {
  const session = await requirePermission("knowledge:read");

  const visible = await repository.collectionIdsVisibleTo(await visibleProjectIds("knowledge:read"));
  // `UC-58.1-05`: a collection they cannot see is excluded from All collections, and named
  // directly it is simply not theirs to query.
  const targets = input.collectionId
    ? visible === null || visible.includes(input.collectionId)
      ? [input.collectionId]
      : []
    : (visible ?? (await repository.listCollections()).map((collection) => collection.id));
  if (targets.length === 0) return { ok: false, reason: "No collection you may read matches that." };

  const found = await retrieveFrom(targets, input);
  if (!found.ok) return found;
  await repository.recordRetrievalTest({
    collectionId: input.collectionId ?? null,
    query: input.query,
    mode: input.mode,
    durationMs: found.durationMs,
    passages: found.passages,
    facts: found.facts,
    personId: session.personId,
  });
  return found;
}

/**
 * `knowledge_search`: an agent's question to the knowledge base (D31, D151).
 *
 * Bounded twice, in the server: by the collections the person behind the run may see, and by
 * the collections the run's agent is granted on its Knowledge tab. An integration client acts
 * as its owner and has no agent grant to apply. Not recorded as a retrieval test.
 */
export async function searchKnowledge(input: TestRetrievalInput): Promise<RetrievalOutcome> {
  const session = await requirePermission("knowledge:read");
  const visible = await repository.collectionIdsVisibleTo(await visibleProjectIds("knowledge:read"));
  const granted = session.actingAgent?.runId ? await repository.collectionIdsGrantedToRun(session.actingAgent.runId) : null;
  const readable = (await repository.listCollections())
    .map((collection) => collection.id)
    .filter((id) => (visible === null || visible.includes(id)) && (granted === null || granted.includes(id)));
  const targets = input.collectionId ? readable.filter((id) => id === input.collectionId) : readable;
  if (targets.length === 0) {
    return {
      ok: false,
      reason: input.collectionId
        ? `Collection ${input.collectionId} is not one this agent and person may read.`
        : "This agent is granted no knowledge collection the person may read. Ask for one on the agent's Knowledge tab.",
    };
  }
  return retrieveFrom(targets, input);
}

/** Query each collection with its own embedding route, and merge what comes back. */
async function retrieveFrom(targets: string[], input: TestRetrievalInput): Promise<RetrievalOutcome> {
  const agentServiceUrl = env().AI_AGENT_SERVICE_URL;
  if (!agentServiceUrl) return { ok: false, reason: "The retrieval service is not configured." };
  const started = Date.now();
  const passages: { ref: string; text: string; score: number }[] = [];
  const facts: { subject: string; predicate: string; object: string }[] = [];
  let failure: string | null = null;

  for (const collectionId of targets) {
    try {
      // The collection's own embedding route is the one its passages were actually
      // embedded with — a query vector from any other route is not comparable to them.
      const config = await repository.readCollectionConfig(collectionId);
      const response = await fetch(`${agentServiceUrl}/knowledge/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: input.query,
          collection_id: collectionId,
          mode: input.mode,
          limit: input.limit,
          embedding_route: config?.embeddingRoute ?? "",
        }),
      });
      if (!response.ok) {
        // `UC-58.1-06`: the embedding route is down, and Graph still answers.
        failure = `The ${input.mode} route is unavailable.`;
        continue;
      }
      const found = (await response.json()) as {
        passages?: { ref?: string; text?: string; score?: number }[];
        facts?: { subject?: string; predicate?: string; object?: string }[];
      };
      for (const passage of found.passages ?? []) {
        passages.push({ ref: passage.ref ?? "", text: passage.text ?? "", score: passage.score ?? 0 });
      }
      for (const fact of found.facts ?? []) {
        facts.push({ subject: fact.subject ?? "", predicate: fact.predicate ?? "", object: fact.object ?? "" });
      }
    } catch (problem) {
      logger().warn({ collection: collectionId, problem: String(problem) }, "a retrieval test did not run");
      failure = "The retrieval service did not answer.";
    }
  }

  if (passages.length === 0 && facts.length === 0 && failure) return { ok: false, reason: failure };
  return { ok: true, mode: input.mode, durationMs: Date.now() - started, passages, facts };
}
