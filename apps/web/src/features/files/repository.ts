import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { db, dbRo, schema as s } from "@/db/client";
import { containsTerm } from "@/db/search";
import { humanSize } from "@/lib/utils";
import type { ProjectItem } from "./types";

/** The only module in `files` that touches Drizzle. */

/** What the Files and Artifacts lists filter on: a project by key and words in the name. */
export type ItemFilters = { project?: string; q?: string };

/** The project and text filters of the two lists, as one condition. */
function itemFilters(projectKey: AnyPgColumn, searchKey: AnyPgColumn, filters: ItemFilters) {
  return and(
    filters.project ? eq(projectKey, filters.project) : undefined,
    filters.q?.trim() ? containsTerm(searchKey, filters.q.trim()) : undefined,
  );
}

const linkedWorkItem = alias(s.workItem, "linked_work_item");
const linkedRoom = alias(s.discussionRoom, "linked_room");
const runAgent = alias(s.agent, "run_agent");

/**
 * One page of the artifacts in the visible projects (`null` means every project), newest
 * first, with the total that match the filters.
 */
export async function listArtifacts(
  visibleIds: string[] | null,
  filters: ItemFilters,
  page: { limit: number; offset: number },
): Promise<{ items: ProjectItem[]; total: number }> {
  const where = and(inVisibleProjects(s.artifact.projectId, visibleIds), itemFilters(s.project.key, s.artifact.searchKey, filters));
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        n: s.artifact.nameEn,
        p: s.project.key,
        producedByType: s.artifact.producedByType,
        producerPerson: s.person.id,
        producerAgent: s.agent.code,
        linkedWorkItem: linkedWorkItem.key,
        linkedRoom: linkedRoom.key,
        size: s.artifactVersion.size,
        st: s.artifact.status,
        mimeType: s.artifactVersion.mimeType,
        runKey: s.run.key,
        runAgent: runAgent.code,
        v: s.artifact.version,
      })
      .from(s.artifact)
      .innerJoin(s.project, eq(s.project.id, s.artifact.projectId))
      .leftJoin(s.person, eq(s.person.id, s.artifact.producedById))
      .leftJoin(s.agent, eq(s.agent.id, s.artifact.producedById))
      .leftJoin(s.artifactVersion, eq(s.artifactVersion.id, s.artifact.currentVersionId))
      .leftJoin(linkedWorkItem, eq(linkedWorkItem.id, s.artifact.linkedToId))
      .leftJoin(linkedRoom, eq(linkedRoom.id, s.artifact.linkedToId))
      .leftJoin(s.run, eq(s.run.id, s.artifact.runId))
      .leftJoin(runAgent, eq(runAgent.id, s.run.agentId))
      .where(where)
      .orderBy(desc(s.artifact.createdAt), desc(s.artifact.id))
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.artifact)
      .innerJoin(s.project, eq(s.project.id, s.artifact.projectId))
      .where(where),
  ]);

  return {
    items: rows.map((row) => ({
      n: row.n,
      s: humanSize(row.size),
      p: row.p,
      w: (row.producedByType === "Agent" ? row.producerAgent : row.producerPerson) ?? "",
      l: row.linkedWorkItem ?? row.linkedRoom ?? undefined,
      st: row.st,
      mimeType: row.mimeType ?? undefined,
      runKey: row.runKey ?? undefined,
      runAgent: row.runAgent ?? undefined,
      v: row.v,
    })),
    total: counted?.total ?? 0,
  };
}

/** Who may use a file: only me, selected people and agents, or everyone in the project. */
const grantNames = sql<string[]>`(
  select coalesce(array_agg(coalesce(p.name_en, a.name_en)), '{}')
  from work.file_access_grant g
  left join core.person p on p.id = g.principal_id
  left join ai.agent a on a.id = g.principal_id
  where g.file_id = ${s.projectFile.id}
)`;

/** The same grants as the scope control names them: a person by id, an agent by its code. */
const grantIds = sql<string[]>`(
  select coalesce(array_agg(coalesce(a.code, g.principal_id::text)), '{}')
  from work.file_access_grant g
  left join ai.agent a on a.id = g.principal_id
  where g.file_id = ${s.projectFile.id}
)`;

