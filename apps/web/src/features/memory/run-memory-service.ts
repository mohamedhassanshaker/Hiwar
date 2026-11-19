import { isFeatureEnabled } from "@/features/governance/service";
import { audit } from "@/lib/audit";
import { maskLogLine } from "@/lib/log-masking";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { MemoryRejected } from "./errors";
import { PII_FILTER, readableScopes } from "./policy-service";

/**
 * `memory_search`: what a run may read.
 *
 * A run acts for a person and as an agent, and both narrow it (D68): the organisation's
 * memory, the agent's shared scope, and the agent's memory of this person. Another
 * person's memory under the same agent is not in the list, so no query reaches it.
 *
 * Without an acting agent this is a person reading their own memory through the same
 * function, bounded by the scopes the console would show them.
 */
export async function searchForRun(query: string, limit: number) {
  const session = await requirePermission("memory:read");
  const scopes = session.actingAgent
    ? await repository.scopePathsForRun(session.actingAgent.id, session.personId)
    : await readableScopes(session.personId);
  return repository.searchMemories(query, scopes, limit);
}

/**
 * `memory_write`: what a run remembers, which is this agent's memory of this person.
 *
 * D68: the scope is the server's choice, from the run token's agent and the person the
 * run acts for. There is no scope argument, because an argument that picked the scope
 * would be the model granting itself a reach into somebody else's memory — and the
 * model is the one thing in the loop that cannot be trusted with that.
 *
 * It is Active on write and carries no review. A private memory nobody else reads has
 * nobody else to review it, and routing it to a reviewer would be the leak the scope
 * exists to prevent. The PII filter still applies: masking is about what is stored at
 * all, not about who reads it.
 */
export async function rememberForRun(content: string): Promise<{ path: string; version: number }> {
  const session = await requirePermission("memory:write");
  if (!session.actingAgent) {
    throw new MemoryRejected(
      "Only a run remembers into an agent's memory.",
      "لا يكتب في ذاكرة الوكيل إلا تشغيل جارٍ.",
    );
  }
  const agentId = session.actingAgent.id;
  const masked = (await isFeatureEnabled(PII_FILTER)) ? maskLogLine(content) : content;
  const scopePath = await repository.ensurePersonalScope(agentId, session.personId);
  const written = await repository.rememberInScope({
    scopePath,
    agentId,
    personId: session.personId,
    content: masked,
  });
  await audit({
    actor: { type: "Agent", id: agentId, label: session.actingAgent.label },
    action: "memory:write",
    objectType: "Memory",
    objectLabel: written.path,
    detail: { version: written.version, piiMasked: masked !== content, private: true },
  });
  return written;
}
