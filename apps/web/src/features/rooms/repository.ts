import { and, asc, desc, eq, exists, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { insertUpdateItems, queueAlertEmails } from "@/db/queries/mail";
import { announce } from "@/lib/notify";
import { enqueueMailJobs } from "@/lib/valkey";
import { outer } from "@/db/outer";
import { selectPrincipalByCode } from "@/db/queries/identity";
import { containsTerm } from "@/db/search";
import { assertWritten } from "@/lib/concurrency";
import type { Action } from "@/features/assistant/components/assistant-activity";
import type { RoomContextUsage, RoomCounts, RoomDetail, RoomMessage, RoomQuestion, Session } from "./types";

/** The only module in `rooms` that touches Drizzle. */

/** Messages are partitioned by month; the count is read once per room. */
const messageCount = sql<number>`(select count(*) from work.room_message m where m.room_id = ${outer(s.discussionRoom.id)})::int`;

/** A room's estimated spend is what its runs cost (specification section 9). */
const roomCost = sql<number>`(
  select coalesce(sum(r.estimated_cost_aed), 0)
  from ai.run r
  where r.context_type = 'Room' and r.context_id = ${s.discussionRoom.id}
)::float8`;

/** The prototype's words for a room type and source, which the data model stores as tokens. */
const TYPE_LABEL: Record<string, string> = { Chat: "Chat", Review: "Review", WarRoom: "War-room", Support: "Support", Automation: "Automation" };
const SOURCE_LABEL: Record<string, string> = { Console: "Console", Teams: "Teams", Widget: "Widget", Routine: "Routine" };

type RoomRow = {
  id: string;
  key: string;
  version: number;
  project: string;
  titleEn: string;
  titleAr: string;
  type: string;
  source: string;
  status: string;
  lastActivityAt: Date | null;
  createdAt: Date;
  messages: number;
  cost: number;
};

/**
 * Each room's participants in joining order, keyed by room id: an agent by its code, a person by
 * id, with the room role. A participant whose person or agent row is gone is left out.
 */
async function participantsOf(roomIds: string[]): Promise<Map<string, { id: string; isAgent: boolean; role: string }[]>> {
  if (roomIds.length === 0) return new Map();
  const rows = await dbRo()
    .select({
      roomId: s.roomParticipant.roomId,
      principalType: s.roomParticipant.principalType,
      role: s.roomParticipant.roomRole,
      joinedAt: s.roomParticipant.joinedAt,
      personId: s.person.id,
      agentCode: s.agent.code,
    })
    .from(s.roomParticipant)
    .leftJoin(s.person, eq(s.person.id, s.roomParticipant.principalId))
    .leftJoin(s.agent, eq(s.agent.id, s.roomParticipant.principalId))
    .where(inArray(s.roomParticipant.roomId, roomIds))
    .orderBy(asc(s.roomParticipant.joinedAt));

  const byRoom = new Map<string, { id: string; isAgent: boolean; role: string }[]>();
  for (const row of rows) {
    const id = row.principalType === "Agent" ? row.agentCode : row.personId;
    if (!id) continue;
    const list = byRoom.get(row.roomId) ?? [];
    list.push({ id, isAgent: row.principalType === "Agent", role: row.role });
    byRoom.set(row.roomId, list);
  }
  return byRoom;
}

/** A room row as the list shows it, with the type and source as labels and the participants' ids. */
function toSession(row: RoomRow, participants: { id: string; isAgent: boolean }[]): Session {
  return {
    key: row.key,
    version: row.version,
    p: row.project,
    t: row.titleEn,
    tAr: row.titleAr,
    type: TYPE_LABEL[row.type] ?? row.type,
    src: SOURCE_LABEL[row.source] ?? row.source,
    st: row.status,
    who: participants.map((participant) => participant.id),
    msgs: row.messages,
    lastActivityAt: (row.lastActivityAt ?? row.createdAt).toISOString(),
    cost: row.cost,
    // A room with no people in it is an automated one, which the list marks differently.
    kind: participants.some((participant) => !participant.isAgent) ? "chat" : "auto",
  };
}

const roomColumns = {
  id: s.discussionRoom.id,
  key: s.discussionRoom.key,
  version: s.discussionRoom.version,
  project: s.project.key,
  titleEn: s.discussionRoom.titleEn,
  titleAr: s.discussionRoom.titleAr,
  type: s.discussionRoom.type,
  source: s.discussionRoom.source,
  status: s.discussionRoom.status,
  lastActivityAt: s.discussionRoom.lastActivityAt,
  createdAt: s.discussionRoom.createdAt,
  messages: messageCount,
  cost: roomCost,
};

/**
 * One stored Tool step as the step list draws it. Its result is `{"arguments", "result"}` as
 * JSON (D300); one cut at the length limit is no longer JSON and is shown whole as the result.
 */
function stepAction(step: { id: string; name: string; status: string; result: string | null }): Action {
  let args: Record<string, unknown> = {};
  let result = step.result ?? "";
  try {
    const detail = JSON.parse(result) as { arguments?: unknown; result?: unknown };
    // A long call's arguments are stored as their own cut JSON text, which names no target.
    if (detail.arguments && typeof detail.arguments === "object") args = detail.arguments as Record<string, unknown>;
    else if (typeof detail.arguments === "string") args = { arguments: detail.arguments };
    result = detail.result == null ? "" : typeof detail.result === "string" ? detail.result : JSON.stringify(detail.result, null, 2);
  } catch {
    // Cut at the limit: the stored text is all there is.
  }
  return { id: step.id, name: step.name, args, state: step.status === "Done" ? "done" : "failed", result };
}

/**
 * S-23: one room with the latest `messageLimit` messages of its transcript, its participants
 * and its linked work items. `earlier` says whether the transcript goes back further.
 */
export async function readRoom(key: string, personId: string, messageLimit: number): Promise<RoomDetail | null> {
  const [row] = await dbRo()
    .select({ ...roomColumns, projectNameEn: s.project.nameEn, projectNameAr: s.project.nameAr, turnTaking: s.discussionRoom.turnTaking, agentHopLimit: s.discussionRoom.agentHopLimit, costCapAed: s.discussionRoom.costCapAed })
    .from(s.discussionRoom)
    .innerJoin(s.project, eq(s.project.id, s.discussionRoom.projectId))
    .where(eq(s.discussionRoom.key, key))
    .limit(1);
  if (!row) return null;

  const participants = (await participantsOf([row.id])).get(row.id) ?? [];

  const messageRows = await dbRo()
    .select({
      id: s.roomMessage.id,
      seq: s.roomMessage.seq,
      senderType: s.roomMessage.senderType,
      senderPerson: s.person.id,
      senderAgent: s.agent.code,
      agentVersion: s.agentVersion.versionNumber,
      content: s.roomMessage.contentJson,
      runId: s.roomMessage.runId,
      createdAt: s.roomMessage.createdAt,
    })
    .from(s.roomMessage)
    .leftJoin(s.person, and(eq(s.roomMessage.senderType, "Person"), eq(s.person.id, s.roomMessage.senderId)))
    .leftJoin(s.agent, and(eq(s.roomMessage.senderType, "Agent"), eq(s.agent.id, s.roomMessage.senderId)))
    .leftJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(eq(s.roomMessage.roomId, row.id))
    // The latest messages, read newest first by the (room_id, seq) index and shown oldest first.
    .orderBy(desc(s.roomMessage.seq))
    .limit(messageLimit + 1);
  const earlier = messageRows.length > messageLimit;
  messageRows.splice(messageLimit);
  messageRows.reverse();

  const approvalKeys = messageRows
    .map((message) => (message.content as Record<string, unknown>).approval)
    .filter((value): value is string => typeof value === "string");

  const approvals = approvalKeys.length
    ? await dbRo()
        .select({
          key: s.approval.key,
          action: s.approval.action,
          risk: s.approval.risk,
          status: s.approval.status,
          // `UC-23.2-05`: the open inbox item this person holds for it, which is the row a
          // decision taken here is written against, so the room and the Inbox cannot
          // disagree about what happened.
          inboxItemId: sql<string | null>`(
            select ii.id from ai.inbox_item ii
            where ii.source_type = 'Approval' and ii.source_id = ${outer(s.approval.id)}
              and ii.person_id = ${personId} and ii.status = 'Open'
            limit 1
          )`,
          // D19: the person whose mission this is. In a room that is whoever addressed the
          // agent, and they are the member offered the decision. The approval row records
          // them; the run it belongs to is the fallback for an older row.
          requesterId: sql<string | null>`coalesce(
            ${outer(s.approval.createdBy)},
            (select r.created_by from ai.run r where r.id = ${outer(s.approval.runId)})
          )`,
          // D253: a call that changes who may do what is not the requester's to decide, so
          // they hold no item for it and the approvers who do decide it here.
          requesterHolds: sql<boolean>`exists (
            select 1 from ai.inbox_item ii
            where ii.source_type = 'Approval' and ii.source_id = ${outer(s.approval.id)}
              and ii.person_id = coalesce(
                ${outer(s.approval.createdBy)},
                (select r.created_by from ai.run r where r.id = ${outer(s.approval.runId)})
              )
          )`,
          // Who holds it to decide: the requester, or for a call that changes who may do
          // what, the approvers other than them (D253).
          approverNames: sql<string | null>`(
            select string_agg(p.name_en, ', ' order by p.name_en) from ai.inbox_item ii
            join core.person p on p.id = ii.person_id
            where ii.source_type = 'Approval' and ii.source_id = ${outer(s.approval.id)}
          )`,
          requesterName: sql<string | null>`(
            select p.name_en from core.person p where p.id = coalesce(
              ${outer(s.approval.createdBy)},
              (select r.created_by from ai.run r where r.id = ${outer(s.approval.runId)})
            )
          )`,
        })
        .from(s.approval)
        .where(inArray(s.approval.key, approvalKeys))
    : [];

  const questions = await readRoomQuestions(
    messageRows.map((message) => (message.content as Record<string, unknown>).question),
    personId,
  );
  const waitingQuestions = await readWaitingQuestions(row.id, [...questions.keys()], personId);

  // D352: the tool calls behind each agent reply, from its run's timeline (D300), in order.
  // A question is the room's own card, so `ask_person` is not one of them.
  const replyRuns = messageRows.flatMap((message) => (message.senderType === "Agent" && message.runId ? [message.runId] : []));
  const toolSteps = replyRuns.length
    ? await dbRo()
        .select({ id: s.runStep.id, runId: s.runStep.runId, name: s.runStep.name, status: s.runStep.status, result: s.runStep.result })
        .from(s.runStep)
        .where(and(inArray(s.runStep.runId, replyRuns), eq(s.runStep.type, "Tool"), ne(s.runStep.name, "ask_person")))
        .orderBy(asc(s.runStep.runId), asc(s.runStep.seq))
    : [];

  const messages: RoomMessage[] = messageRows.map((message) => {
    const content = message.content as Record<string, unknown>;
    const approval = approvals.find((candidate) => candidate.key === content.approval);
    return {
      id: message.id,
      seq: message.seq,
      sender: message.senderType === "Agent" ? (message.senderAgent ?? "") : (message.senderPerson ?? ""),
      at: message.createdAt.toISOString(),
      en: String(content.en ?? ""),
      ar: String(content.ar ?? ""),
      artifact: content.artifact
        ? { name: String(content.artifact), noteEn: String(content.artifactNoteEn ?? ""), noteAr: String(content.artifactNoteAr ?? "") }
        : null,
      attachment: content.attachment ? { name: String(content.attachment) } : null,
      question: questions.get(String(content.question)) ?? null,
      approval: approval
        ? {
            key: approval.key,
            action: approval.action,
            risk: approval.risk,
            changesEn: approval.action,
            changesAr: approval.action,
            // D19, D253: who decides it: the requester, or the approvers of a call that
            // changes who may do what.
            approvers: (approval.requesterHolds ? approval.requesterName : approval.approverNames) ?? "",
            status: approval.status,
            inboxItemId: approval.inboxItemId,
            requester: approval.requesterName,
            // D19: the person who started the mission decides it, while it is still open and
            // they hold the row to write the decision against; for a call they may not decide,
            // an approver holding the row does (D253). Everyone else reads "awaiting approval".
            // A row with no recorded requester offers the decision to nobody here.
            mayDecide:
              approval.inboxItemId !== null &&
              approval.status === "Pending" &&
              approval.requesterId !== null &&
              (approval.requesterHolds ? approval.requesterId === personId : approval.requesterId !== personId),
          }
        : null,
      agentMeta:
        message.senderType === "Agent"
          ? {
              version: `v${message.agentVersion ?? 1}`,
              runKey: null,
            }
          : null,
      steps: message.senderType === "Agent" && message.runId ? toolSteps.filter((step) => step.runId === message.runId).map(stepAction) : [],
    };
  });

  const linked = await dbRo()
    .select({ key: s.workItem.key, titleEn: s.workItem.titleEn, titleAr: s.workItem.titleAr })
    .from(s.roomWorkItemLink)
    .innerJoin(s.workItem, eq(s.workItem.id, s.roomWorkItemLink.workItemId))
    .where(eq(s.roomWorkItemLink.roomId, row.id));

  // `UC-23.1-07`: a room's files — what was uploaded to it, and what an agent generated and
  // saved against it — shown as one board, newest first. An artifact carries no bytes of its
  // own size here; its version does, and the room board only needs to say which file it is.
  // `execute()` returns a raw driver row, so a timestamp arrives as the string the driver
  // gave back rather than the `Date` a typed `.select()` would have parsed.
  const { rows: fileRows } = await dbRo().execute<{
    name: string;
    kind: "attachment" | "artifact";
    mime_type: string | null;
    size: number | null;
    by: string | null;
    at: string;
  }>(sql`
    select file_name as name, 'attachment' as kind, mime_type, size, uploaded_by::text as by, created_at as at
    from work.attachment where owner_type = 'Room' and owner_id = ${row.id}
    union all
    select a.name_en as name, 'artifact' as kind, v.mime_type, v.size, a.produced_by_id::text as by, a.created_at as at
    from work.artifact a left join work.artifact_version v on v.id = a.current_version_id
    where a.linked_to_type = 'Room' and a.linked_to_id = ${row.id}
    order by at desc
  `);

  // `UC-23.3-04`'s "Working" tag and the thread's own typing row both read this: an agent
  // participant with a run still in flight for this room, not whatever a browser tab last
  // did — a page opened fresh has to show the same thing a page left open does.
  // The run is carried too, so the thread can stream its reply as it is written (D161).
  const working = new Map(
    (
      await dbRo()
        .select({ agentCode: s.agent.code, runId: s.run.id })
        .from(s.run)
        .innerJoin(s.agent, eq(s.agent.id, s.run.agentId))
        .where(
          and(
            eq(s.run.contextType, "Room"),
            eq(s.run.contextId, row.id),
            inArray(s.run.status, ["Queued", "Running", "Waiting"]),
          ),
        )
        .orderBy(asc(s.run.createdAt))
    ).map((one) => [one.agentCode, one.runId] as const),
  );

  return {
    room: toSession(row, participants),
    roomId: row.id,
    projectNameEn: row.projectNameEn,
    projectNameAr: row.projectNameAr,
    participants: participants.map((participant) => ({
      id: participant.id,
      role: participant.role,
      isAgent: participant.isAgent,
      working: participant.isAgent && working.has(participant.id),
      runId: participant.isAgent ? (working.get(participant.id) ?? null) : null,
    })),
    turnTaking: row.turnTaking,
    earlier,
    messages,
    waitingQuestions,
    linkedWorkItems: linked,
    files: fileRows.map((one) => ({
      name: one.name,
      kind: one.kind,
      mimeType: one.mime_type,
      size: one.size,
      by: one.by,
      at: new Date(one.at).toISOString(),
    })),
    contextUsage: await readContextUsage(row.id),
  };
}

/**
 * The room's lead agent, the context window of its active version's primary route, and the input
 * tokens of its last run here that read any. The window counts only steps through active
 * providers and connections, the chain the gateway holds. Null when the room has no lead agent.
 */
async function readContextUsage(roomId: string): Promise<RoomContextUsage | null> {
  const [lead] = await dbRo()
    .select({ agentId: s.agent.id, agent: s.agent.code, routeId: s.route.id, route: s.route.alias })
    .from(s.roomParticipant)
    .innerJoin(s.agent, eq(s.agent.id, s.roomParticipant.principalId))
    .leftJoin(s.agentVersion, and(eq(s.agentVersion.agentId, s.agent.id), eq(s.agentVersion.isActive, true)))
    .leftJoin(s.route, eq(s.route.id, s.agentVersion.primaryRouteId))
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalType, "Agent"), eq(s.roomParticipant.roomRole, "LeadAgent")))
    .limit(1);
  if (!lead) return null;

  const [smallest] = lead.routeId
    ? await dbRo()
        .select({ window: sql<number | null>`min(${s.connectionAllowedModel.contextWindow})` })
        .from(s.routeStep)
        .innerJoin(s.modelProvider, eq(s.modelProvider.id, s.routeStep.providerId))
        .innerJoin(s.providerConnection, eq(s.providerConnection.id, s.routeStep.connectionId))
        .innerJoin(
          s.connectionAllowedModel,
          and(eq(s.connectionAllowedModel.connectionId, s.routeStep.connectionId), eq(s.connectionAllowedModel.modelName, s.routeStep.modelName)),
        )
        .where(and(eq(s.routeStep.routeId, lead.routeId), eq(s.modelProvider.isActive, true), eq(s.providerConnection.isActive, true)))
    : [];

  const [last] = await dbRo()
    .select({ tokensIn: s.run.tokensIn })
    .from(s.run)
    .where(and(eq(s.run.contextType, "Room"), eq(s.run.contextId, roomId), eq(s.run.agentId, lead.agentId), sql`${s.run.tokensIn} > 0`))
    .orderBy(desc(s.run.createdAt))
    .limit(1);

  return { agent: lead.agent, route: lead.route, window: smallest?.window ?? null, lastTokensIn: last?.tokensIn ?? null };
}

