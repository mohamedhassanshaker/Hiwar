import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm } from "@/db/search";
import { selectPrincipalByCode } from "@/db/queries/identity";
import { finalStatus, insertUpdateItems, NO_NOTICES, queueAlertEmails, queueFinishedNotices } from "@/db/queries/mail";
import { insertWorkItem, type NewWorkItem } from "@/db/queries/work-items";
import { dayAfter, dayStart } from "@/lib/paging";
import { humanSize } from "@/lib/utils";
import { assertWritten } from "@/lib/concurrency";
import type { ScreenId } from "@/lib/routes";
import { announce } from "@/lib/notify";
import { enqueueMailJobs } from "@/lib/valkey";
import type { SubItem, Task, WorkItemDetail, WorkItemFilters, WorkItemInquiry, WorkItemInquiryRow, WorkItemReportFacts } from "./types";

/** The only module in `work-items` that touches Drizzle. */

/** Specification section 7.4: open work that is high priority, blocked, or due within two days. */
const isHot = sql<boolean>`(
  ${s.workItem.status} <> 'Done'
  and (${s.workItem.priority} = 'High'
    or ${s.workItem.status} = 'Blocked'
    or (${s.workItem.dueAt} is not null and ${s.workItem.dueAt} <= now() + interval '2 days'))
)`;

const taskColumns = {
  id: s.workItem.id,
  k: s.workItem.key,
  p: s.project.key,
  t: s.workItem.titleEn,
  tAr: s.workItem.titleAr,
  type: s.workItem.type,
  st: s.workItem.status,
  assigneeType: s.workItem.assigneeType,
  assigneePerson: s.person.id,
  assigneeAgent: s.agent.code,
  pri: s.workItem.priority,
  dueAt: s.workItem.dueAt,
  hot: isHot,
  version: s.workItem.version,
  fromComment: s.workItem.originType,
};

/** A work item row as a board card: the assignee as an agent code or a person id, the due date as ISO. */
function toTask(row: {
  k: string;
  p: string;
  t: string;
  tAr: string;
  type: string;
  st: string;
  assigneeType: string;
  assigneePerson: string | null;
  assigneeAgent: string | null;
  pri: string;
  dueAt: Date | null;
  hot: boolean;
  version: number;
  fromComment: string;
}, subs: { sub: number; done: number } | undefined): Task {
  return {
    k: row.k,
    p: row.p,
    t: row.t,
    tAr: row.tAr,
    type: row.type,
    st: row.st,
    who: row.assigneeType === "Agent" ? row.assigneeAgent : row.assigneeType === "Person" ? row.assigneePerson : null,
    pri: row.pri,
    dueAt: row.dueAt?.toISOString() ?? null,
    sub: subs?.sub ?? 0,
    done: subs?.done ?? 0,
    hot: row.hot,
    version: row.version,
    fromComment: row.fromComment === "Comment",
  };
}

/**
 * The work items a person sees: those in the projects they may read (`visibleIds`, `null` for
 * every project), and outside them the ones they are the assignee, reviewer or creator of.
 */