/**
 * One page of the project files in the visible projects (`null` means every project) that the
 * scope of use lets this person read, newest first, with their grants as names and as ids and
 * the total that match the filters. The grants are read for the page's rows only.
 */
export async function listFiles(
  visibleIds: string[] | null,
  personId: string,
  filters: ItemFilters,
  page: { limit: number; offset: number },
): Promise<{ items: ProjectItem[]; total: number }> {
  const where = and(
    inVisibleProjects(s.projectFile.projectId, visibleIds),
    readableBy(personId),
    itemFilters(s.project.key, s.projectFile.searchKey, filters),
  );
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        n: s.projectFile.name,
        p: s.project.key,
        uploadedBy: s.projectFile.uploadedBy,
        size: s.projectFile.size,
        scopeOfUse: s.projectFile.scopeOfUse,
        st: s.projectFile.status,
        grants: grantNames,
        grantIds,
        mimeType: s.projectFile.mimeType,
        v: s.projectFile.version,
      })
      .from(s.projectFile)
      .innerJoin(s.project, eq(s.project.id, s.projectFile.projectId))
      .where(where)
      .orderBy(desc(s.projectFile.createdAt), desc(s.projectFile.id))
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.projectFile)
      .innerJoin(s.project, eq(s.project.id, s.projectFile.projectId))
      .where(where),
  ]);

  return {
    items: rows.map((row) => ({
      n: row.n,
      s: humanSize(row.size),
      p: row.p,
      w: row.uploadedBy ?? "",
      scope: row.scopeOfUse,
      st: row.st,
      grants: row.grants ?? [],
      grantIds: row.grantIds ?? [],
      mimeType: row.mimeType ?? undefined,
      v: row.v,
    })),
    total: counted?.total ?? 0,
  };
}

/** One artifact or file as an edit reads it, before the patch is applied. */
export async function readItem(
  name: string,
  kind: "artifact" | "file",
): Promise<{
  id: string;
  projectId: string;
  status: string;
  scopeOfUse: string | null;
  grants: string[];
  version: number;
  /** Who uploaded a project file; null for an artifact. */
  uploadedBy: string | null;
} | null> {
  if (kind === "artifact") {
    const [row] = await dbRo()
      .select({ id: s.artifact.id, projectId: s.artifact.projectId, status: s.artifact.status, version: s.artifact.version })
      .from(s.artifact)
      .where(eq(s.artifact.nameEn, name))
      .limit(1);
    return row ? { ...row, scopeOfUse: null, grants: [], uploadedBy: null } : null;
  }
  const [row] = await dbRo()
    .select({
      id: s.projectFile.id,
      projectId: s.projectFile.projectId,
      status: s.projectFile.status,
      scopeOfUse: s.projectFile.scopeOfUse,
      version: s.projectFile.version,
      uploadedBy: s.projectFile.uploadedBy,
    })
    .from(s.projectFile)
    .where(eq(s.projectFile.name, name))
    .limit(1);
  if (!row) return null;
  // Read separately rather than as a correlated subquery: the list's own fragment
  // correlates against the row the list joins, and there is no join here to correlate to.
  const grants = await dbRo()
    .select({ name: sql<string>`coalesce(${s.person.nameEn}, ${s.agent.nameEn})` })
    .from(s.fileAccessGrant)
    .leftJoin(s.person, eq(s.person.id, s.fileAccessGrant.principalId))
    .leftJoin(s.agent, eq(s.agent.id, s.fileAccessGrant.principalId))
    .where(eq(s.fileAccessGrant.fileId, row.id));
  return { ...row, grants: grants.map((grant) => grant.name).filter(Boolean) };
}

/**
 * The one write path for an artifact or a project file, with the version in the `WHERE`.
 *
 * Specification section 9: scope of use decides who may read a file, and the grants name
 * them when the scope is `Selected`. The grants are replaced, never merged, so an edit
 * that names a shorter list takes the principals left out off the file.
 *
 * Returns false when no row is at `expectedVersion`, which is a concurrent save.
 */