/** The next room key in the `SES-` sequence. */
async function nextRoomKey(): Promise<string> {
  const { rows } = await db().execute<{ next: number }>(sql`
    select coalesce(max(substring(key from '[0-9]+$')::int), 1000) + 1 as next from work.discussion_room
  `);
  return `SES-${rows[0]?.next ?? 1001}`;
}

export type NewRoom = {
  projectKey: string;
  titleEn: string;
  titleAr: string;
  type: string;
  turnTaking: string;
  status: string;
  participants: { type: string; id: string }[];
  createdBy: string;
};

/**
 * Creates a Console room with its participants in one transaction and returns its key. The room
 * starts with an agent hop limit of 6 and a cost cap of 25 AED. Throws when the project does not exist.
 */
export async function createRoom(input: NewRoom): Promise<string> {
  const key = await createRoomRows(input);
  await tellJoined(key, input.participants.filter((p) => p.type === "Person").map((p) => p.id), input.createdBy);
  return key;
}

/**
 * D395: people put in a room are told in their Inbox and by email, with a link that opens it.
 * Whoever put them there is not told. One notice each time, so adding someone again tells them again.
 */
export async function tellJoined(roomKey: string, personIds: string[], actedBy: string): Promise<void> {
  const people = [...new Set(personIds)].filter((id) => id !== actedBy);
  if (people.length === 0) return;
  const [room] = await db().select({ titleEn: s.discussionRoom.titleEn, titleAr: s.discussionRoom.titleAr }).from(s.discussionRoom).where(eq(s.discussionRoom.key, roomKey));
  if (!room) return;
  const path = `/discussion-rooms/${encodeURIComponent(roomKey)}`;
  const titleEn = `You were added to room ${roomKey}: ${room.titleEn}`;
  const titleAr = `تمت إضافتك إلى الغرفة ${roomKey}: ${room.titleAr || room.titleEn}`;
  const items = await insertUpdateItems(db(), { people, sourceType: "RoomAdded", sourceId: crypto.randomUUID(), titleEn, titleAr, path, actorId: actedBy });
  await announce({ mail: await queueAlertEmails(db(), { items, kind: "Update", titleEn, titleAr, path, actorId: actedBy }), told: items.map((item) => item.personId) });
}