function visibleTo(visibleIds: string[] | null, personId: string): SQL {
  if (visibleIds === null) return sql`true`;
  return or(
    visibleIds.length > 0 ? inArray(s.workItem.projectId, visibleIds) : sql`false`,
    and(eq(s.workItem.assigneeType, "Person"), eq(s.workItem.assigneeId, personId)),
    eq(s.workItem.reviewerId, personId),
    eq(s.workItem.createdBy, personId),
  ) as SQL;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The items the person sees (`visibleTo`) that match the filters, over the screen's joins. */
function matching(visibleIds: string[] | null, personId: string, filters: WorkItemFilters): SQL | undefined {
  const assignee = filters.assignee;
  return and(
    visibleTo(visibleIds, personId),
    filters.key ? eq(s.workItem.key, filters.key) : undefined,
    filters.scope === "hot" ? isHot : filters.scope === "comments" ? eq(s.workItem.originType, "Comment") : undefined,
    filters.q ? containsTerm(s.workItem.searchKey, filters.q) : undefined,
    filters.projectKey ? eq(s.project.key, filters.projectKey) : undefined,
    filters.type ? eq(s.workItem.type, filters.type) : undefined,
    filters.status ? eq(s.workItem.status, filters.status) : undefined,
    filters.priority ? eq(s.workItem.priority, filters.priority) : undefined,
    assignee === "none"
      ? eq(s.workItem.assigneeType, "None")
      : assignee && UUID.test(assignee)
        ? and(eq(s.workItem.assigneeType, "Person"), eq(s.workItem.assigneeId, assignee))
        : assignee
          ? and(eq(s.workItem.assigneeType, "Agent"), eq(s.agent.code, assignee))
          : undefined,
    filters.open ? sql`${s.workItem.status} not in ('Done', 'Cancelled')` : undefined,
    filters.dueFrom ? sql`${s.workItem.dueAt} >= ${filters.dueFrom}` : undefined,
    filters.dueBefore ? sql`${s.workItem.dueAt} < ${filters.dueBefore}` : undefined,
  );
}

/** How many sub items each of these work items has, and how many of them are done. */
async function subCountsOf(ids: string[]): Promise<Map<string, { sub: number; done: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await dbRo()
    .select({
      parentId: s.workItem.parentWorkItemId,
      sub: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${s.workItem.status} = 'Done'))::int`,
    })
    .from(s.workItem)
    .where(inArray(s.workItem.parentWorkItemId, ids))
    .groupBy(s.workItem.parentWorkItemId);
  return new Map(rows.map((row) => [row.parentId ?? "", { sub: row.sub, done: row.done }]));
}

/**
 * One page of the work items the person sees that match the filters, newest first or soonest
 * due first, as board cards, with how many match (D349). Sub item counts are read for the
 * page's items only.
 */
export async function listWorkItemPage(
  visibleIds: string[] | null,
  personId: string,
  filters: WorkItemFilters,
  page: { limit: number; offset: number; order?: "newest" | "due" },
): Promise<{ rows: Task[]; total: number }> {
  const where = matching(visibleIds, personId, filters);
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select(taskColumns)
      .from(s.workItem)
      .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
      .leftJoin(s.person, eq(s.person.id, s.workItem.assigneeId))
      .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
      .where(where)
      .orderBy(
        ...(page.order === "due" ? [sql`${s.workItem.dueAt} asc nulls last`] : []),
        desc(s.workItem.createdAt),
        desc(s.workItem.key),
      )
      .limit(page.limit)
      .offset(page.offset),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.workItem)
      .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
      .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
      .where(where),
  ]);
  const subs = await subCountsOf(rows.map((row) => row.id));
  return { rows: rows.map((row) => toTask(row, subs.get(row.id))), total: counted?.total ?? 0 };
}

/** How many work items the person sees are hot, raised from a comment, and in all (the screen's scope chips). */
export async function countScopes(visibleIds: string[] | null, personId: string): Promise<{ hot: number; comments: number; all: number }> {
  const [row] = await dbRo()
    .select({
      hot: sql<number>`(count(*) filter (where ${isHot}))::int`,
      comments: sql<number>`(count(*) filter (where ${s.workItem.originType} = 'Comment'))::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(s.workItem)
    .where(visibleTo(visibleIds, personId));
  return row ?? { hot: 0, comments: 0, all: 0 };
}

/** Which screen shows a work item's origin. */
const ORIGIN_SCREEN: Record<string, ScreenId> = {
  Request: "requests",
  Room: "session",
  Schedule: "routines",
  // A comment's conversation is read in the Inbox, under Quick Requests.
  Comment: "inbox",
};

/** What converting a work item into a discussion room posts on its board. */
export type WorkItemRoomSummary = {
  id: string;
  titleEn: string;
  titleAr: string;
  descEn: string | null;
  status: string;
  priority: string;
  projectKey: string;
};

/**
 * The work item's title, description, status, priority and project for a room raised from it, or
 * null when no item has the key or the person does not see it (`visibleTo`).
 */
export async function workItemRoomSummary(key: string, visibleIds: string[] | null, personId: string): Promise<WorkItemRoomSummary | null> {
  const [row] = await dbRo()
    .select({
      id: s.workItem.id,
      titleEn: s.workItem.titleEn,
      titleAr: s.workItem.titleAr,
      descEn: s.workItem.descriptionEn,
      status: s.workItem.status,
      priority: s.workItem.priority,
      projectKey: s.project.key,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(and(eq(s.workItem.key, key), visibleTo(visibleIds, personId)))
    .limit(1);
  return row ?? null;
}

/**
 * The drawer's detail for each work item key: request type, origin, reviewer, description,
 * parent, attributes, sub items, activity in time order, attachments and linked artifacts, and
 * the comment it was raised from. Keys that name no item are absent from the result.
 */
export async function readDetails(keys: string[]): Promise<Record<string, WorkItemDetail>> {
  if (keys.length === 0) return {};
  const rows = await dbRo()
    .select({
      id: s.workItem.id,
      key: s.workItem.key,
      reviewerPerson: s.workItem.reviewerId,
      description: s.workItem.descriptionEn,
      attributes: s.workItem.attributes,
      originType: s.workItem.originType,
      requestKey: s.request.key,
      roomKey: s.discussionRoom.key,
      scheduleTitle: s.scheduledWorkItem.titleEn,
      parentKey: sql<string | null>`(select p.key from work.work_item p where p.id = ${outer(s.workItem.parentWorkItemId)})`,
      requestTypeEn: s.requestType.nameEn,
      requestTypeAr: s.requestType.nameAr,
      requestTypeVersion: s.requestTypeVersion.versionNumber,
      // Handoff v2 section 7: what the comment said, and which card it was said on.
      commentId: s.cardComment.id,
      commentCard: s.cardCommentThread.cardId,
      commentText: s.cardComment.bodyText,
      commentCapture: s.cardComment.captureRef,
    })
    .from(s.workItem)
    .leftJoin(s.request, eq(s.request.id, s.workItem.requestId))
    .leftJoin(s.cardComment, sql`${s.cardComment.id} = ${s.workItem.originId} and ${s.workItem.originType} = 'Comment'`)
    .leftJoin(s.cardCommentThread, eq(s.cardCommentThread.id, s.cardComment.threadId))
    .leftJoin(s.discussionRoom, sql`${s.discussionRoom.id} = ${s.workItem.originId} and ${s.workItem.originType} = 'Room'`)
    .leftJoin(s.scheduledWorkItem, sql`${s.scheduledWorkItem.id} = ${s.workItem.originId} and ${s.workItem.originType} = 'Schedule'`)
    .leftJoin(s.requestTypeVersion, eq(s.requestTypeVersion.id, s.request.requestTypeVersionId))
    .leftJoin(s.requestType, eq(s.requestType.id, s.requestTypeVersion.requestTypeId))
    .where(inArray(s.workItem.key, keys));

  const ids = rows.map((row) => row.id);

  const subs = ids.length
    ? await dbRo()
        .select({
          parentId: s.workItem.parentWorkItemId,
          key: s.workItem.key,
          titleEn: s.workItem.titleEn,
          titleAr: s.workItem.titleAr,
          status: s.workItem.status,
          assigneeType: s.workItem.assigneeType,
          assigneePerson: s.person.id,
          assigneeAgent: s.agent.code,
        })
        .from(s.workItem)
        .leftJoin(s.person, eq(s.person.id, s.workItem.assigneeId))
        .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
        .where(inArray(s.workItem.parentWorkItemId, ids))
        .orderBy(asc(s.workItem.key))
    : [];

  const activity = ids.length
    ? await dbRo()
        .select({
          workItemId: s.workItemActivity.workItemId,
          actorType: s.workItemActivity.actorType,
          actorPerson: s.person.id,
          actorAgent: s.agent.code,
          detailEn: s.workItemActivity.detailEn,
          detailAr: s.workItemActivity.detailAr,
          at: s.workItemActivity.at,
        })
        .from(s.workItemActivity)
        .leftJoin(s.person, eq(s.person.id, s.workItemActivity.actorId))
        .leftJoin(s.agent, eq(s.agent.id, s.workItemActivity.actorId))
        .where(inArray(s.workItemActivity.workItemId, ids))
        .orderBy(asc(s.workItemActivity.at))
    : [];

  const attachments = ids.length
    ? await dbRo()
        .select({ ownerId: s.attachment.ownerId, fileName: s.attachment.fileName, size: s.attachment.size })
        .from(s.attachment)
        .where(inArray(s.attachment.ownerId, ids))
    : [];

  const artifacts = ids.length
    ? await dbRo()
        .select({ linkedToId: s.artifact.linkedToId, name: s.artifact.nameEn, size: s.artifactVersion.size })
        .from(s.artifact)
        .leftJoin(s.artifactVersion, eq(s.artifactVersion.id, s.artifact.currentVersionId))
        .where(inArray(s.artifact.linkedToId, ids))
    : [];

  const result: Record<string, WorkItemDetail> = {};
  for (const row of rows) {
    // The origin's label and the screen that opens it; a comment is named `q:<card>` for the Inbox.
    const origin: [string, ScreenId] | null =
      row.originType === "Request" && row.requestKey
        ? [row.requestKey, ORIGIN_SCREEN.Request]
        : row.originType === "Room" && row.roomKey
          ? [row.roomKey, ORIGIN_SCREEN.Room]
          : row.originType === "Schedule" && row.scheduleTitle
            ? [row.scheduleTitle, ORIGIN_SCREEN.Schedule]
            : row.originType === "Comment" && row.commentCard
              ? [`q:${row.commentCard}`, ORIGIN_SCREEN.Comment]
              : null;

    result[row.key] = {
      rt: [row.requestTypeEn ?? "—", row.requestTypeAr ?? "—"],
      org: origin,
      rev: row.reviewerPerson ?? "",
      sch: row.requestTypeEn ? `${row.requestTypeEn} v${row.requestTypeVersion}` : "—",
      desc: row.description,
      parent: row.parentKey ?? undefined,
      at: Object.entries((row.attributes as Record<string, unknown>) ?? {}).map(([key, value]) => [key, String(value)]),
      subs: subs
        .filter((sub) => sub.parentId === row.id)
        .map<SubItem>((sub) => [
          sub.key,
          sub.titleEn,
          sub.titleAr,
          (sub.assigneeType === "Agent" ? sub.assigneeAgent : sub.assigneePerson) ?? "",
          sub.status === "Done" ? 1 : undefined,
        ]),
      act: activity
        .filter((entry) => entry.workItemId === row.id)
        .map<[string, string, string]>((entry) => [
          (entry.actorType === "Agent" ? entry.actorAgent : entry.actorPerson) ?? "",
          entry.detailEn ?? "",
          entry.detailAr ?? "",
        ]),
      attachments: [
        ...attachments
          .filter((file) => file.ownerId === row.id)
          .map<WorkItemDetail["attachments"][number]>((file) => [file.fileName, humanSize(file.size), "attachment"]),
        ...artifacts
          .filter((file) => file.linkedToId === row.id)
          .map<WorkItemDetail["attachments"][number]>((file) => [file.name, humanSize(file.size), "artifact"]),
      ],
      comment:
        row.commentId && row.commentCard
          ? {
              card: row.commentCard,
              text: row.commentText ?? "",
              captureUrl: row.commentCapture ? `/api/comments/capture?comment=${encodeURIComponent(row.commentId)}` : null,
            }
          : null,
    };
  }
  return result;
}

export type { NewWorkItem };

/**
 * Creates a work item and its "Created" activity row in one transaction.
 *
 * The primitive itself lives in `src/db/queries/work-items.ts`: raising a work item is no
 * longer only this module's business — handoff v2's "Make it a task" raises one from a
 * dashboard comment — and the alternative was for the comments module to reach into this
 * repository or to write the row a second way.
 */
export const createWorkItem = insertWorkItem;

/**
 * Applies one patch to a work item, all of it or none.
 *
 * `COM-10`: the version the caller read is in the `WHERE`, so a card moved on another
 * screen since is refused rather than overwritten; `awp_version_bump` moves the version
 * on. A status change writes its own activity row, because the history of an item is how
 * the drawer says who moved it and when.
 *
 * @returns false when no row matched the version, which the caller reports as a stale read.
 */
export async function updateWorkItem(
  key: string,
  expectedVersion: number,
  patch: {
    titleEn?: string;
    titleAr?: string;
    descriptionEn?: string | null;
    priority?: string;
    dueAt?: Date | null;
    status?: string;
  },
  personId: string,
  /** Who the status change names, when it is not the person: the agent that made the call. */
  actor?: { actorType: string; actorId: string },
): Promise<boolean> {
  const outcome = await db().transaction(async (tx) => {
    const [before] = await tx.select({ status: s.workItem.status }).from(s.workItem).where(eq(s.workItem.key, key)).for("update");
    const rows = await tx
      .update(s.workItem)
      .set({
        ...(patch.titleEn === undefined ? {} : { titleEn: patch.titleEn }),
        ...(patch.titleAr === undefined ? {} : { titleAr: patch.titleAr }),
        ...(patch.descriptionEn === undefined ? {} : { descriptionEn: patch.descriptionEn }),
        ...(patch.priority === undefined ? {} : { priority: patch.priority }),
        ...(patch.dueAt === undefined ? {} : { dueAt: patch.dueAt }),
        ...(patch.status === undefined
          ? {}
          : { status: patch.status, completedAt: patch.status === "Done" ? new Date() : null }),
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.workItem.key, key), eq(s.workItem.version, expectedVersion)))
      .returning({ id: s.workItem.id });
    if (rows.length === 0) return { written: false, queued: NO_NOTICES };

    if (patch.status !== undefined) {
      const [activity] = await tx
        .insert(s.workItemActivity)
        .values({
          workItemId: rows[0].id,
          ...(actor ?? { actorType: "Person", actorId: personId }),
          eventType: "StatusChanged",
          detailEn: `moved to ${patch.status}`,
          detailAr: `نقل إلى ${patch.status}`,
        })
        .returning({ id: s.workItemActivity.id });
      // D358: leaving In review, by Approve, Request changes or any other move, decides the
      // review, so the reviewer's Inbox item for it is done.
      if (before?.status === "InReview" && patch.status !== "InReview") {
        await tx
          .update(s.inboxItem)
          .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
          .where(
            and(
              eq(s.inboxItem.sourceType, "WorkItem"),
              eq(s.inboxItem.sourceId, rows[0].id),
              eq(s.inboxItem.kind, "Review"),
              eq(s.inboxItem.status, "Open"),
            ),
          );
      }
      // D240: the people the item is for are told when it finishes, not when it moves within its end.
      if (finalStatus("WorkItem", patch.status) && !(before && finalStatus("WorkItem", before.status))) {
        const queued = await queueFinishedNotices(tx, {
          subjectType: "WorkItem",
          subjectId: rows[0].id,
          outcome: patch.status,
          eventId: activity.id,
          except: actor?.actorType === "Agent" ? [] : [personId],
          actorId: personId,
        });
        return { written: true, queued };
      }
    }
    return { written: true, queued: NO_NOTICES };
  });
  await announce(outcome.queued);
  return outcome.written;
}

/** Moves a work item to a new status, refusing a stale write (`COM-10`). */
export async function changeStatus(key: string, status: string, version: number, personId: string): Promise<void> {
  const written = await updateWorkItem(key, version, { status }, personId);
  assertWritten(written ? [key] : [], "WorkItem");
}

/** Assigns a work item to a person or an agent, or unassigns it. */
export async function assign(key: string, assignee: { type: string; id: string } | null, version: number, personId: string): Promise<void> {
  const rows = await db()
    .update(s.workItem)
    .set({
      assigneeType: assignee?.type ?? "None",
      assigneeId: assignee?.id ?? null,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(and(eq(s.workItem.key, key), eq(s.workItem.version, version)))
    .returning({ id: s.workItem.id });
  assertWritten(rows, "WorkItem");
  if (assignee?.type === "Person") await tellAssignee(key, assignee.id, personId);
}

/**
 * D394: a person given a work item is told in their Inbox and by email, unless they gave it to
 * themselves. One notice each time, so giving the same item to them again tells them again.
 */
export async function tellAssignee(key: string, assigneeId: string, actorId: string): Promise<void> {
  if (assigneeId === actorId) return;
  const [item] = await dbRo().select({ titleEn: s.workItem.titleEn, titleAr: s.workItem.titleAr }).from(s.workItem).where(eq(s.workItem.key, key));
  if (!item) return;
  const path = `/tasks?open=${encodeURIComponent(key)}`;
  const titleEn = `Assigned to you: ${key} ${item.titleEn}`;
  const titleAr = `أُسند إليك: ${key} ${item.titleAr || item.titleEn}`;
  const items = await insertUpdateItems(db(), { people: [assigneeId], sourceType: "WorkItemAssigned", sourceId: crypto.randomUUID(), titleEn, titleAr, path, actorId });
  await announce({ mail: await queueAlertEmails(db(), { items, kind: "Update", titleEn, titleAr, path, actorId }), told: items.map((item) => item.personId) });
}

/** The version a screen read, which a write must name back (`COM-10`). */
export async function readVersion(key: string): Promise<number | null> {
  const [row] = await dbRo().select({ version: s.workItem.version }).from(s.workItem).where(eq(s.workItem.key, key)).limit(1);
  return row?.version ?? null;
}

/** Resolves a principal code — a person id or an agent code — to its row id and type. */
export const resolvePrincipal = selectPrincipalByCode;

/* ------------------------------------------------------- the rules of S-24 (UC-24.1, UC-24.3) */

/**
 * One work item as the rules need it: the fields a patch may change, its project, and the
 * sub items still open under it, which is what closing it would leave behind.
 */
export async function readForRules(key: string): Promise<{
  id: string;
  status: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  priority: string;
  dueAt: Date | null;
  projectId: string;
  projectKey: string;
  requireReviewerNotAuthor: boolean;
  assigneeType: string;
  assigneeId: string | null;
  reviewerId: string | null;
  openSubItems: number;
  version: number;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.workItem.id,
      status: s.workItem.status,
      titleEn: s.workItem.titleEn,
      titleAr: s.workItem.titleAr,
      descriptionEn: s.workItem.descriptionEn,
      priority: s.workItem.priority,
      dueAt: s.workItem.dueAt,
      projectId: s.workItem.projectId,
      projectKey: s.project.key,
      requireReviewerNotAuthor: s.project.requireReviewerNotAuthor,
      assigneeType: s.workItem.assigneeType,
      assigneeId: s.workItem.assigneeId,
      reviewerId: s.workItem.reviewerId,
      openSubItems: sql<number>`(
        select count(*) from work.work_item c
        where c.parent_work_item_id = ${s.workItem.id} and c.status not in ('Done', 'Cancelled')
      )::int`,
      version: s.workItem.version,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  return row ?? null;
}

/** A project as the create rules need it. */
export async function readProjectRules(projectKey: string): Promise<{
  id: string;
  requireReviewerNotAuthor: boolean;
} | null> {
  const [row] = await dbRo()
    .select({ id: s.project.id, requireReviewerNotAuthor: s.project.requireReviewerNotAuthor })
    .from(s.project)
    .where(eq(s.project.key, projectKey))
    .limit(1);
  return row ?? null;
}

/** `UC-24.3-08`: the agents a project allows, by code. */
export async function agentsAllowedInProject(projectKey: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ code: s.agent.code })
    .from(s.projectAllowedAgent)
    .innerJoin(s.project, eq(s.project.id, s.projectAllowedAgent.projectId))
    .innerJoin(s.agent, eq(s.agent.id, s.projectAllowedAgent.agentId))
    .where(eq(s.project.key, projectKey));
  return rows.map((row) => row.code);
}

/**
 * `UC-24.3-05`: open items in the same project whose title reads like this one, of those the
 * person sees (`visibleTo`).
 *
 * Trigram similarity rather than a word match: "VAT on hotel invoices" and "Hotel invoice
 * VAT question" are the same question to a person and share no leading word.
 */
export async function similarOpenItems(
  projectKey: string,
  title: string,
  visibleIds: string[] | null,
  personId: string,
): Promise<{ key: string; titleEn: string }[]> {
  const rows = await dbRo()
    .select({ key: s.workItem.key, titleEn: s.workItem.titleEn })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(
      and(
        eq(s.project.key, projectKey),
        visibleTo(visibleIds, personId),
        sql`${s.workItem.status} not in ('Done', 'Cancelled')`,
        sql`similarity(${s.workItem.titleEn}, ${title}) > 0.3`,
      ),
    )
    .orderBy(sql`similarity(${s.workItem.titleEn}, ${title}) desc`)
    .limit(3);
  return rows;
}

/** `UC-24.3-03`: the project a sub item inherits, which is its parent's. */
export async function projectOfWorkItem(key: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ projectKey: s.project.key })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  return row?.projectKey ?? null;
}

