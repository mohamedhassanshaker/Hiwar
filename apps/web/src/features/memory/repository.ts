import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm } from "@/db/search";
import { assertWritten } from "@/lib/concurrency";
import type { MemoryCounts, MemoryEntry, MemoryGroup, MemoryItem, MemoryVersion } from "./types";

/** The only module in `memory` that touches Drizzle. */

/**
 * `UC-55.1-07` and D68: the scopes a read is confined to, always an explicit list.
 *
 * There is deliberately no "every scope" value. A private scope belongs to one person
 * (D68), so a caller that could ask for everything would be a caller that reads another
 * person's agent memory the moment somebody gives it an organisation-wide grant. An
 * empty list is a reader whose grants reach nothing.
 */
const inScopes = (scopePaths: string[]) =>
  inArray(s.memoryScope.path, scopePaths.length > 0 ? scopePaths : ["__none__"]);

const SCOPE_ICON: Record<string, string> = { Organisation: "Bank", BusinessUnit: "Invoice01", Session: "Chat" };

/**
 * D68: a private scope reads as the agent's memory *of you*, so the explorer does not
 * show two identically named agent branches with no way to tell them apart.
 */
const privateLabel = ([en, ar]: [string, string]): [string, string] => [`${en} — your memory`, `${ar} — ذاكرتك`];

/**
 * What the memory screen filters on (`UC-55.1-02` … `-04`): the scope kind, the owner (a
 * group's or an agent's id), the status, the review state, who wrote the current version
 * (`AgentRun` or `Person`), words in the title or the current content, and one memory by path.
 */
export type MemoryFilters = {
  scope?: string;
  owner?: string;
  status?: string;
  reviewed?: "overdue" | "never";
  source?: string;
  q?: string;
  path?: string;
};

/** Whether the current version of the memory in the outer query meets `condition` (alias `cv`). */
const currentVersion = (condition: SQL) => sql`exists (
  select 1 from ai.memory_version cv
  where cv.memory_id = ${s.memory.id} and cv.version_number = ${s.memory.currentVersion} and ${condition}
)`;

/** The filters as one condition over `ai.memory` joined to its scope. */
function memoryWhere(scopePaths: string[], filters: MemoryFilters) {
  const term = filters.q?.trim();
  return and(
    inScopes(scopePaths),
    filters.path ? eq(s.memory.path, filters.path) : undefined,
    filters.scope ? eq(s.memoryScope.kind, filters.scope) : undefined,
    filters.owner ? eq(s.memory.ownerId, filters.owner) : undefined,
    filters.status ? eq(s.memory.status, filters.status) : undefined,
    filters.reviewed === "overdue" ? sql`${s.memory.reviewDueAt} < now()` : undefined,
    filters.reviewed === "never" ? isNull(s.memory.lastReviewedAt) : undefined,
    filters.source
      ? currentVersion(sql`exists (select 1 from ai.memory_entry ce where ce.memory_version_id = cv.id and ce.source_type = ${filters.source})`)
      : undefined,
    // The body is searched as well as the title, so a keyword somebody remembers from the
    // content finds the memory it is in.
    term
      ? or(containsTerm(s.memory.searchKey, term), currentVersion(containsTerm(sql`public.awp_normalise(coalesce(cv.content, ''))`, term)))
      : undefined,
  );
}

/**
 * One page of the memories matching the filters, in tree order (scope, then path), with the
 * total that match, less the one field only the reader's own identity can decide.
 */