async function createRoomRows(input: NewRoom): Promise<string> {
  const key = await nextRoomKey();
  await db().transaction(async (tx) => {
    const [project] = await tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.projectKey)).limit(1);
    if (!project) throw new Error(`No project ${input.projectKey}.`);
    const [room] = await tx
      .insert(s.discussionRoom)
      .values({
        key,
        projectId: project.id,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        type: input.type,
        source: "Console",
        status: input.status,
        turnTaking: input.turnTaking,
        agentHopLimit: 6,
        costCapAed: 25,
        lastActivityAt: new Date(),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      })
      .returning({ id: s.discussionRoom.id });

    // `UC-22.2-01`: the person who creates the room owns it and is in it, whether or not they
    // picked themselves; everybody else they picked is a member (D167). The first agent leads.
    const others = input.participants.filter((p) => !(p.type === "Person" && p.id === input.createdBy));
    const firstAgent = others.find((p) => p.type === "Agent");
    await tx.insert(s.roomParticipant).values([
      { roomId: room.id, principalType: "Person", principalId: input.createdBy, roomRole: "Owner" },
      ...others.map((participant) => ({
        roomId: room.id,
        principalType: participant.type,
        principalId: participant.id,
        roomRole: participant.type === "Agent" ? (participant === firstAgent ? "LeadAgent" : "MemberAgent") : "Member",
      })),
    ]);
  });
  return key;
}