export async function updateItem(
  id: string,
  kind: "artifact" | "file",
  expectedVersion: number,
  patch: { active?: boolean; scopeOfUse?: string; grants?: string[] },
  personId: string,
): Promise<boolean> {
  const status = patch.active === undefined ? undefined : patch.active ? "Active" : "Inactive";

  if (kind === "artifact") {
    const rows = await db()
      .update(s.artifact)
      .set({ ...(status === undefined ? {} : { status }), updatedAt: new Date(), updatedBy: personId })
      .where(and(eq(s.artifact.id, id), eq(s.artifact.version, expectedVersion)))
      .returning({ id: s.artifact.id });
    return rows.length > 0;
  }

  return db().transaction(async (tx) => {
    const rows = await tx
      .update(s.projectFile)
      .set({
        ...(status === undefined ? {} : { status }),
        ...(patch.scopeOfUse === undefined ? {} : { scopeOfUse: patch.scopeOfUse }),
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.projectFile.id, id), eq(s.projectFile.version, expectedVersion)))
      .returning({ id: s.projectFile.id });
    if (rows.length === 0) return false;
    const fileId = rows[0].id;

    if (patch.grants) {
      await tx.delete(s.fileAccessGrant).where(eq(s.fileAccessGrant.fileId, fileId));
      const scope = patch.scopeOfUse ?? (await tx
        .select({ scope: s.projectFile.scopeOfUse })
        .from(s.projectFile)
        .where(eq(s.projectFile.id, fileId))
        .limit(1))[0]?.scope;
      if (scope === "Selected" && patch.grants.length > 0) {
        const people = await tx.select({ id: s.person.id }).from(s.person);
        const agents = await tx.select({ id: s.agent.id, code: s.agent.code }).from(s.agent);
        const grantRows = patch.grants
          .map((grant) => {
            const agent = agents.find((candidate) => candidate.code === grant);
            if (agent) return { fileId, principalType: "Agent", principalId: agent.id };
            const person = people.find((candidate) => candidate.id === grant);
            return person ? { fileId, principalType: "Person", principalId: person.id } : null;
          })
          .filter((row): row is { fileId: string; principalType: string; principalId: string } => row !== null);
        if (grantRows.length > 0) await tx.insert(s.fileAccessGrant).values(grantRows);
      }
    }
    return true;
  });
}

/** An id no row has, so "visible: none" selects nothing rather than everything. */
const NO_PROJECT = "00000000-0000-0000-0000-000000000000";

const inVisibleProjects = (column: AnyPgColumn, visibleIds: string[] | null) =>
  visibleIds === null ? undefined : inArray(column, visibleIds.length > 0 ? visibleIds : [NO_PROJECT]);

/**
 * `UC-33.1-02`, `-03` and `-06`: who may read one file.
 *
 * Expressed as SQL rather than filtered afterwards, so a file outside a person's scope is
 * never selected, never counted and never sent to a browser. `AllProject` is everyone who
 * can see the project at all, which the project membership already decides.
 */
const readableBy = (personId: string) => sql`(
  ${s.projectFile.scopeOfUse} = 'AllProject'
  or (${s.projectFile.scopeOfUse} = 'OnlyMe' and ${s.projectFile.uploadedBy} = ${personId})
  or (${s.projectFile.scopeOfUse} = 'Selected' and exists (
    select 1 from work.file_access_grant g
    where g.file_id = ${s.projectFile.id} and g.principal_id = ${personId}
  ))
)`;

/** Whether one principal — a person or an agent — may read a file (`UC-33.1-06`). */
export async function fileReadableBy(name: string, principalId: string): Promise<boolean> {
  const { rows } = await dbRo().execute<{ allowed: boolean }>(sql`
    select (
      f.scope_of_use = 'AllProject'
      or (f.scope_of_use = 'OnlyMe' and f.uploaded_by = ${principalId})
      or (f.scope_of_use = 'Selected' and exists (
        select 1 from work.file_access_grant g where g.file_id = f.id and g.principal_id = ${principalId}
      ))
    ) as allowed
    from work.project_file f where f.name = ${name} limit 1
  `);
  return rows[0]?.allowed ?? false;
}

/** Where the bytes of one file or artifact live, and what they are. */
export type StoredContent = { projectId: string; contentRef: string; mimeType: string; size: number; status: string };

/**
 * Where a file's or an artifact's bytes are stored, found by name, with their type, size and
 * status; null when nothing has that name. Checks no permission.
 */