/* ------------------------------------------------------------- advanced search (UC-24.2) */

/** `UC-24.2-01`: the criteria the search form collects. */
export type WorkItemSearch = {
  keyword?: string;
  projectKey?: string;
  type?: string;
  status?: string;
  priority?: string;
  /** A person id, an agent code, `unassigned`, or nothing for anyone. */
  assignee?: string;
  dueFrom?: string;
  dueTo?: string;
};

/**
 * `UC-24.2-01`: the work items matching every given criterion, newest first, at most 200, by the
 * screen's own filters (`listWorkItemPage`): the keyword is matched literally within the item's
 * search key, normalised as the palette's search is; the due window includes both days.
 */
export async function searchWorkItems(criteria: WorkItemSearch, visibleIds: string[] | null, personId: string): Promise<Task[]> {
  const listed = await listWorkItemPage(
    visibleIds,
    personId,
    {
      q: criteria.keyword,
      projectKey: criteria.projectKey,
      type: criteria.type,
      status: criteria.status,
      priority: criteria.priority,
      assignee: criteria.assignee === "unassigned" ? "none" : criteria.assignee,
      dueFrom: dayStart(criteria.dueFrom),
      dueBefore: dayAfter(criteria.dueTo),
    },
    { limit: 200, offset: 0 },
  );
  return listed.rows;
}