/** Links a room to the work item it was converted from (or raised against). */
export async function linkWorkItem(roomKey: string, workItemId: string): Promise<void> {
  const [room] = await db().select({ id: s.discussionRoom.id }).from(s.discussionRoom).where(eq(s.discussionRoom.key, roomKey)).limit(1);
  if (!room) throw new Error(`No room ${roomKey}.`);
  await db().insert(s.roomWorkItemLink).values({ roomId: room.id, workItemId }).onConflictDoNothing();
}

/** Appends a message to a room and moves its last-activity stamp. */
export async function postMessage(roomKey: string, senderId: string, text: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [room] = await tx
      .select({ id: s.discussionRoom.id, seq: sql<number>`coalesce((select max(m.seq) from work.room_message m where m.room_id = ${outer(s.discussionRoom.id)}), 0)::int` })
      .from(s.discussionRoom)
      .where(eq(s.discussionRoom.key, roomKey))
      .limit(1);
    if (!room) throw new Error(`No room ${roomKey}.`);
    await tx.insert(s.roomMessage).values({
      roomId: room.id,
      seq: room.seq + 1,
      senderType: "Person",
      senderId,
      contentJson: { kind: "text", en: text, ar: text },
    });
    await tx.update(s.discussionRoom).set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: senderId }).where(eq(s.discussionRoom.id, room.id));
  });
}

/** Specification 7.2: the room owner sets how agents take turns. */
export async function setTurnTaking(roomKey: string, turnTaking: string, version: number, personId: string): Promise<void> {
  const rows = await db()
    .update(s.discussionRoom)
    .set({ turnTaking, updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.discussionRoom.key, roomKey), eq(s.discussionRoom.version, version)))
    .returning({ id: s.discussionRoom.id });
  assertWritten(rows, "DiscussionRoom");
}

/** Resolves a participant code the form sends — a person id or an agent code. */
export const resolvePrincipal = selectPrincipalByCode;

/** The row id of a project, or `null` when no project has the key. */
export async function projectIdByKey(key: string): Promise<string | null> {
  const [row] = await dbRo().select({ id: s.project.id }).from(s.project).where(eq(s.project.key, key)).limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------------- S-23: what a room's own acts need */

/** An id no row has, so "visible: none" selects nothing rather than everything. */
const NO_ROOM_PROJECT = "00000000-0000-0000-0000-000000000000";

/** The room as `turns.ts` needs it, with what has been spent in it so far. */
export type RoomRulesRow = {
  id: string;
  projectId: string;
  projectKey: string;
  status: string;
  turnTaking: string;
  agentHopLimit: number;
  costCapAed: number | null;
  estimatedSpendAed: number;
  version: number;
};

/** The room's rules by key, or null when no room has it. */
export async function readRoomRules(key: string): Promise<RoomRulesRow | null> {
  return oneRoomRules(eq(s.discussionRoom.key, key));
}

/**
 * The same rules by row id, for the paths that already hold one: a run finishing knows the
 * room it answered, not the key a person typed.
 */
export async function readRoomRulesById(roomId: string): Promise<RoomRulesRow | null> {
  return oneRoomRules(eq(s.discussionRoom.id, roomId));
}

/** The first room matching `match` with its project key and the estimated spend of its runs. */
async function oneRoomRules(match: SQL | undefined): Promise<RoomRulesRow | null> {
  const [row] = await dbRo()
    .select({
      id: s.discussionRoom.id,
      projectId: s.discussionRoom.projectId,
      projectKey: s.project.key,
      status: s.discussionRoom.status,
      turnTaking: s.discussionRoom.turnTaking,
      agentHopLimit: s.discussionRoom.agentHopLimit,
      costCapAed: sql<number | null>`${s.discussionRoom.costCapAed}::float8`,
      // Every run this room has started, which is what the cap is measured against.
      estimatedSpendAed: sql<number>`coalesce((
        select sum(r.estimated_cost_aed) from ai.run r
        where r.context_type = 'Room' and r.context_id = ${s.discussionRoom.id}
      ), 0)::float8`,
      version: s.discussionRoom.version,
    })
    .from(s.discussionRoom)
    .innerJoin(s.project, eq(s.project.id, s.discussionRoom.projectId))
    .where(match)
    .limit(1);
  return row ?? null;
}

/** The room's participants, named as the screens name them. */
export async function readParticipants(roomId: string): Promise<{ id: string; isAgent: boolean; role: string; handle: string }[]> {
  const rows = await dbRo()
    .select({
      principalType: s.roomParticipant.principalType,
      personId: s.person.id,
      email: s.person.email,
      agentCode: s.agent.code,
      role: s.roomParticipant.roomRole,
    })
    .from(s.roomParticipant)
    .leftJoin(s.person, eq(s.person.id, s.roomParticipant.principalId))
    .leftJoin(s.agent, eq(s.agent.id, s.roomParticipant.principalId))
    .where(eq(s.roomParticipant.roomId, roomId));
  return rows.map((row) => ({
    id: (row.principalType === "Agent" ? row.agentCode : row.personId) ?? "",
    isAgent: row.principalType === "Agent",
    role: row.role,
    // D163: what `@` names them by — a person's e-mail name, as a comment mention uses it.
    handle: (row.principalType === "Agent" ? row.agentCode : row.email?.split("@")[0]) ?? "",
  }));
}

/**
 * The people in a room, which is what the least-privileged read is measured against
 * (spec section 11). Agents are not in it: a floor made of agents would bound a read by
 * another agent's grant rather than by what a person in the room may see.
 */
export async function humanMemberIds(roomId: string): Promise<string[]> {
  const rows = await dbRo()
    .select({ personId: s.roomParticipant.principalId })
    .from(s.roomParticipant)
    .innerJoin(s.person, eq(s.person.id, s.roomParticipant.principalId))
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalType, "Person")));
  return rows.map((row) => row.personId);
}