export async function contentOf(name: string, kind: "artifact" | "file"): Promise<StoredContent | null> {
  if (kind === "file") {
    const [row] = await dbRo()
      .select({
        projectId: s.projectFile.projectId,
        contentRef: s.projectFile.contentRef,
        mimeType: s.projectFile.mimeType,
        size: s.projectFile.size,
        status: s.projectFile.status,
      })
      .from(s.projectFile)
      .where(eq(s.projectFile.name, name))
      .limit(1);
    return row ?? null;
  }

  // An artifact's bytes belong to the version it currently points at.
  const [row] = await dbRo()
    .select({
      projectId: s.artifact.projectId,
      contentRef: s.artifactVersion.contentRef,
      mimeType: s.artifactVersion.mimeType,
      size: s.artifactVersion.size,
      status: s.artifact.status,
    })
    .from(s.artifact)
    .innerJoin(s.artifactVersion, eq(s.artifactVersion.id, s.artifact.currentVersionId))
    .where(eq(s.artifact.nameEn, name))
    .limit(1);
  return row ?? null;
}

/** A file or an artifact the platform holds, as an attachment picker lists it. */
export type HeldItem = { id: string; kind: "File" | "Artifact"; name: string; project: string; size: number; mimeType: string };

/**
 * The files or artifacts one person may read whose name matches, newest first. Applies the
 * same project visibility and scope of use as the Files and Artifacts screens, in the query.
 */
export async function searchHeld(
  kind: "File" | "Artifact",
  term: string,
  visibleIds: string[] | null,
  personId: string,
  limit: number,
): Promise<HeldItem[]> {
  const match = term.trim()
    ? (column: AnyPgColumn) => containsTerm(column, term.trim())
    : () => sql`true`;
  if (kind === "File") {
    const rows = await dbRo()
      .select({
        id: s.projectFile.id,
        name: s.projectFile.name,
        project: s.project.key,
        size: s.projectFile.size,
        mimeType: s.projectFile.mimeType,
      })
      .from(s.projectFile)
      .innerJoin(s.project, eq(s.project.id, s.projectFile.projectId))
      .where(
        and(
          inVisibleProjects(s.projectFile.projectId, visibleIds),
          readableBy(personId),
          eq(s.projectFile.status, "Active"),
          match(s.projectFile.searchKey),
        ),
      )
      .orderBy(desc(s.projectFile.createdAt))
      .limit(limit);
    return rows.map((row) => ({ ...row, kind: "File" as const }));
  }
  const rows = await dbRo()
    .select({
      id: s.artifact.id,
      name: s.artifact.nameEn,
      project: s.project.key,
      size: s.artifactVersion.size,
      mimeType: s.artifactVersion.mimeType,
    })
    .from(s.artifact)
    .innerJoin(s.project, eq(s.project.id, s.artifact.projectId))
    .innerJoin(s.artifactVersion, eq(s.artifactVersion.id, s.artifact.currentVersionId))
    .where(and(inVisibleProjects(s.artifact.projectId, visibleIds), eq(s.artifact.status, "Active"), match(s.artifact.searchKey)))
    .orderBy(desc(s.artifact.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, kind: "Artifact" as const }));
}

