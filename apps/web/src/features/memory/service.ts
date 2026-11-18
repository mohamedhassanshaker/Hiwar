import { isFeatureEnabled } from "@/features/governance/service";
import { audit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/concurrency";
import { maskLogLine } from "@/lib/log-masking";
import { SERVER_PAGE_SIZE } from "@/lib/paging";
import { can, requirePermission, visibleOrgUnitIds } from "@/lib/session";
import * as repository from "./repository";
import type { CreateMemoryInput, RestoreMemoryInput, ReviewMemoryInput, SaveMemoryInput } from "./schema";
import { MemoryRejected } from "./errors";
import { PII_FILTER, readableScopes, proposedBySelf, assertReachable } from "./policy-service";

export { MemoryRejected } from "./errors";
export type { MemoryFilters } from "./repository";
export { searchForRun, rememberForRun } from "./run-memory-service";

/**
 * S-55: one page of the memory tree matching the filters (D349), the memory the screen opens
 * — the one `open` names, which need not be on the page, or else the page's first — with its
 * version history, and the counters.
 */
export async function loadMemory(
  filters: repository.MemoryFilters = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
  open?: string,
) {
  const session = await requirePermission("memory:read");

  // `UC-55.1-07` and D68: a scope this person's grants do not reach, and any scope
  // private to somebody else, is absent from the tree rather than shown and refused.
  const scopes = await readableScopes(session.personId);
  const [listed, scopeOptions, owners, counts, mayWrite] = await Promise.all([
    repository.listMemories(scopes, session.personId, filters, page),
    repository.listScopes(scopes, session.personId),
    repository.listOwners(scopes),
    repository.countMemories(scopes, session.personId),
    can("memory:write"),
  ]);
  const opened = open
    ? (listed.memories.find((memory) => memory.id === open) ??
      (await repository.listMemories(scopes, session.personId, { path: open }, { limit: 1, offset: 0 })).memories[0])
    : listed.memories[0];
  const [tree, versions] = await Promise.all([
    repository.listTree(scopes, session.personId, listed.memories.map((memory) => memory.id)),
    opened ? repository.listVersions(opened.id) : Promise.resolve([]),
  ]);
  // `UC-55.2-04`: the screen is told per memory whether this reader may decide it, so the
  // one they proposed is not offered an Approve the service would then refuse.
  const decide = <T extends Parameters<typeof proposedBySelf>[0]>(memory: T) => ({
    ...memory,
    mayReview: mayWrite && !proposedBySelf(memory, session),
  });
  return {
    tree,
    scopeOptions,
    owners,
    memories: listed.memories.map(decide),
    total: listed.total,
    opened: opened ? decide(opened) : null,
    counts,
    versions: opened ? { [opened.id]: versions } : {},
    mayWrite,
    // D68: whether there is any private memory of this person's to clear.
    mine: counts.mine,
  };
}

/** `UC-55.3-04`: one memory's version history, by path, for a reader whose scopes reach it. */
export async function loadVersions(path: string) {
  const session = await requirePermission("memory:read");
  const scope = await repository.scopeOfMemory(path);
  if (!scope || !(await readableScopes(session.personId)).includes(scope.scopePath)) {
    throw new MemoryRejected("That memory no longer exists.", "لم تعد هذه الذاكرة موجودة.");
  }
  return repository.listVersions(path);
}

/** What a save did, including what the PII filter took out of it (`UC-55.3-03`). */
export type SaveOutcome = { version: number; masked: boolean };

/**
 * `UC-55.3-01` … `-03` and `-07`: a new version of a memory.
 *
 * A memory is read into an agent's prompt on every run it is in scope for, so content that
 * carries personal data spreads it to every one of them. With the PII filter on, the values
 * are masked before they are stored and the saver is told — a filter that silently did
 * nothing would be worse than none at all.
 */
export async function saveMemory(input: SaveMemoryInput): Promise<SaveOutcome> {
  const session = await requirePermission("memory:write");
  await assertReachable(session.personId, input.path);

  const masked = (await isFeatureEnabled(PII_FILTER)) ? maskLogLine(input.content) : input.content;
  const wasMasked = masked !== input.content;

  const created = await repository.saveVersion(input.path, masked, input.changeNote, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:write",
    objectType: "Memory",
    objectLabel: input.path,
    detail: { changeNote: input.changeNote, piiMasked: wasMasked },
  });
  return { version: created, masked: wasMasked };
}

/**
 * `UC-55.2-01`, `-02` and `-04`: approve or reject a memory waiting for review.
 *
 * The person who proposed it may not also approve it. An agent's proposal is approved by a
 * person, which is the whole point of the review; a person's own proposal needs somebody
 * else, because a review one signs off oneself is not a review.
 *
 * D18: a review is a person's decision. An agent calling through the MCP server is
 * refused whoever proposed the version — the escalation goes to the human, and an agent
 * that could decide one proposal could decide the one it had just made itself.
 */