/**
 * Where a run is acting, read from the run's own row.
 *
 * The context type is derived server-side when the run starts (D70), so this is the one
 * trustworthy answer to "is this call coming from inside a room, and which one".
 */
export async function roomContextOfRun(runId: string): Promise<{ contextType: string; roomId: string | null } | null> {
  const [row] = await dbRo()
    .select({ contextType: s.run.contextType, roomId: s.discussionRoom.id })
    .from(s.run)
    .leftJoin(s.discussionRoom, eq(s.discussionRoom.id, s.run.contextId))
    .where(eq(s.run.id, runId))
    .limit(1);
  return row ?? null;
}

/** Whether an agent is still a participant, so a run's reply stops when it is removed. */
export async function isAgentParticipant(roomId: string, agentId: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ one: sql<number>`1` })
    .from(s.roomParticipant)
    .where(
      and(
        eq(s.roomParticipant.roomId, roomId),
        eq(s.roomParticipant.principalType, "Agent"),
        eq(s.roomParticipant.principalId, agentId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * How many agent messages have been posted since the last one from a person.
 *
 * `UC-23.1-08`: this is what the turn limit counts, which is why a human message resets it
 * rather than the counter being stored and cleared.
 *
 * The room's own notes are skipped rather than counted or treated as a reset: a note
 * saying the limit was reached is written by the platform, and letting it stand in for a
 * person's message would hand the room a fresh allowance every time it said so.
 */
export async function hopsSinceHuman(
  roomId: string,
): Promise<{ hops: number; lastSenderType: string | null }> {
  const rows = await dbRo()
    .select({ senderType: s.roomMessage.senderType })
    .from(s.roomMessage)
    .where(eq(s.roomMessage.roomId, roomId))
    .orderBy(desc(s.roomMessage.seq))
    .limit(50);

  let hops = 0;
  for (const row of rows) {
    if (row.senderType === "System") continue;
    if (row.senderType !== "Agent") break;
    hops += 1;
  }
  return { hops, lastSenderType: rows[0]?.senderType ?? null };
}

/** The opening of an agent's instructions, which is what the agent is for (D289). */
const PURPOSE_CHARS = 600;

/** Each of these agents' name and purpose, from its active version, for choosing one (D289). */
export async function agentPurposes(codes: string[]): Promise<{ code: string; name: string; purpose: string }[]> {
  if (codes.length === 0) return [];
  const rows = await dbRo()
    .select({ code: s.agent.code, name: s.agent.nameEn, instructions: s.agentVersion.instructions })
    .from(s.agent)
    .leftJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .where(inArray(s.agent.code, codes));
  return rows.map((row) => ({ code: row.code, name: row.name, purpose: (row.instructions ?? "").slice(0, PURPOSE_CHARS) }));
}

/** Appends one message and returns its id and sequence. */
export async function appendMessage(input: {
  roomId: string;
  senderType: string;
  senderId: string | null;
  content: Record<string, unknown>;
  runId?: string | null;
  /** The person behind the post; null for a widget visitor, who is nobody on the platform. */
  actedBy: string | null;
}): Promise<{ id: string; seq: number }> {
  return db().transaction(async (tx) => {
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(seq), 0) + 1 as next from work.room_message where room_id = ${input.roomId}`,
    );
    const [created] = await tx
      .insert(s.roomMessage)
      .values({
        roomId: input.roomId,
        seq: rows[0].next,
        senderType: input.senderType,
        senderId: input.senderId,
        contentJson: input.content,
        runId: input.runId ?? null,
      })
      .returning({ id: s.roomMessage.id });
    await tx
      .update(s.discussionRoom)
      .set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: input.actedBy })
      .where(eq(s.discussionRoom.id, input.roomId));
    return { id: created.id, seq: rows[0].next };
  });
}

/** One message of a room's recent history, as an agent run's own `conversation` names it. */
export type ConversationEntry = { role: "user" | "assistant" | "system"; author: string; text: string; attachment: string | null };

/**
 * The room's last `limit` messages, oldest first, with each attachment's name carried
 * alongside the message that announced it — what a run started on this room carries in as
 * its own history, before the harness compacts it against the model's budget.
 */
export async function recentMessagesForConversation(roomId: string, limit: number): Promise<ConversationEntry[]> {
  const rows = await dbRo()
    .select({
      senderType: s.roomMessage.senderType,
      personName: s.person.nameEn,
      agentCode: s.agent.code,
      content: s.roomMessage.contentJson,
    })
    .from(s.roomMessage)
    .leftJoin(s.person, and(eq(s.roomMessage.senderType, "Person"), eq(s.person.id, s.roomMessage.senderId)))
    .leftJoin(s.agent, and(eq(s.roomMessage.senderType, "Agent"), eq(s.agent.id, s.roomMessage.senderId)))
    .where(eq(s.roomMessage.roomId, roomId))
    .orderBy(desc(s.roomMessage.seq))
    .limit(limit);

  return rows
    .reverse()
    .map((row) => {
      const content = row.content as Record<string, unknown>;
      return {
        role: row.senderType === "Agent" ? ("assistant" as const) : ("user" as const),
        author: row.senderType === "Agent" ? (row.agentCode ?? "") : (row.personName ?? ""),
        text: String(content.en ?? ""),
        attachment: typeof content.attachment === "string" ? content.attachment : null,
      };
    })
    .filter((entry) => entry.text !== "" || entry.attachment !== null);
}

/** The content ref an attachment of this name on this room was stored under, for extraction. */
export async function roomAttachmentRef(roomId: string, fileName: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ contentRef: s.attachment.contentRef })
    .from(s.attachment)
    .where(and(eq(s.attachment.ownerType, "Room"), eq(s.attachment.ownerId, roomId), eq(s.attachment.fileName, fileName)))
    .orderBy(desc(s.attachment.createdAt))
    .limit(1);
  return row?.contentRef ?? null;
}

/** `UC-23.1-05`: one person's verdict on one agent message. Replaces their earlier one. */
export async function saveFeedback(messageId: string, personId: string, value: string): Promise<void> {
  await db()
    .insert(s.messageFeedback)
    .values({ messageId, personId, value, createdBy: personId, updatedBy: personId })
    .onConflictDoUpdate({
      target: [s.messageFeedback.messageId, s.messageFeedback.personId],
      set: { value, updatedAt: new Date(), updatedBy: personId },
    });
}

/** `UC-23.1-05`: the verdict a person has already given, so the screen opens on it. */
export async function feedbackOf(messageIds: string[], personId: string): Promise<Record<string, string>> {
  if (messageIds.length === 0) return {};
  const rows = await dbRo()
    .select({ messageId: s.messageFeedback.messageId, value: s.messageFeedback.value })
    .from(s.messageFeedback)
    .where(and(inArray(s.messageFeedback.messageId, messageIds), eq(s.messageFeedback.personId, personId)));
  return Object.fromEntries(rows.map((row) => [row.messageId, row.value]));
}

/**
 * `UC-23.3-04`: somebody joins the room. An agent joining a room where no other agent leads
 * becomes its lead, so an Autonomous room with agents always has one to answer when the
 * platform cannot choose (D289).
 * The room row is locked so two joins cannot both take the lead.
 */
export async function addParticipant(roomId: string, principal: { type: string; id: string }): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.select({ id: s.discussionRoom.id }).from(s.discussionRoom).where(eq(s.discussionRoom.id, roomId)).for("update");
    let role = "Member";
    if (principal.type === "Agent") {
      const [lead] = await tx
        .select({ id: s.roomParticipant.principalId })
        .from(s.roomParticipant)
        .where(
          and(
            eq(s.roomParticipant.roomId, roomId),
            eq(s.roomParticipant.roomRole, "LeadAgent"),
            ne(s.roomParticipant.principalId, principal.id),
          ),
        )
        .limit(1);
      role = lead ? "MemberAgent" : "LeadAgent";
    }
    const insert = tx
      .insert(s.roomParticipant)
      .values({ roomId, principalType: principal.type, principalId: principal.id, roomRole: role });
    // A person already in the room keeps the role they have: adding them again must not
    // turn the Owner or an Admin back into a Member (D392).
    await (principal.type === "Agent"
      ? insert.onConflictDoUpdate({
          target: [s.roomParticipant.roomId, s.roomParticipant.principalType, s.roomParticipant.principalId],
          set: { roomRole: role },
        })
      : insert.onConflictDoNothing());
  });
}

/** The role one person holds in a room, or null when they are not in it. */
export async function roomRoleOf(roomId: string, personId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ role: s.roomParticipant.roomRole })
    .from(s.roomParticipant)
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalId, personId)))
    .limit(1);
  return row?.role ?? null;
}

/** D392: makes a person in the room an Admin, or a Member again. */
export async function setPersonRole(roomId: string, personId: string, role: "Admin" | "Member"): Promise<void> {
  await db()
    .update(s.roomParticipant)
    .set({ roomRole: role })
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalId, personId)));
}

/** `UC-23.3-04`: somebody leaves the room. When the lead agent leaves, the agent that joined earliest takes the lead. */
export async function removeParticipant(roomId: string, principalId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.select({ id: s.discussionRoom.id }).from(s.discussionRoom).where(eq(s.discussionRoom.id, roomId)).for("update");
    const removed = await tx
      .delete(s.roomParticipant)
      .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalId, principalId)))
      .returning({ role: s.roomParticipant.roomRole });
    if (!removed.some((row) => row.role === "LeadAgent")) return;
    const [next] = await tx
      .select({ id: s.roomParticipant.principalId })
      .from(s.roomParticipant)
      .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalType, "Agent")))
      .orderBy(asc(s.roomParticipant.joinedAt), asc(s.roomParticipant.principalId))
      .limit(1);
    if (!next) return;
    await tx
      .update(s.roomParticipant)
      .set({ roomRole: "LeadAgent" })
      .where(
        and(
          eq(s.roomParticipant.roomId, roomId),
          eq(s.roomParticipant.principalType, "Agent"),
          eq(s.roomParticipant.principalId, next.id),
        ),
      );
  });
}

/** `UC-23.3-06`: the room is closed, with the handoff that is its final state. */
export async function closeRoom(
  roomId: string,
  handoff: { goal: string; decisions: string; openQuestions: string; nextStep: string },
  personId: string,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(s.discussionRoom)
      .set({ status: "Closed", updatedAt: new Date(), updatedBy: personId })
      .where(eq(s.discussionRoom.id, roomId));
    await tx
      .insert(s.contextHandoff)
      .values({
        ownerType: "Room",
        ownerId: roomId,
        goal: handoff.goal,
        decisions: handoff.decisions,
        openQuestions: handoff.openQuestions,
        nextStep: handoff.nextStep,
        createdBy: personId,
        updatedBy: personId,
      })
      .onConflictDoUpdate({
        target: [s.contextHandoff.ownerType, s.contextHandoff.ownerId],
        set: {
          goal: handoff.goal,
          decisions: handoff.decisions,
          openQuestions: handoff.openQuestions,
          nextStep: handoff.nextStep,
          updatedAt: new Date(),
          updatedBy: personId,
        },
      });
  });
}

/** What a room has said, for the handoff a close writes and for a fork to carry over. */
export async function transcriptOf(roomId: string, limit = 200): Promise<{ sender: string; text: string }[]> {
  const rows = await dbRo()
    .select({
      senderType: s.roomMessage.senderType,
      personName: s.person.nameEn,
      agentCode: s.agent.code,
      content: s.roomMessage.contentJson,
    })
    .from(s.roomMessage)
    .leftJoin(s.person, eq(s.person.id, s.roomMessage.senderId))
    .leftJoin(s.agent, eq(s.agent.id, s.roomMessage.senderId))
    .where(eq(s.roomMessage.roomId, roomId))
    .orderBy(asc(s.roomMessage.seq))
    .limit(limit);
  return rows.map((row) => ({
    sender: (row.senderType === "Agent" ? row.agentCode : row.personName) ?? "",
    text: String((row.content as { en?: unknown }).en ?? ""),
  }));
}

/** `UC-23.3-05`: a new room linked to the one it came from. */
export async function forkRoom(input: {
  fromRoomId: string;
  titleEn: string;
  titleAr: string;
  carryOver: string | null;
  personId: string;
}): Promise<string> {
  const joined: string[] = [];
  const key = await db().transaction(async (tx) => {
    const [source] = await tx.select().from(s.discussionRoom).where(eq(s.discussionRoom.id, input.fromRoomId)).limit(1);
    if (!source) throw new Error("No such room.");
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(substring(key from '[0-9]+$')::int), 1000) + 1 as next from work.discussion_room`,
    );
    const key = `SES-${rows[0].next}`;
    const [created] = await tx
      .insert(s.discussionRoom)
      .values({
        key,
        projectId: source.projectId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        type: source.type,
        source: "Console",
        status: "Active",
        turnTaking: source.turnTaking,
        agentHopLimit: source.agentHopLimit,
        costCapAed: source.costCapAed,
        forkedFromRoomId: source.id,
        lastActivityAt: new Date(),
        createdBy: input.personId,
        updatedBy: input.personId,
      })
      .returning({ id: s.discussionRoom.id });

    const participants = await tx.select().from(s.roomParticipant).where(eq(s.roomParticipant.roomId, source.id));
    joined.push(...participants.filter((p) => p.principalType === "Person").map((p) => p.principalId));
    if (participants.length > 0) {
      await tx.insert(s.roomParticipant).values(
        participants.map((participant) => ({
          roomId: created.id,
          principalType: participant.principalType,
          principalId: participant.principalId,
          roomRole: participant.roomRole,
        })),
      );
    }

    // The context carried over is the first message of the new room, so everybody who opens
    // it reads what it was forked with rather than having to find the room it came from.
    if (input.carryOver) {
      await tx.insert(s.roomMessage).values({
        roomId: created.id,
        seq: 1,
        senderType: "Person",
        senderId: input.personId,
        contentJson: { kind: "text", en: input.carryOver, ar: input.carryOver },
      });
    }
    return key;
  });
  await tellJoined(key, joined, input.personId);
  return key;
}

/**
 * What still points at a room and would block deleting it: another room forked from it, a
 * request raised from it, and a deployment conversation mirrored into it. Its own
 * composition — participants, messages, the room-to-work-item links, and the handoff a
 * close wrote — is removed with it rather than reported here.
 */
export async function roomDeleteBlockers(roomId: string): Promise<{
  forkedRooms: number;
  requests: number;
  deploymentConversations: number;
}> {
  const countIn = (table: string, column: string) =>
    sql<number>`(select count(*) from ${sql.raw(table)} x where x.${sql.raw(column)} = ${outer(s.discussionRoom.id)})::int`;
  const [row] = await dbRo()
    .select({
      forkedRooms: countIn("work.discussion_room", "forked_from_room_id"),
      requests: countIn("work.request", "origin_room_id"),
      deploymentConversations: countIn("ai.deployment_conversation", "room_id"),
    })
    .from(s.discussionRoom)
    .where(eq(s.discussionRoom.id, roomId))
    .limit(1);
  return row ?? { forkedRooms: 0, requests: 0, deploymentConversations: 0 };
}

/** The room and its own composition — messages, participants, links and the handoff. */
export async function deleteRoom(roomId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.roomMessage).where(eq(s.roomMessage.roomId, roomId));
    await tx.delete(s.contextHandoff).where(and(eq(s.contextHandoff.ownerType, "Room"), eq(s.contextHandoff.ownerId, roomId)));
    await tx.delete(s.discussionRoom).where(eq(s.discussionRoom.id, roomId));
  });
}