export async function listMemories(
  scopePaths: string[],
  personId: string,
  filters: MemoryFilters,
  page: { limit: number; offset: number },
): Promise<{ memories: Omit<MemoryEntry, "mayReview">[]; total: number }> {
  const where = memoryWhere(scopePaths, filters);
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        id: s.memory.id,
        scopePersonId: s.memoryScope.personId,
        titleEn: s.memory.titleEn,
        titleAr: s.memory.titleAr,
        path: s.memory.path,
        scope: s.memoryScope.kind,
        scopePath: s.memoryScope.path,
        st: s.memory.status,
        v: s.memory.currentVersion,
        version: s.memory.version,
        ownerType: s.memory.ownerType,
        ownerId: s.memory.ownerId,
        access: s.memory.accessJson,
        writePolicy: s.memory.writePolicyJson,
        reviewedAt: s.memory.lastReviewedAt,
        reviewDueAt: s.memory.reviewDueAt,
        reviewOverdue: sql<boolean>`${s.memory.reviewDueAt} is not null and ${s.memory.reviewDueAt} < now()`,
        scopeAgentEn: sql<string | null>`(select a.name_en from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
        scopeAgentAr: sql<string | null>`(select a.name_ar from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
        scopeUnitEn: sql<string | null>`(select u.name_en from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
        scopeUnitAr: sql<string | null>`(select u.name_ar from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
        scopeOrgEn: sql<string | null>`(select o.name_en from core.organisation o where o.id = ${outer(s.memoryScope.refId)})`,
        scopeOrgAr: sql<string | null>`(select o.name_ar from core.organisation o where o.id = ${outer(s.memoryScope.refId)})`,
        scopeRoomKey: sql<string | null>`(select r.key from work.discussion_room r where r.id = ${outer(s.memoryScope.refId)})`,
        // `UC-55.2-04`: who proposed the newest version decides whether this reader may review it.
        proposedByType: sql<string | null>`(
          select v.created_by_type from ai.memory_version v
          where v.memory_id = ${s.memory.id} order by v.version_number desc limit 1
        )`,
        proposedById: sql<string | null>`(
          select v.created_by_id from ai.memory_version v
          where v.memory_id = ${s.memory.id} order by v.version_number desc limit 1
        )`,
      })
      .from(s.memory)
      .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
      .where(where)
      .orderBy(asc(s.memoryScope.path), asc(s.memory.path))
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.memory)
      .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
      .where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const entries = ids.length
    ? await dbRo()
        .select({
          memoryId: s.memoryVersion.memoryId,
          versionNumber: s.memoryVersion.versionNumber,
          text: s.memoryEntry.text,
          sourceRef: s.memoryEntry.sourceRef,
        })
        .from(s.memoryEntry)
        .innerJoin(s.memoryVersion, eq(s.memoryVersion.id, s.memoryEntry.memoryVersionId))
        .where(inArray(s.memoryVersion.memoryId, ids))
        .orderBy(asc(s.memoryEntry.createdAt))
    : [];

  const owners = ids.length
    ? await dbRo()
        .select({ id: s.group.id, nameEn: s.group.nameEn, nameAr: s.group.nameAr })
        .from(s.group)
    : [];
  const agents = ids.length ? await dbRo().select({ id: s.agent.id, nameEn: s.agent.nameEn, nameAr: s.agent.nameAr }).from(s.agent) : [];

  const memories: Omit<MemoryEntry, "mayReview">[] = rows.map((row) => {
    const access = (row.access ?? {}) as { labelEn?: string; labelAr?: string; pathEn?: string; pathAr?: string };
    const writePolicy = (row.writePolicy ?? {}) as { requiresReview?: boolean };
    const owner = owners.find((group) => group.id === row.ownerId) ?? agents.find((agent) => agent.id === row.ownerId);
    const items: MemoryItem[] = entries
      .filter((entry) => entry.memoryId === row.id && entry.versionNumber === row.v)
      .map((entry) => {
        const [heading, ...body] = entry.text.split("\n");
        return { heading, body: body.join("\n"), source: entry.sourceRef ?? "" };
      });
    const mine = row.scopePersonId !== null && row.scopePersonId === personId;
    const base: [string, string] =
      row.scope === "Agent"
        ? [row.scopeAgentEn ?? "", row.scopeAgentAr ?? ""]
        : row.scope === "BusinessUnit"
          ? [row.scopeUnitEn ?? "", row.scopeUnitAr ?? ""]
          : row.scope === "Session"
            ? [row.scopeRoomKey ?? "", row.scopeRoomKey ?? ""]
            : [row.scopeOrgEn ?? "", row.scopeOrgAr ?? ""];
    const scopeLabel = mine ? privateLabel(base) : base;
    return {
      // The whole path, not its last segment: two people's private memory under the same
      // agent carry the same slug, and a key that collided would show one person the
      // other's versions.
      id: row.path,
      mine,
      title: [row.titleEn, row.titleAr],
      scopeLabel,
      path: [access.pathEn ?? row.path, access.pathAr ?? row.path],
      scope: row.scope,
      st: row.st,
      v: row.v,
      version: row.version,
      owner: [owner?.nameEn ?? "", owner?.nameAr ?? ""],
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
      access: [access.labelEn ?? "", access.labelAr ?? ""],
      requiresReview: writePolicy.requiresReview ?? false,
      reviewOverdue: row.reviewOverdue,
      proposedByType: row.proposedByType,
      proposedById: row.proposedById,
      items,
    };
  });
  return { memories, total: counted?.total ?? 0 };
}