export async function reviewMemory(input: ReviewMemoryInput): Promise<void> {
  const session = await requirePermission("memory:write");
  if (session.actingAgent) {
    throw new MemoryRejected("A review is a person's decision.", "المراجعة قرار يتخذه شخص.");
  }
  await assertReachable(session.personId, input.path);

  const memory = await repository.readForRules(input.path);
  if (!memory) throw new MemoryRejected("That memory no longer exists.", "لم تعد هذه الذاكرة موجودة.");
  if (proposedBySelf(memory, session)) {
    throw new MemoryRejected("Somebody else has to review what you proposed.", "يجب أن يراجع شخص آخر ما اقترحته.");
  }

  await repository.review(input.path, input.decision, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:review",
    objectType: "Memory",
    objectLabel: input.path,
    detail: { decision: input.decision },
  });
}

/** `UC-55.3-04`: two versions side by side, as the screen compares them. */
export async function compareVersions(path: string, from: number, to: number): Promise<{ from: string; to: string }> {
  const session = await requirePermission("memory:read");
  const scopes = await readableScopes(session.personId);
  const scope = await repository.scopeOfMemory(path);
  if (!scope || !scopes.includes(scope.scopePath)) {
    throw new MemoryRejected("That memory no longer exists.", "لم تعد هذه الذاكرة موجودة.");
  }
  const [left, right] = await Promise.all([
    repository.readVersionContent(path, from),
    repository.readVersionContent(path, to),
  ]);
  if (left === null || right === null) throw new MemoryRejected("That version no longer exists.", "لم تعد هذه النسخة موجودة.");
  return { from: left, to: right };
}

/** `UC-55.3-05`: a new version carrying an older one's content. The old version stays. */
export async function restoreVersion(input: RestoreMemoryInput): Promise<number> {
  const session = await requirePermission("memory:write");
  await assertReachable(session.personId, input.path);
  const created = await repository.restoreVersion(input.path, input.fromVersion, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:write",
    objectType: "Memory",
    objectLabel: input.path,
    detail: { restoredFrom: input.fromVersion, version: created },
  });
  return created;
}

/** `UC-55.3-06`: a memory of one's own, pending review when the policy asks for one. */
export async function createMemory(input: CreateMemoryInput): Promise<string> {
  const session = await requirePermission("memory:write");
  // D68: the scope is named by the caller here, so it is checked against what they may
  // reach rather than taken on trust.
  const scopes = await repository.scopePathsVisibleTo(session.personId, await visibleOrgUnitIds("memory:write"));
  if (!scopes.includes(input.scopePath)) {
    throw new MemoryRejected("That scope is out of your reach.", "هذا النطاق خارج نطاق صلاحيتك.");
  }

  const masked = (await isFeatureEnabled(PII_FILTER)) ? maskLogLine(input.content) : input.content;
  const path = `${input.scopePath}/${input.slug}`;
  try {
    await repository.createMemory({
      scopePath: input.scopePath,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      path,
      content: masked,
      requiresReview: input.requiresReview,
      personId: session.personId,
    });
  } catch (problem) {
    // The driver wraps the Postgres error, so its text names the query and its parameters, not
    // the index; the SQLSTATE is what says a memory is already at this path.
    if (isUniqueViolation(problem)) {
      throw new MemoryRejected(
        `There is already a memory at ${path}.`,
        `توجد ذاكرة في المسار ${path} بالفعل.`,
      );
    }
    throw problem;
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:write",
    objectType: "Memory",
    objectLabel: path,
    detail: { created: true, requiresReview: input.requiresReview },
  });
  return path;
}

/**
 * Deletes a memory entry. Its own version history and any review of it go with it: both
 * cascade, and nothing else in the platform references a memory entry directly — an agent's
 * reach into a scope is a grant on the scope, not on the entries inside it one at a time.
 */
export async function deleteMemory(path: string): Promise<void> {
  const session = await requirePermission("memory:write");
  await assertReachable(session.personId, path);
  await repository.deleteMemory(path);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:delete",
    objectType: "Memory",
    objectLabel: path,
  });
}

/**
 * D68: a person clears their own agent memory, and only ever their own.
 *
 * The person is the session's, in the repository's `where`. Nothing in the call names
 * whose memory to clear, so there is no argument to get wrong or to forge.
 */
export async function clearMyMemory(): Promise<number> {
  const session = await requirePermission("memory:write");
  const cleared = await repository.clearPersonalMemory(session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "memory:delete",
    objectType: "Memory",
    objectLabel: `person/${session.personId}`,
    detail: { clearedPrivateMemories: cleared },
  });
  return cleared;
}