/** `UC-22.1-05`: the rooms this person may see, by project and by participation. */
/** The room list's filters (S-22): a status, a project by key, and free text over title and key. */
export type RoomListFilters = { status?: string; projectKey?: string; text?: string };

/**
 * `UC-22.1-05`: the rooms a person reaches — those of the projects they may read rooms in
 * (`null` is every project), and any room they are in.
 */
function visibleRooms(visibleIds: string[] | null, personId: string): SQL | undefined {
  if (visibleIds === null) return undefined;
  return or(
    inArray(s.discussionRoom.projectId, visibleIds.length > 0 ? visibleIds : [NO_ROOM_PROJECT]),
    exists(
      dbRo()
        .select({ one: sql`1` })
        .from(s.roomParticipant)
        .where(and(eq(s.roomParticipant.roomId, s.discussionRoom.id), eq(s.roomParticipant.principalId, personId))),
    ),
  );
}

/** The visible rooms that pass the list's filters. */
function roomListWhere(visibleIds: string[] | null, personId: string, filters: RoomListFilters): SQL | undefined {
  return and(
    visibleRooms(visibleIds, personId),
    filters.status ? eq(s.discussionRoom.status, filters.status) : undefined,
    filters.projectKey ? eq(s.project.key, filters.projectKey) : undefined,
    filters.text ? containsTerm(s.discussionRoom.searchKey, filters.text) : undefined,
  );
}