/** The owners of the memories in the reader's scopes, for the owner filter: groups and agents. */
export async function listOwners(scopePaths: string[]): Promise<{ id: string; n: [string, string] }[]> {
  const rows = await dbRo()
    .selectDistinct({
      id: s.memory.ownerId,
      groupEn: s.group.nameEn,
      groupAr: s.group.nameAr,
      agentEn: s.agent.nameEn,
      agentAr: s.agent.nameAr,
    })
    .from(s.memory)
    .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
    .leftJoin(s.group, eq(s.group.id, s.memory.ownerId))
    .leftJoin(s.agent, eq(s.agent.id, s.memory.ownerId))
    .where(inScopes(scopePaths));
  return rows
    .flatMap((row) => {
      const en = row.groupEn ?? row.agentEn;
      return row.id && en ? [{ id: row.id, n: [en, row.groupAr ?? row.agentAr ?? en] as [string, string] }] : [];
    })
    .sort((a, b) => a.n[0].localeCompare(b.n[0]));
}

/** The explorer tree for the memories named: one branch per scope, with those memories beneath it. */
export async function listTree(scopePaths: string[], personId: string, memoryPaths: string[]): Promise<MemoryGroup[]> {
  if (memoryPaths.length === 0) return [];
  const rows = await dbRo()
    .select({
      scopeId: s.memoryScope.id,
      kind: s.memoryScope.kind,
      scopePath: s.memoryScope.path,
      refId: s.memoryScope.refId,
      scopePersonId: s.memoryScope.personId,
      memoryPath: s.memory.path,
      titleEn: s.memory.titleEn,
      titleAr: s.memory.titleAr,
      agentCode: sql<string | null>`(select a.code from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
      unitEn: sql<string | null>`(select u.name_en from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
      unitAr: sql<string | null>`(select u.name_ar from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
      agentEn: sql<string | null>`(select a.name_en from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
      agentAr: sql<string | null>`(select a.name_ar from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
      organisationEn: sql<string | null>`(select o.name_en from core.organisation o where o.id = ${outer(s.memoryScope.refId)})`,
      organisationAr: sql<string | null>`(select o.name_ar from core.organisation o where o.id = ${outer(s.memoryScope.refId)})`,
      roomKey: sql<string | null>`(select r.key from work.discussion_room r where r.id = ${outer(s.memoryScope.refId)})`,
    })
    .from(s.memoryScope)
    .innerJoin(s.memory, eq(s.memory.scopeId, s.memoryScope.id))
    .where(and(inScopes(scopePaths), inArray(s.memory.path, memoryPaths)))
    .orderBy(asc(s.memoryScope.path), asc(s.memory.path));

  const groups = new Map<string, MemoryGroup>();
  for (const row of rows) {
    const base: [string, string] =
      row.kind === "Organisation"
        ? ["Organisation", "الجهة"]
        : row.kind === "BusinessUnit"
          ? [row.unitEn ?? "", row.unitAr ?? ""]
          : row.kind === "Agent"
            ? [row.agentEn ?? "", row.agentAr ?? ""]
            : [row.roomKey ?? "Sessions", row.roomKey ?? "الجلسات"];
    const mine = row.scopePersonId !== null && row.scopePersonId === personId;
    const group = groups.get(row.scopeId) ?? {
      id: row.scopePath,
      n: mine ? privateLabel(base) : base,
      ic: SCOPE_ICON[row.kind],
      agent: row.agentCode ?? undefined,
      mine,
      kids: [],
    };
    if (row.memoryPath) {
      group.kids.push({ id: row.memoryPath, n: [row.titleEn as string, row.titleAr as string] });
    }
    groups.set(row.scopeId, group);
  }
  return [...groups.values()].filter((group) => group.kids.length > 0);
}

/**
 * Every scope this reader may reach, whether or not a memory hangs off it. The explorer
 * hides an empty scope; the create form needs it, otherwise the first memory in an
 * organisation has nowhere to go.
 */
export async function listScopes(scopePaths: string[], personId: string): Promise<{ id: string; n: [string, string] }[]> {
  const rows = await dbRo()
    .select({
      kind: s.memoryScope.kind,
      scopePath: s.memoryScope.path,
      scopePersonId: s.memoryScope.personId,
      unitEn: sql<string | null>`(select u.name_en from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
      unitAr: sql<string | null>`(select u.name_ar from core.org_unit u where u.id = ${outer(s.memoryScope.refId)})`,
      agentEn: sql<string | null>`(select a.name_en from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
      agentAr: sql<string | null>`(select a.name_ar from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`,
      roomKey: sql<string | null>`(select r.key from work.discussion_room r where r.id = ${outer(s.memoryScope.refId)})`,
    })
    .from(s.memoryScope)
    .where(inScopes(scopePaths))
    .orderBy(asc(s.memoryScope.path));

  return rows.map((row) => {
    const base: [string, string] =
      row.kind === "Organisation"
        ? ["Organisation", "الجهة"]
        : row.kind === "BusinessUnit"
          ? [row.unitEn ?? row.scopePath, row.unitAr ?? row.scopePath]
          : row.kind === "Agent"
            ? [row.agentEn ?? row.scopePath, row.agentAr ?? row.scopePath]
            : [row.roomKey ?? row.scopePath, row.roomKey ?? row.scopePath];
    const mine = row.scopePersonId !== null && row.scopePersonId === personId;
    return { id: row.scopePath, n: mine ? privateLabel(base) : base };
  });
}

/**
 * One memory's history, by its full path.
 *
 * The path, not the slug: a private scope per person (D68) means two people's memory
 * under the same agent share a slug, and a `like '%/slug'` match would hand one person
 * the other's change notes.
 */
export async function listVersions(memoryPath: string): Promise<MemoryVersion[]> {
  const rows = await dbRo()
    .select({
      v: s.memoryVersion.versionNumber,
      at: s.memoryVersion.createdAt,
      createdByType: s.memoryVersion.createdByType,
      personId: s.person.id,
      agentCode: s.agent.code,
      note: s.memoryVersion.changeNote,
    })
    .from(s.memoryVersion)
    .innerJoin(s.memory, eq(s.memory.id, s.memoryVersion.memoryId))
    .leftJoin(s.person, eq(s.person.id, s.memoryVersion.createdById))
    .leftJoin(s.agent, eq(s.agent.id, s.memoryVersion.createdById))
    .where(eq(s.memory.path, memoryPath))
    .orderBy(desc(s.memoryVersion.versionNumber));

  return rows.map((row) => ({
    v: row.v,
    at: row.at.toISOString(),
    by: (row.createdByType === "Agent" ? row.agentCode : row.personId) ?? "",
    note: row.note ?? "",
  }));
}

/**
 * The counters, over the same scopes the tree shows: a count of what is hidden is a leak too.
 * `mine` is how many sit in this person's own private scopes (D68).
 */
export async function countMemories(scopePaths: string[], personId: string): Promise<MemoryCounts> {
  const [row] = await dbRo()
    .select({
      total: sql<number>`count(*)::int`,
      mine: sql<number>`count(*) filter (where ${s.memoryScope.personId} = ${personId})::int`,
      pendingReview: sql<number>`count(*) filter (where ${s.memory.status} = 'PendingReview')::int`,
      needsAttention: sql<number>`count(*) filter (where ${s.memory.status} = 'NeedsAttention')::int`,
    })
    .from(s.memory)
    .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
    .where(inScopes(scopePaths));
  const [agents] = await dbRo()
    .select({ count: sql<number>`count(distinct ${s.agentVersion.agentId})::int` })
    .from(s.agentVersion)
    .where(eq(s.agentVersion.memoryEnabled, true));
  return {
    total: row?.total ?? 0,
    pendingReview: row?.pendingReview ?? 0,
    agents: agents?.count ?? 0,
    needsAttention: row?.needsAttention ?? 0,
    mine: row?.mine ?? 0,
  };
}

/**
 * Data model section 13: memory is versioned, never overwritten. Saving writes a new
 * version with its entries and moves the memory's current version to it.
 *
 * `version` is the row's lock (D59), which a review also moves; the number returned is the
 * content version the save created.
 */
export async function saveVersion(path: string, content: string, changeNote: string | null, version: number, personId: string): Promise<number> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.memory)
      // `UC-55.2-03`: a save is not a review, so it does not move "Last reviewed".
      .set({ currentVersion: sql`${s.memory.currentVersion} + 1`, updatedAt: new Date(), updatedBy: personId })
      .where(and(eq(s.memory.path, path), eq(s.memory.version, version)))
      .returning({ id: s.memory.id, currentVersion: s.memory.currentVersion });
    assertWritten(rows, "Memory");

    const [created] = await tx
      .insert(s.memoryVersion)
      .values({
        memoryId: rows[0].id,
        versionNumber: rows[0].currentVersion,
        contentRef: `memory/${path}/${rows[0].currentVersion}.md`,
        content,
        changeNote,
        createdByType: "Person",
        createdById: personId,
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.memoryVersion.id });

    await insertEntries(tx, created.id, content, personId);
    return rows[0].currentVersion;
  });
}

/**
 * The blocks of a version's content, as the detail panel lists them.
 *
 * One place, because a memory written by a person and one written by a run have to break
 * down the same way — a panel that showed entries for one and nothing for the other would
 * be reporting on how it was written rather than on what it says.
 */
async function insertEntries(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  memoryVersionId: string,
  content: string,
  personId: string,
  /** What wrote the blocks, which the Source filter on the screen reads. */
  source: { sourceType: string; sourceRef: string } = { sourceType: "Person", sourceRef: personId },
): Promise<void> {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return;
  await tx.insert(s.memoryEntry).values(
    blocks.map((block) => ({
      memoryVersionId,
      text: block.replace(/^##\s*/, ""),
      ...source,
      createdBy: personId,
      updatedBy: personId,
    })),
  );
}

/** Approves or rejects a memory an agent proposed (data model section 13). */
export async function review(path: string, decision: "Approved" | "Rejected", personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [memory] = await tx.select({ id: s.memory.id }).from(s.memory).where(eq(s.memory.path, path)).limit(1);
    if (!memory) throw new Error(`No memory ${path}.`);
    await tx
      .update(s.memory)
      .set({ status: decision === "Approved" ? "Active" : "Rejected", lastReviewedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.memory.id, memory.id));
    await tx
      .update(s.memoryReview)
      .set({ reviewerPersonId: personId, decision, decidedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.memoryReview.memoryId, memory.id));
  });
}

/* ------------------------------------------------- S-55: creating, comparing and restoring */

/** The content of one version, for a comparison or a restore. */
export async function readVersionContent(path: string, versionNumber: number): Promise<string | null> {
  const [row] = await dbRo()
    .select({ content: s.memoryVersion.content })
    .from(s.memoryVersion)
    .innerJoin(s.memory, eq(s.memory.id, s.memoryVersion.memoryId))
    .where(and(eq(s.memory.path, path), eq(s.memoryVersion.versionNumber, versionNumber)))
    .limit(1);
  return row?.content ?? null;
}

/** The memory as the rules need it: who proposed it, and whether a review is required. */
export async function readForRules(path: string): Promise<{
  id: string;
  status: string;
  currentVersion: number;
  ownerType: string;
  ownerId: string | null;
  scopeKind: string;
  requiresReview: boolean;
  /** `UC-55.2-04`: who proposed the pending version, which may not also approve it. */
  proposedByType: string | null;
  proposedById: string | null;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.memory.id,
      status: s.memory.status,
      currentVersion: s.memory.currentVersion,
      ownerType: s.memory.ownerType,
      ownerId: s.memory.ownerId,
      scopeKind: s.memoryScope.kind,
      policy: s.memory.writePolicyJson,
      proposedByType: sql<string | null>`(
        select v.created_by_type from ai.memory_version v
        where v.memory_id = ${s.memory.id} order by v.version_number desc limit 1
      )`,
      proposedById: sql<string | null>`(
        select v.created_by_id from ai.memory_version v
        where v.memory_id = ${s.memory.id} order by v.version_number desc limit 1
      )`,
    })
    .from(s.memory)
    .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
    .where(eq(s.memory.path, path))
    .limit(1);
  if (!row) return null;
  const policy = (row.policy ?? {}) as { requiresReview?: unknown };
  return {
    id: row.id,
    status: row.status,
    currentVersion: row.currentVersion,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    scopeKind: row.scopeKind,
    requiresReview: policy.requiresReview === true,
    proposedByType: row.proposedByType,
    proposedById: row.proposedById,
  };
}

/** `UC-55.3-06`: a memory of its own, at version 1. */
export async function createMemory(input: {
  scopePath: string;
  titleEn: string;
  titleAr: string;
  path: string;
  content: string;
  requiresReview: boolean;
  personId: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    const [scope] = await tx.select({ id: s.memoryScope.id }).from(s.memoryScope).where(eq(s.memoryScope.path, input.scopePath)).limit(1);
    if (!scope) throw new Error(`No memory scope ${input.scopePath}.`);

    const [created] = await tx
      .insert(s.memory)
      .values({
        scopeId: scope.id,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        path: input.path,
        ownerType: "Person",
        ownerId: input.personId,
        // `UC-55.3-06`: a write policy that requires review means it is not used until
        // somebody approves it.
        status: input.requiresReview ? "PendingReview" : "Active",
        writePolicyJson: { requiresReview: input.requiresReview },
        currentVersion: 1,
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.memory.id });

    const [version] = await tx
      .insert(s.memoryVersion)
      .values({
        memoryId: created.id,
        versionNumber: 1,
        contentRef: `memory/${input.path}/1.md`,
        content: input.content,
        changeNote: "Created.",
        createdByType: "Person",
        createdById: input.personId,
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.memoryVersion.id });
    await insertEntries(tx, version.id, input.content, input.personId);
  });
}

/** Removes a memory entry. Its own versions and reviews cascade with it. */
export async function deleteMemory(path: string): Promise<void> {
  await db().delete(s.memory).where(eq(s.memory.path, path));
}

/** `UC-55.3-05`: a new version carrying an older version's content. */
export async function restoreVersion(path: string, fromVersion: number, personId: string): Promise<number> {
  return db().transaction(async (tx) => {
    const [memory] = await tx
      .select({ id: s.memory.id, currentVersion: s.memory.currentVersion })
      .from(s.memory)
      .where(eq(s.memory.path, path))
      .limit(1);
    if (!memory) throw new Error(`No memory ${path}.`);

    const [source] = await tx
      .select({ content: s.memoryVersion.content })
      .from(s.memoryVersion)
      .where(and(eq(s.memoryVersion.memoryId, memory.id), eq(s.memoryVersion.versionNumber, fromVersion)))
      .limit(1);
    if (!source) throw new Error(`No version ${fromVersion}.`);

    const next = memory.currentVersion + 1;
    const [restored] = await tx
      .insert(s.memoryVersion)
      .values({
        memoryId: memory.id,
        versionNumber: next,
        content: source.content,
        changeNote: `Restored from version ${fromVersion}.`,
        restoredFromVersion: fromVersion,
        createdByType: "Person",
        createdById: personId,
        createdBy: personId,
        updatedBy: personId,
      })
      .returning({ id: s.memoryVersion.id });
    await insertEntries(tx, restored.id, source.content ?? "", personId);
    await tx
      .update(s.memory)
      .set({ currentVersion: next, updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.memory.id, memory.id));
    return next;
  });
}

/**
 * `UC-55.1-07` and D68: the memory scope paths this person may read.
 *
 * Three rules, in order, and the first is absolute:
 *
 * 1. A private scope (`person_id` set) belongs to that person and to nobody else. No
 *    grant widens it — an organisation-wide reader is still not that person. This is
 *    what makes one person's mission memory unreadable in another's (D68).
 * 2. A room's memory belongs to the room's members, not to whoever can reach the org
 *    unit the room's project happens to sit under.
 * 3. Everything else is reachable through the org unit that owns it, as before: the
 *    organisation's own memory to anybody who may read memory at all, a business unit's
 *    directly, a shared agent's through the unit the agent belongs to.
 *
 * `unitIds` is `null` for an organisation-wide grant, which satisfies rule 3 for every
 * shared scope and nothing at all for rules 1 and 2. A scope that is not reachable is
 * absent from the tree rather than shown and refused.
 */
export async function scopePathsVisibleTo(personId: string, unitIds: string[] | null): Promise<string[]> {
  const agentUnit = sql<string | null>`(select a.org_unit_id from ai.agent a where a.id = ${outer(s.memoryScope.refId)})`;
  const roomMember = sql<boolean>`exists (
    select 1 from work.room_participant rp
    where rp.room_id = ${outer(s.memoryScope.refId)}
      and rp.principal_type = 'Person' and rp.principal_id = ${personId}
  )`;
  const rows = await dbRo()
    .select({
      path: s.memoryScope.path,
      kind: s.memoryScope.kind,
      refId: s.memoryScope.refId,
      scopePersonId: s.memoryScope.personId,
      agentUnit,
      roomMember,
    })
    .from(s.memoryScope);

  const reachable = unitIds === null ? null : new Set(unitIds);
  return rows
    .filter((row) => {
      if (row.scopePersonId !== null) return row.scopePersonId === personId;
      if (row.kind === "Organisation") return true;
      if (row.kind === "Session") return row.roomMember;
      if (reachable === null) return true;
      if (row.kind === "BusinessUnit") return row.refId !== null && reachable.has(row.refId);
      if (row.kind === "Agent") return row.agentUnit !== null && reachable.has(row.agentUnit);
      return false;
    })
    .map((row) => row.path);
}

/** The scope a memory hangs off, for the check that the caller may touch it at all. */
export async function scopeOfMemory(path: string): Promise<{ scopePath: string; scopePersonId: string | null } | null> {
  const [row] = await dbRo()
    .select({ scopePath: s.memoryScope.path, scopePersonId: s.memoryScope.personId })
    .from(s.memory)
    .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
    .where(eq(s.memory.path, path))
    .limit(1);
  return row ?? null;
}

/**
 * `memory_search`: the memory a run may read, by what it is looking for.
 *
 * Only Active memories: a proposal waiting for review is not yet something a run should
 * act on, which is the whole point of the review. The scope paths are the run's own, so an
 * agent reads its own memory and the organisation's, not another agent's.
 */
export async function searchMemories(
  term: string,
  scopePaths: string[],
  limit: number,
): Promise<{ path: string; title: string; scope: string; content: string }[]> {
  return dbRo()
    .select({
      path: s.memory.path,
      title: s.memory.titleEn,
      scope: s.memoryScope.path,
      content: sql<string>`coalesce((
        select v.content from ai.memory_version v
        where v.memory_id = ${s.memory.id} and v.version_number = ${s.memory.currentVersion}
      ), '')`,
    })
    .from(s.memory)
    .innerJoin(s.memoryScope, eq(s.memoryScope.id, s.memory.scopeId))
    .where(and(eq(s.memory.status, "Active"), memoryWhere(scopePaths, { q: term })))
    .orderBy(asc(s.memory.path))
    .limit(limit);
}

/**
 * D68: the memory scopes one run may read — the organisation's, its agent's shared
 * scope, and its agent's memory of *this* person. Another person's private scope under
 * the same agent is excluded here, in the query, rather than filtered afterwards.
 */
export async function scopePathsForRun(agentId: string, personId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ path: s.memoryScope.path })
    .from(s.memoryScope)
    .where(
      or(
        and(eq(s.memoryScope.kind, "Organisation"), isNull(s.memoryScope.personId)),
        and(eq(s.memoryScope.refId, agentId), isNull(s.memoryScope.personId)),
        and(eq(s.memoryScope.refId, agentId), eq(s.memoryScope.personId, personId)),
      ),
    );
  return rows.map((row) => row.path);
}

/** The slug of the one memory a run writes into, inside its own (agent, person) scope. */
const REMEMBERED = "remembered";

/** A private memory is bounded: the oldest blocks fall off rather than the content growing without end. */
const REMEMBERED_LIMIT = 20_000;

/**
 * D68: this agent's memory of this person, created on first use.
 *
 * The path is built from the two ids the server already knows, so there is no argument
 * through which a run could name a different one.
 */
export async function ensurePersonalScope(agentId: string, personId: string): Promise<string> {
  const path = `agent/${agentId}/person/${personId}`;
  await db()
    .insert(s.memoryScope)
    .values({ kind: "Agent", refId: agentId, personId, path, createdBy: personId, updatedBy: personId })
    .onConflictDoNothing({ target: s.memoryScope.path });
  return path;
}

/**
 * `memory_write`: one more thing remembered, as a new version of the scope's single
 * memory.
 *
 * The insert and the version bump are one statement, so two concurrent runs for the same
 * person take two version numbers instead of one of them losing its write.
 */
export async function rememberInScope(input: {
  scopePath: string;
  agentId: string;
  personId: string;
  content: string;
}): Promise<{ path: string; version: number }> {
  return db().transaction(async (tx) => {
    const [scope] = await tx
      .select({ id: s.memoryScope.id })
      .from(s.memoryScope)
      .where(eq(s.memoryScope.path, input.scopePath))
      .limit(1);
    if (!scope) throw new Error(`No memory scope ${input.scopePath}.`);

    const path = `${input.scopePath}/${REMEMBERED}`;
    const [row] = await tx
      .insert(s.memory)
      .values({
        scopeId: scope.id,
        titleEn: "Remembered in this agent's runs",
        titleAr: "ما تذكّره هذا الوكيل في عملياتك",
        path,
        ownerType: "Person",
        ownerId: input.personId,
        // D68: nobody else reads this, so there is nobody else to review it. Holding a
        // person's private memory for somebody else's approval would be the leak the
        // scope exists to prevent.
        status: "Active",
        writePolicyJson: { requiresReview: false },
        currentVersion: 1,
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .onConflictDoUpdate({
        target: s.memory.path,
        set: { currentVersion: sql`${s.memory.currentVersion} + 1`, updatedAt: new Date(), updatedBy: input.personId },
      })
      .returning({ id: s.memory.id, currentVersion: s.memory.currentVersion });

    const [previous] = await tx
      .select({ content: s.memoryVersion.content })
      .from(s.memoryVersion)
      .where(and(eq(s.memoryVersion.memoryId, row.id), eq(s.memoryVersion.versionNumber, row.currentVersion - 1)))
      .limit(1);
    const content = appendBlock(previous?.content ?? "", input.content);

    const [created] = await tx
      .insert(s.memoryVersion)
      .values({
        memoryId: row.id,
        versionNumber: row.currentVersion,
        contentRef: `memory/${path}/${row.currentVersion}.md`,
        content,
        changeNote: "Remembered during a run.",
        createdByType: "Agent",
        createdById: input.agentId,
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.memoryVersion.id });

    await insertEntries(tx, created.id, content, input.personId, { sourceType: "AgentRun", sourceRef: input.agentId });
    return { path, version: row.currentVersion };
  });
}

/** The newest block last, and the oldest dropped once the memory would outgrow its bound. */
function appendBlock(existing: string, addition: string): string {
  const blocks = [...existing.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean), addition.trim()];
  while (blocks.length > 1 && blocks.join("\n\n").length > REMEMBERED_LIMIT) blocks.shift();
  return blocks.join("\n\n").slice(0, REMEMBERED_LIMIT);
}

/**
 * D68: everything in this person's own private scopes, and nothing else.
 *
 * The person comes from the session, in the `where`, so there is no argument through
 * which one person clears another's memory.
 */
export async function clearPersonalMemory(personId: string): Promise<number> {
  const scopes = db()
    .select({ id: s.memoryScope.id })
    .from(s.memoryScope)
    .where(eq(s.memoryScope.personId, personId));
  const removed = await db()
    .delete(s.memory)
    .where(inArray(s.memory.scopeId, scopes))
    .returning({ id: s.memory.id });
  return removed.length;
}