/* ---------------------------------------------------------------- saved views (UC-24.2-02) */

export async function listSavedViews(
  personId: string,
  screen: string,
): Promise<{ name: string; filter: Record<string, unknown> }[]> {
  const rows = await dbRo()
    .select({ name: s.savedView.name, filter: s.savedView.filterJson })
    .from(s.savedView)
    .where(and(eq(s.savedView.personId, personId), eq(s.savedView.screen, screen)))
    .orderBy(asc(s.savedView.name));
  return rows.map((row) => ({ name: row.name, filter: row.filter }));
}

/** Saving the same name again replaces it: a view is a name for one set of criteria. */
export async function saveView(
  input: { personId: string; screen: string; name: string; filter: Record<string, unknown> },
): Promise<void> {
  await db()
    .insert(s.savedView)
    .values({
      personId: input.personId,
      screen: input.screen,
      name: input.name,
      filterJson: input.filter,
      createdBy: input.personId,
      updatedBy: input.personId,
    })
    .onConflictDoUpdate({
      target: [s.savedView.personId, s.savedView.screen, s.savedView.name],
      set: { filterJson: input.filter, updatedAt: new Date(), updatedBy: input.personId },
    });
}

/* ------------------------------------------------ what the drawer does to one item (S-25) */

/** One work item with everything the drawer's actions depend on. */
export async function readForActions(key: string): Promise<{
  id: string;
  status: string;
  type: string;
  projectId: string;
  projectKey: string;
  assigneeType: string;
  assigneeId: string | null;
  assigneeAgent: string | null;
  reviewerId: string | null;
  createdBy: string | null;
  parentKey: string | null;
  openSubItems: number;
  version: number;
} | null> {
  const [row] = await dbRo()
    .select({
      id: s.workItem.id,
      status: s.workItem.status,
      type: s.workItem.type,
      projectId: s.workItem.projectId,
      projectKey: s.project.key,
      assigneeType: s.workItem.assigneeType,
      assigneeId: s.workItem.assigneeId,
      assigneeAgent: sql<string | null>`(
        select a.code from ai.agent a
        where ${s.workItem.assigneeType} = 'Agent' and a.id = ${s.workItem.assigneeId}
      )`,
      reviewerId: s.workItem.reviewerId,
      createdBy: s.workItem.createdBy,
      parentKey: sql<string | null>`(
        select p.key from work.work_item p where p.id = ${s.workItem.parentWorkItemId}
      )`,
      openSubItems: sql<number>`(
        select count(*) from work.work_item c
        where c.parent_work_item_id = ${s.workItem.id} and c.status not in ('Done', 'Cancelled')
      )::int`,
      version: s.workItem.version,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-25.2-05`: the status a blocked item goes back to.
 *
 * Read from the activity rather than stored on the row: the history already says what it
 * was before it was blocked, and a second copy of that fact would be one more thing that
 * can disagree with it.
 */
export async function statusBeforeBlocked(key: string): Promise<string> {
  const { rows } = await dbRo().execute<{ detail: string }>(
    sql`select a.detail_en as detail
        from work.work_item_activity a
        join work.work_item w on w.id = a.work_item_id
        where w.key = ${key} and a.event_type = 'StatusChanged' and a.detail_en not like '%Blocked%'
        order by a.at desc limit 1`,
  );
  const previous = rows[0]?.detail?.replace("moved to ", "").trim();
  const known = ["Backlog", "ToDo", "InProgress", "InReview"];
  return known.includes(previous ?? "") ? (previous as string) : "ToDo";
}

/** Whether a work item still exists, read on the primary so a delete just made is seen. */
/** A work item's key by its id, or null when it no longer exists. */
export async function workItemKeyOf(id: string): Promise<string | null> {
  const [row] = await db().select({ key: s.workItem.key }).from(s.workItem).where(eq(s.workItem.id, id)).limit(1);
  return row?.key ?? null;
}

export async function workItemExists(id: string): Promise<boolean> {
  const [row] = await db().select({ id: s.workItem.id }).from(s.workItem).where(eq(s.workItem.id, id)).limit(1);
  return Boolean(row);
}

/** An entry in the item's history, which is what the Activity tab reads. */
export async function recordActivity(
  input: {
    workItemId: string;
    actorType: string;
    actorId: string | null;
    eventType: string;
    detailEn: string;
    detailAr: string;
  },
): Promise<void> {
  await db().insert(s.workItemActivity).values(input);
}

/** `UC-25.2-05`: clear what the item was blocked on, and move it back. */
export async function unblock(key: string, status: string, personId: string): Promise<void> {
  await db()
    .update(s.workItem)
    .set({
      status,
      blockedReasonEn: null,
      blockedReasonAr: null,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.workItem.key, key));
}

/** `UC-25.2-01`: the reviewer is told that something is waiting for them. */
export async function notifyReviewer(
  input: { reviewerId: string; workItemId: string },
  personId: string,
): Promise<void> {
  const items = await db()
    .insert(s.inboxItem)
    .values({
      personId: input.reviewerId,
      kind: "Review",
      sourceType: "WorkItem",
      sourceId: input.workItemId,
      status: "Open",
      createdBy: personId,
      updatedBy: personId,
    })
    .onConflictDoNothing()
    .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
  await emailAboutItem(items, "Review", input.workItemId, personId, (title) => [`Waiting for your review: ${title}`, `بانتظار مراجعتك: ${title}`]);
}

/** D394: the email of a work item's Inbox item, naming the item and linking to it; sent once the items are written. */
async function emailAboutItem(
  items: { id: string; personId: string }[],
  kind: "Review" | "Mention" | "Update",
  workItemId: string,
  actorId: string,
  words: (title: string) => [string, string],
): Promise<void> {
  if (items.length === 0) return;
  const [item] = await dbRo()
    .select({ key: s.workItem.key, titleEn: s.workItem.titleEn, titleAr: s.workItem.titleAr })
    .from(s.workItem)
    .where(eq(s.workItem.id, workItemId));
  if (!item) return;
  const [en] = words(`${item.key} ${item.titleEn}`);
  const [, ar] = words(`${item.key} ${item.titleAr || item.titleEn}`);
  await enqueueMailJobs(
    await queueAlertEmails(db(), { items, kind, titleEn: en, titleAr: ar, path: `/tasks?open=${encodeURIComponent(item.key)}`, actorId }),
  );
}

/** `UC-25.4-02`: the people an @mention in a comment names, by their handle. */
export async function peopleByHandle(handles: string[]): Promise<{ id: string; handle: string }[]> {
  if (handles.length === 0) return [];
  const rows = await dbRo()
    .select({ id: s.person.id, handle: s.person.email })
    .from(s.person)
    // The array has to reach Postgres as one, which `sql` only does for a bound parameter
    // it was told is an array.
    .where(inArray(sql`split_part(${s.person.email}, '@', 1)`, handles));
  return rows.map((row) => ({ id: row.id, handle: row.handle.split("@")[0] }));
}

/** `UC-25.4-02`: a mention puts the item in that person's inbox. */
export async function notifyMention(
  input: { personId: string; workItemId: string },
  actedBy: string,
): Promise<void> {
  const items = await db()
    .insert(s.inboxItem)
    .values({
      personId: input.personId,
      kind: "Mention",
      sourceType: "WorkItem",
      sourceId: input.workItemId,
      status: "Open",
      createdBy: actedBy,
      updatedBy: actedBy,
    })
    .onConflictDoNothing()
    .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
  await emailAboutItem(items, "Mention", input.workItemId, actedBy, (title) => [`You were mentioned on ${title}`, `تمت الإشارة إليك في ${title}`]);
}

/** `UC-25.3-02`: a sub item marked done or not done. */
export async function setSubItemDone(key: string, done: boolean, personId: string): Promise<void> {
  await db()
    .update(s.workItem)
    .set({
      status: done ? "Done" : "ToDo",
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(eq(s.workItem.key, key));
}

/** `UC-25.1-03`: an attachment of one work item, in that item's project. */
export async function attachFile(
  input: {
    workItemId: string;
    projectKey: string;
    name: string;
    contentRef: string;
    size: number;
    mimeType: string;
  },
  personId: string,
): Promise<void> {
  const [project] = await dbRo()
    .select({ id: s.project.id })
    .from(s.project)
    .where(eq(s.project.key, input.projectKey))
    .limit(1);
  if (!project) throw new Error(`No project ${input.projectKey}.`);

  await db().insert(s.projectFile).values({
    projectId: project.id,
    name: input.name,
    contentRef: input.contentRef,
    size: input.size,
    mimeType: input.mimeType,
    uploadedBy: personId,
    linkedToType: "WorkItem",
    linkedToId: input.workItemId,
    createdBy: personId,
    updatedBy: personId,
  });
}

/**
 * What still points at a work item and would block deleting it: an approval decided on it,
 * a schedule firing that created it, or a sub-item under it (move or finish those first, the
 * same shape an org unit's children already use). Its own comment and status-change log
 * (`work_item_activity`) has no cascade either, but that log belongs to no one but this item,
 * so `deleteWorkItem` clears it itself rather than reporting it as something in the way.
 */
export async function workItemDeleteBlockers(id: string): Promise<{
  approvals: number;
  scheduleRuns: number;
  subItems: number;
}> {
  const [row] = await dbRo()
    .select({
      approvals: sql<number>`(select count(*) from ai.approval a where a.work_item_id = ${id})::int`,
      scheduleRuns: sql<number>`(select count(*) from work.schedule_run r where r.created_work_item_id = ${id})::int`,
      subItems: sql<number>`(select count(*) from work.work_item c where c.parent_work_item_id = ${id})::int`,
    })
    .from(s.workItem)
    .where(eq(s.workItem.id, id))
    .limit(1);
  return row ?? { approvals: 0, scheduleRuns: 0, subItems: 0 };
}

/** Removes a work item the caller has already checked is not blocked. Its own activity log
 * goes with it first, since nothing else references that log. */
export async function deleteWorkItem(id: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.workItemActivity).where(eq(s.workItemActivity.workItemId, id));
    await tx.delete(s.workItem).where(eq(s.workItem.id, id));
  });
}

/** D312: the request a new work item is raised for, with the project it belongs to. */
export async function requestForWork(key: string): Promise<{ id: string; key: string; projectKey: string } | null> {
  const [row] = await db()
    .select({ id: s.request.id, key: s.request.key, projectKey: s.project.key })
    .from(s.request)
    .innerJoin(s.project, eq(s.project.id, s.request.projectId))
    .where(eq(s.request.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-25.2-02`: the request a work item belongs to, so a finished one can move the request on;
 * null when it belongs to none.
 */
export async function requestOfWorkItem(key: string): Promise<{ id: string; key: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.request.id, key: s.request.key })
    .from(s.workItem)
    .innerJoin(s.request, eq(s.request.id, s.workItem.requestId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  return row ?? null;
}

/** Whether every work item of a request is finished, which is what lets the request close. */
export async function requestWorkIsDone(requestId: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ open: sql<number>`count(*) filter (where ${s.workItem.status} not in ('Done','Cancelled'))::int` })
    .from(s.workItem)
    .where(eq(s.workItem.requestId, requestId));
  return (row?.open ?? 0) === 0;
}

/** D384: who did something: a person's name, an agent's code, or the platform. */
const actorName = sql<string>`coalesce(
  (select p.name_en from core.person p where p.id = ${outer(s.workItemActivity.actorId)}),
  (select a.code from ai.agent a where a.id = ${outer(s.workItemActivity.actorId)}),
  'platform')`;

/**
 * D384: what a work item's brief is made of, or null when there is no such work item. Read from the
 * primary: the brief is built straight after the write that started the run.
 */
export async function readBriefFacts(key: string) {
  const [item] = await db()
    .select({
      id: s.workItem.id,
      createdAt: s.workItem.createdAt,
      title: s.workItem.titleEn,
      type: s.workItem.type,
      status: s.workItem.status,
      priority: s.workItem.priority,
      dueAt: s.workItem.dueAt,
      description: s.workItem.descriptionEn,
      blocked: s.workItem.blockedReasonEn,
      attributes: s.workItem.attributes,
      project: s.project.nameEn,
      parent: sql<string | null>`(select p.key from work.work_item p where p.id = ${outer(s.workItem.parentWorkItemId)})`,
      request: sql<string | null>`(select r.key from work.request r where r.id = ${outer(s.workItem.requestId)})`,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  if (!item) return null;

  const [subs, activity, attachments, artifacts] = await Promise.all([
    db()
      .select({ key: s.workItem.key, title: s.workItem.titleEn, status: s.workItem.status })
      .from(s.workItem)
      .where(eq(s.workItem.parentWorkItemId, item.id))
      .orderBy(asc(s.workItem.key)),
    db()
      .select({ at: s.workItemActivity.at, who: actorName, event: s.workItemActivity.eventType, detail: s.workItemActivity.detailEn })
      .from(s.workItemActivity)
      .where(eq(s.workItemActivity.workItemId, item.id))
      .orderBy(asc(s.workItemActivity.at)),
    db().select({ name: s.attachment.fileName, size: s.attachment.size }).from(s.attachment).where(eq(s.attachment.ownerId, item.id)),
    db().select({ name: s.artifact.nameEn }).from(s.artifact).where(eq(s.artifact.linkedToId, item.id)),
  ]);

  return { item, subs, activity, attachments, artifacts };
}

/** D388: a principal's id, or an agent's code, from a type and an id column. */
const principalRef = (type: SQL | typeof s.workItem.assigneeType, id: SQL | typeof s.workItem.assigneeId) =>
  sql<string>`coalesce(case when ${type} = 'Agent' then (select a.code from ai.agent a where a.id = ${id}) else ${id}::text end, '')`;

/** D388: what a work item's report shows beyond its card and drawer, or null when there is no such item. */
export async function readWorkItemReportFacts(key: string): Promise<WorkItemReportFacts | null> {
  const [item] = await dbRo()
    .select({
      id: s.workItem.id,
      descriptionAr: s.workItem.descriptionAr,
      projectEn: s.project.nameEn,
      projectAr: s.project.nameAr,
      requestKey: s.request.key,
      reviewer: principalRef(outer(s.workItem.reviewerType), outer(s.workItem.reviewerId)),
      createdBy: sql<string>`coalesce(${s.workItem.createdBy}::text, '')`,
      createdAt: s.workItem.createdAt,
      updatedAt: s.workItem.updatedAt,
      completedAt: s.workItem.completedAt,
      blockedEn: s.workItem.blockedReasonEn,
      blockedAr: s.workItem.blockedReasonAr,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .leftJoin(s.request, eq(s.request.id, s.workItem.requestId))
    .where(eq(s.workItem.key, key))
    .limit(1);
  if (!item) return null;
  const [history, subItems] = await Promise.all([workItemHistory(item.id), subItemTree(item.id)]);
  return {
    descriptionAr: item.descriptionAr,
    projectEn: item.projectEn,
    projectAr: item.projectAr,
    requestKey: item.requestKey,
    reviewer: item.reviewer,
    createdBy: item.createdBy,
    blockedEn: item.blockedEn,
    blockedAr: item.blockedAr,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    completedAt: item.completedAt?.toISOString() ?? null,
    history,
    subItems,
  };
}

/** A work item's activity, oldest first, with when and by whom. */
async function workItemHistory(workItemId: string): Promise<WorkItemReportFacts["history"]> {
  const rows = await dbRo()
    .select({
      at: s.workItemActivity.at,
      who: principalRef(outer(s.workItemActivity.actorType), outer(s.workItemActivity.actorId)),
      detailEn: s.workItemActivity.detailEn,
      detailAr: s.workItemActivity.detailAr,
    })
    .from(s.workItemActivity)
    .where(eq(s.workItemActivity.workItemId, workItemId))
    .orderBy(asc(s.workItemActivity.at));
  return rows.map((row) => ({ at: row.at.toISOString(), who: row.who, detailEn: row.detailEn ?? "", detailAr: row.detailAr ?? row.detailEn ?? "" }));
}

/** The items below a work item at every depth (at most 10 levels, 500 items), parents before children. */
async function subItemTree(workItemId: string): Promise<WorkItemReportFacts["subItems"]> {
  const { rows } = await dbRo().execute<{
    key: string;
    parent_key: string;
    title_en: string;
    title_ar: string;
    status: string;
    priority: string;
    assignee: string;
    due_at: Date | string | null;
  }>(sql`
    with recursive tree as (
      select w.id, w.parent_work_item_id, 1 as depth from work.work_item w where w.parent_work_item_id = ${workItemId}
      union all
      select w.id, w.parent_work_item_id, t.depth + 1 from work.work_item w join tree t on w.parent_work_item_id = t.id where t.depth < 10
    )
    select w.key, p.key as parent_key, w.title_en, w.title_ar, w.status, w.priority,
           coalesce(case when w.assignee_type = 'Agent' then (select a.code from ai.agent a where a.id = w.assignee_id) else w.assignee_id::text end, '') as assignee,
           w.due_at
      from tree t join work.work_item w on w.id = t.id join work.work_item p on p.id = t.parent_work_item_id
     order by t.depth, w.created_at, w.key
     limit 500`);
  return rows.map((row) => ({
    key: row.key,
    parentKey: row.parent_key,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
  }));
}

/**
 * D388: the work items a person sees that match a Work items report's filters, newest first, at
 * most `limit` of them, and how many match in all. The list's own rules (`matching`) apply first.
 */
export async function inquireWorkItems(
  visibleIds: string[] | null,
  personId: string,
  filter: WorkItemInquiry,
  limit: number,
): Promise<{ rows: WorkItemInquiryRow[]; total: number }> {
  const reviewer = filter.reviewer;
  const where = and(
    matching(visibleIds, personId, filter),
    reviewer && UUID.test(reviewer)
      ? and(eq(s.workItem.reviewerType, "Person"), eq(s.workItem.reviewerId, reviewer))
      : reviewer
        ? sql`${s.workItem.reviewerType} = 'Agent' and ${s.workItem.reviewerId} = (select a.id from ai.agent a where a.code = ${reviewer})`
        : undefined,
    filter.requestKey ? sql`${s.workItem.requestId} = (select r.id from work.request r where r.key = ${filter.requestKey})` : undefined,
    filter.createdFrom ? sql`${s.workItem.createdAt} >= ${filter.createdFrom}` : undefined,
    filter.createdBefore ? sql`${s.workItem.createdAt} < ${filter.createdBefore}` : undefined,
    filter.overdue ? sql`${s.workItem.dueAt} < now() and ${s.workItem.status} not in ('Done', 'Cancelled')` : undefined,
    filter.level === "top" ? sql`${s.workItem.parentWorkItemId} is null` : filter.level === "sub" ? sql`${s.workItem.parentWorkItemId} is not null` : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    dbRo()
      .select({
        key: s.workItem.key,
        parentKey: sql<string | null>`(select p.key from work.work_item p where p.id = ${outer(s.workItem.parentWorkItemId)})`,
        titleEn: s.workItem.titleEn,
        titleAr: s.workItem.titleAr,
        projectKey: s.project.key,
        type: s.workItem.type,
        status: s.workItem.status,
        priority: s.workItem.priority,
        assignee: principalRef(outer(s.workItem.assigneeType), outer(s.workItem.assigneeId)),
        reviewer: principalRef(outer(s.workItem.reviewerType), outer(s.workItem.reviewerId)),
        requestKey: sql<string | null>`(select r.key from work.request r where r.id = ${outer(s.workItem.requestId)})`,
        dueAt: s.workItem.dueAt,
        createdAt: s.workItem.createdAt,
      })
      .from(s.workItem)
      .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
      .leftJoin(s.person, eq(s.person.id, s.workItem.assigneeId))
      .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
      .where(where)
      .orderBy(desc(s.workItem.createdAt), desc(s.workItem.key))
      .limit(limit),
    dbRo()
      .select({ total: sql<number>`count(*)::int` })
      .from(s.workItem)
      .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
      .leftJoin(s.agent, eq(s.agent.id, s.workItem.assigneeId))
      .where(where),
  ]);
  return {
    total: counted?.total ?? 0,
    rows: rows.map((row) => ({ ...row, dueAt: row.dueAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
  };
}