/**
 * One page of the rooms a person may see that pass the filters, latest activity first. The
 * page's ids are chosen first, so the message count and spend are read for its rows only and
 * not for every row an offset skips.
 */
export async function listRoomsVisibleTo(
  visibleIds: string[] | null,
  personId: string,
  filters: RoomListFilters,
  page: { limit: number; offset: number },
): Promise<Session[]> {
  const ids = (
    await dbRo()
      .select({ id: s.discussionRoom.id })
      .from(s.discussionRoom)
      .innerJoin(s.project, eq(s.project.id, s.discussionRoom.projectId))
      .where(roomListWhere(visibleIds, personId, filters))
      .orderBy(desc(sql`coalesce(${s.discussionRoom.lastActivityAt}, ${s.discussionRoom.createdAt})`), desc(s.discussionRoom.id))
      .limit(page.limit)
      .offset(page.offset)
  ).map((row) => row.id);
  if (ids.length === 0) return [];
  const read = await dbRo()
    .select(roomColumns)
    .from(s.discussionRoom)
    .innerJoin(s.project, eq(s.project.id, s.discussionRoom.projectId))
    .where(inArray(s.discussionRoom.id, ids));
  const rows = ids.map((id) => read.find((row) => row.id === id)).filter((row) => row !== undefined);
  const participants = await participantsOf(rows.map((row) => row.id));
  return rows.map((row) => toSession(row, participants.get(row.id) ?? []));
}

/** How many rooms a person may see pass the filters. */
export async function countRoomsVisibleTo(visibleIds: string[] | null, personId: string, filters: RoomListFilters): Promise<number> {
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.discussionRoom)
    .innerJoin(s.project, eq(s.project.id, s.discussionRoom.projectId))
    .where(roomListWhere(visibleIds, personId, filters));
  return row?.count ?? 0;
}