/** One held item a person may read, with where its bytes are; null when they may not. */
export async function readableHeld(
  kind: "File" | "Artifact",
  id: string,
  visibleIds: string[] | null,
  personId: string,
): Promise<{ name: string; contentRef: string; size: number; mimeType: string } | null> {
  if (kind === "File") {
    const [row] = await dbRo()
      .select({ name: s.projectFile.name, contentRef: s.projectFile.contentRef, size: s.projectFile.size, mimeType: s.projectFile.mimeType })
      .from(s.projectFile)
      .where(
        and(
          eq(s.projectFile.id, id),
          inVisibleProjects(s.projectFile.projectId, visibleIds),
          readableBy(personId),
          eq(s.projectFile.status, "Active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const [row] = await dbRo()
    .select({ name: s.artifact.nameEn, contentRef: s.artifactVersion.contentRef, size: s.artifactVersion.size, mimeType: s.artifactVersion.mimeType })
    .from(s.artifact)
    .innerJoin(s.artifactVersion, eq(s.artifactVersion.id, s.artifact.currentVersionId))
    .where(and(eq(s.artifact.id, id), inVisibleProjects(s.artifact.projectId, visibleIds), eq(s.artifact.status, "Active")))
    .limit(1);
  return row ?? null;
}

/** The item an attachment hangs off, and the project that decides who may see it. */
export async function attachmentOwner(
  ownerType: "Request" | "WorkItem" | "Room",
  ownerKey: string,
): Promise<{ id: string; projectId: string } | null> {
  const table = ownerType === "Request" ? s.request : ownerType === "WorkItem" ? s.workItem : s.discussionRoom;
  const [row] = await dbRo().select({ id: table.id, projectId: table.projectId }).from(table).where(eq(table.key, ownerKey)).limit(1);
  return row ?? null;
}

/** The item an artifact may be linked to — a room reaches `discussionRoom` too, which an
 * attachment never does, so this is its own lookup rather than a shared one. */
export async function linkedToOwner(type: string, key: string): Promise<{ id: string; projectId: string; projectKey: string } | null> {
  const table = type === "WorkItem" ? s.workItem : type === "Request" ? s.request : s.discussionRoom;
  const [row] = await dbRo()
    .select({ id: table.id, projectId: s.project.id, projectKey: s.project.key })
    .from(table)
    .innerJoin(s.project, eq(s.project.id, table.projectId))
    .where(eq(table.key, key))
    .limit(1);
  return row ?? null;
}

/** A project's id from its key, or null when no project has it. */
export async function projectIdByKey(projectKey: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, projectKey)).limit(1);
  return row?.id ?? null;
}

/**
 * `UC-32.1-01`: a new artifact, at its first version.
 *
 * An artifact's own insert and its first version are one transaction: a row with no
 * current version is one the Artifacts screen can never show content for.
 */
export async function insertArtifact(input: {
  projectId: string;
  titleEn: string;
  titleAr: string;
  producedByType: string;
  producedById: string | null;
  runId: string | null;
  linkedToType: string | null;
  linkedToId: string | null;
  contentRef: string;
  size: number;
  mimeType: string;
  actedBy: string;
}): Promise<{ id: string }> {
  return db().transaction(async (tx) => {
    const [created] = await tx
      .insert(s.artifact)
      .values({
        projectId: input.projectId,
        nameEn: input.titleEn,
        nameAr: input.titleAr,
        producedByType: input.producedByType,
        producedById: input.producedById,
        runId: input.runId,
        linkedToType: input.linkedToType,
        linkedToId: input.linkedToId,
        status: "Active",
        createdBy: input.actedBy,
        updatedBy: input.actedBy,
      })
      .returning({ id: s.artifact.id });

    const [version] = await tx
      .insert(s.artifactVersion)
      .values({
        artifactId: created.id,
        versionNumber: 1,
        contentRef: input.contentRef,
        size: input.size,
        mimeType: input.mimeType,
        createdBy: input.actedBy,
        updatedBy: input.actedBy,
      })
      .returning({ id: s.artifactVersion.id });

    await tx.update(s.artifact).set({ currentVersionId: version.id }).where(eq(s.artifact.id, created.id));
    return { id: created.id };
  });
}

/**
 * Artifacts linked to one item, created no earlier than `since`.
 *
 * What a run that just finished produced and linked here — the reply a room or a work item
 * gets back names one of these, which is what turns "an artifact exists" into something a
 * person can actually open from where the agent said it put it.
 */
export async function artifactsLinkedSince(
  linkedToType: string,
  linkedToId: string,
  since: Date,
): Promise<{ nameEn: string }[]> {
  return dbRo()
    .select({ nameEn: s.artifact.nameEn })
    .from(s.artifact)
    .where(
      and(
        eq(s.artifact.linkedToType, linkedToType),
        eq(s.artifact.linkedToId, linkedToId),
        gte(s.artifact.createdAt, since),
      ),
    )
    .orderBy(asc(s.artifact.createdAt));
}

/** Records one attachment on a request, work item or room whose bytes are already stored. */
export async function insertAttachment(input: {
  ownerType: string;
  ownerId: string;
  fileName: string;
  contentRef: string;
  size: number;
  mimeType: string;
  uploadedBy: string;
}): Promise<void> {
  await db().insert(s.attachment).values({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    fileName: input.fileName,
    contentRef: input.contentRef,
    size: input.size,
    mimeType: input.mimeType,
    uploadedBy: input.uploadedBy,
    createdBy: input.uploadedBy,
    updatedBy: input.uploadedBy,
  });
}

/** One attachment's bytes, found by the item it hangs off and its file name. */
export async function attachmentContentOf(
  ownerId: string,
  fileName: string,
): Promise<{ contentRef: string; mimeType: string; size: number } | null> {
  const [row] = await dbRo()
    .select({ contentRef: s.attachment.contentRef, mimeType: s.attachment.mimeType, size: s.attachment.size })
    .from(s.attachment)
    .where(and(eq(s.attachment.ownerId, ownerId), eq(s.attachment.fileName, fileName)))
    .limit(1);
  return row ?? null;
}

export type NewProjectFile = {
  projectKey: string;
  name: string;
  contentRef: string;
  size: number;
  mimeType: string;
  scopeOfUse: string;
  status: string;
  grants: string[];
  uploadedBy: string;
};

/**
 * The principal ids behind the identifiers a scope names: a person's id or an agent's code.
 *
 * Resolved before the write, so a grant naming something that does not exist is dropped
 * rather than failing the whole upload.
 */
export async function resolveGrants(grants: string[]): Promise<{ principalType: string; principalId: string }[]> {
  if (grants.length === 0) return [];
  const [people, agents] = await Promise.all([
    dbRo().select({ id: s.person.id }).from(s.person),
    dbRo().select({ id: s.agent.id, code: s.agent.code }).from(s.agent),
  ]);
  return grants
    .map((grant) => {
      const agent = agents.find((candidate) => candidate.code === grant);
      if (agent) return { principalType: "Agent", principalId: agent.id };
      const person = people.find((candidate) => candidate.id === grant);
      return person ? { principalType: "Person", principalId: person.id } : null;
    })
    .filter((row): row is { principalType: string; principalId: string } => row !== null);
}

/** Stores an uploaded file and the grants that go with its scope, in one transaction. Its id. */
export async function insertFile(input: NewProjectFile): Promise<string> {
  const resolved = await resolveGrants(input.grants);
  return db().transaction(async (tx) => {
    const [project] = await tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.projectKey)).limit(1);
    if (!project) throw new Error(`No project ${input.projectKey}.`);
    const [created] = await tx
      .insert(s.projectFile)
      .values({
        projectId: project.id,
        name: input.name,
        contentRef: input.contentRef,
        size: input.size,
        mimeType: input.mimeType,
        uploadedBy: input.uploadedBy,
        scopeOfUse: input.scopeOfUse,
        status: input.status,
        createdBy: input.uploadedBy,
        updatedBy: input.uploadedBy,
      })
      .returning({ id: s.projectFile.id });

    if (input.scopeOfUse === "Selected" && resolved.length > 0) {
      await tx.insert(s.fileAccessGrant).values(resolved.map((row) => ({ ...row, fileId: created.id })));
    }
    return created.id;
  });
}