/** S-22's counters over every room the person may see, whatever the list's filters. */
export async function roomCounts(visibleIds: string[] | null, personId: string): Promise<RoomCounts> {
  const visible = visibleRooms(visibleIds, personId);
  const [[rooms], [messages]] = await Promise.all([
    dbRo()
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${s.discussionRoom.status} = 'Active'))::int`,
        archived: sql<number>`(count(*) filter (where ${s.discussionRoom.status} = 'Archived'))::int`,
      })
      .from(s.discussionRoom)
      .where(visible),
    dbRo()
      .select({ count: sql<number>`count(*)::int` })
      .from(s.roomMessage)
      .innerJoin(s.discussionRoom, eq(s.discussionRoom.id, s.roomMessage.roomId))
      .where(visible),
  ]);
  return { total: rooms?.total ?? 0, active: rooms?.active ?? 0, archived: rooms?.archived ?? 0, messages: messages?.count ?? 0 };
}

/** Whether one person is a participant of a room, which is what a private room turns on. */
export async function isParticipant(roomId: string, personId: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ one: sql<number>`1` })
    .from(s.roomParticipant)
    .where(and(eq(s.roomParticipant.roomId, roomId), eq(s.roomParticipant.principalId, personId)))
    .limit(1);
  return row !== undefined;
}

/**
 * `UC-23.4-03`: a work item created from a room message has the room as its origin, is
 * listed among the room's linked work items, and is named on the message it came from.
 */
export async function linkWorkItemToMessage(roomId: string, messageId: string, workItemKey: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [item] = await tx
      .update(s.workItem)
      .set({ originType: "Room", originId: roomId })
      .where(eq(s.workItem.key, workItemKey))
      .returning({ id: s.workItem.id });
    if (!item) throw new Error(`No work item ${workItemKey}.`);
    await tx.insert(s.roomWorkItemLink).values({ roomId, workItemId: item.id }).onConflictDoNothing();
    await tx.execute(sql`
      update work.room_message
      set content_json = content_json || jsonb_build_object('workItemKey', ${workItemKey}::text)
      where id = ${messageId} and room_id = ${roomId}
    `);
  });
}

/**
 * The agent codes a project allows, or `null` when it names none.
 *
 * An empty allow-list means "every agent the trust level allows" (data model section 4), so
 * it is reported as `null` rather than as an empty list, which would offer nobody.
 */
export async function allowedAgentCodesForProject(projectKey: string): Promise<string[] | null> {
  const rows = await dbRo()
    .select({ code: s.agent.code })
    .from(s.projectAllowedAgent)
    .innerJoin(s.project, eq(s.project.id, s.projectAllowedAgent.projectId))
    .innerJoin(s.agent, eq(s.agent.id, s.projectAllowedAgent.agentId))
    .where(eq(s.project.key, projectKey));
  return rows.length === 0 ? null : rows.map((row) => row.code);
}

/**
 * `UC-23.1-06`: a mention of a person reaches their Inbox.
 *
 * The item points at the message, so opening it from the Inbox opens the room at what was
 * said rather than at the room's beginning. Mentioning the same person twice in one message
 * is one item, which the unique index already decides.
 */
export async function notifyMentions(messageId: string, personIds: string[], actedBy: string): Promise<void> {
  if (personIds.length === 0) return;
  const items = await db()
    .insert(s.inboxItem)
    .values(
      personIds.map((personId) => ({
        personId,
        kind: "Mention",
        sourceType: "RoomMessage",
        sourceId: messageId,
        status: "Open",
        createdBy: actedBy,
        updatedBy: actedBy,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: s.inboxItem.id, personId: s.inboxItem.personId });
  const [room] = await db()
    .select({ key: s.discussionRoom.key, titleEn: s.discussionRoom.titleEn, titleAr: s.discussionRoom.titleAr })
    .from(s.roomMessage)
    .innerJoin(s.discussionRoom, eq(s.discussionRoom.id, s.roomMessage.roomId))
    .where(eq(s.roomMessage.id, messageId));
  if (!room) return;
  await enqueueMailJobs(
    await queueAlertEmails(db(), {
      items,
      kind: "Mention",
      titleEn: `You were mentioned in ${room.titleEn}`,
      titleAr: `تمت الإشارة إليك في ${room.titleAr || room.titleEn}`,
      path: `/discussion-rooms/${encodeURIComponent(room.key)}`,
      actorId: actedBy,
    }),
  );
}

/** The person ids behind the directory ids a mention names. */
export async function peopleByIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await dbRo().select({ id: s.person.id }).from(s.person).where(inArray(s.person.id, ids));
  return rows.map((row) => row.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Questions matching `where`, as `personId` sees them: only the person a question was asked of answers it, while it is
 * unanswered and its run is not cancelled (the same rule the Inbox applies).
 */
async function readQuestions(where: SQL | undefined, personId: string): Promise<RoomQuestion[]> {
  const rows = await dbRo()
    .select({
      id: s.agentQuestion.id,
      question: s.agentQuestion.question,
      options: s.agentQuestion.options,
      answer: s.agentQuestion.answer,
      askedToId: s.agentQuestion.askedToId,
      askedTo: sql<string | null>`(select p.name_en from core.person p where p.id = ${outer(s.agentQuestion.askedToId)})`,
      answeredBy: sql<string | null>`(select p.name_en from core.person p where p.id = ${outer(s.agentQuestion.answeredBy)})`,
      runStatus: s.run.status,
    })
    .from(s.agentQuestion)
    .innerJoin(s.run, eq(s.run.id, s.agentQuestion.runId))
    .where(where)
    .orderBy(s.agentQuestion.createdAt);
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    options: row.options ?? [],
    answer: row.answer,
    answeredBy: row.answeredBy,
    askedTo: row.askedTo,
    mayAnswer: row.answer === null && row.askedToId === personId && row.runStatus !== "Cancelled",
  }));
}

/** The question cards a room's messages announce, by question id. */
export async function readRoomQuestions(ids: unknown[], personId: string): Promise<Map<string, RoomQuestion>> {
  const wanted = ids.filter((id): id is string => typeof id === "string" && UUID.test(id));
  if (!wanted.length) return new Map();
  const questions = await readQuestions(inArray(s.agentQuestion.id, wanted), personId);
  return new Map(questions.map((question) => [question.id, question]));
}

/**
 * The unanswered questions of runs in the room that no message announces: those asked before rooms announced
 * questions, or whose announcement failed. Without them a run in the room would wait with nothing to answer here.
 */
export async function readWaitingQuestions(roomId: string, announced: string[], personId: string): Promise<RoomQuestion[]> {
  return readQuestions(
    and(
      eq(s.run.contextType, "Room"),
      eq(s.run.contextId, roomId),
      isNull(s.agentQuestion.answer),
      sql`${s.run.status} <> 'Cancelled'`,
      announced.length ? notInArray(s.agentQuestion.id, announced) : undefined,
    ),
    personId,
  );
}