/**
 * `UC-32.1-05`: remove an artifact or a file from its project.
 *
 * The row goes; the audit entry naming it stays, because the audit log is append-only and
 * is the record that it once existed.
 */
export async function deleteItem(id: string, kind: "artifact" | "file"): Promise<boolean> {
  const rows =
    kind === "artifact"
      ? await db().delete(s.artifact).where(eq(s.artifact.id, id)).returning({ id: s.artifact.id })
      : await db().delete(s.projectFile).where(eq(s.projectFile.id, id)).returning({ id: s.projectFile.id });
  return rows.length > 0;
}

/** A file or artifact by name and the project it belongs to, for the permission check before a write. */
export async function projectOf(
  name: string,
  kind: "artifact" | "file",
): Promise<{ id: string; projectId: string; key: string } | null> {
  const [row] =
    kind === "artifact"
      ? await dbRo()
          .select({ id: s.artifact.id, projectId: s.project.id, key: s.project.key })
          .from(s.artifact)
          .innerJoin(s.project, eq(s.project.id, s.artifact.projectId))
          .where(eq(s.artifact.nameEn, name))
          .limit(1)
      : await dbRo()
          .select({ id: s.projectFile.id, projectId: s.project.id, key: s.project.key })
          .from(s.projectFile)
          .innerJoin(s.project, eq(s.project.id, s.projectFile.projectId))
          .where(eq(s.projectFile.name, name))
          .limit(1);
  return row ?? null;
}
