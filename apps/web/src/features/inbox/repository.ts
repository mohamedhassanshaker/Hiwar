import { and, asc, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import { REQUESTER_DECIDES_IN } from "@/lib/approval-binding";
import type { InboxItem } from "./types";

/** The only module in `inbox` that touches Drizzle. */

/** How many items are open for this person — the sidebar badge and the top-bar badge. */
export async function countOpen(personId: string): Promise<number> {
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.inboxItem)
    .where(and(eq(s.inboxItem.personId, personId), eq(s.inboxItem.status, "Open")));
  return row?.count ?? 0;
}

const KIND: Record<string, string> = {
  Approval: "approval",
  Question: "question",
  Mention: "mention",
  SlaWarning: "sla",
  Review: "review",
  Update: "update",
};

/** The database's kind for each of the console's. */
const STORED_KIND = Object.fromEntries(Object.entries(KIND).map(([stored, kind]) => [kind, stored]));

/**
 * Which of a person's items to read: open or resolved ones, of one console kind, only the
 * urgent ones (an SLA warning or a high-risk approval), or one item by id; oldest first
 * unless `newestFirst`, a page at a time.
 */
export type ItemQuery = {
  status?: "Open" | "Resolved";
  kind?: string;
  urgent?: boolean;
  id?: string;
  newestFirst?: boolean;
  limit: number;
  offset?: number;
};

/** The conditions of an `ItemQuery` other than its person. A kind the console does not know matches nothing. */
function itemFilter(query: Omit<ItemQuery, "limit" | "offset" | "newestFirst">): SQL[] {
  return [
    query.status ? eq(s.inboxItem.status, query.status) : undefined,
    query.kind ? eq(s.inboxItem.kind, STORED_KIND[query.kind] ?? "-") : undefined,
    query.urgent ? or(eq(s.inboxItem.kind, "SlaWarning"), eq(s.approval.risk, "High")) : undefined,
    query.id ? eq(s.inboxItem.id, query.id) : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);
}

/**
 * How many of a person's open items there are of each console kind, and how many are
 * resolved: the Inbox's chips, the peek's chips, and the badge.
 */
export async function countForPerson(personId: string): Promise<{ open: Record<string, number>; resolved: number }> {
  const rows = await dbRo()
    .select({ kind: s.inboxItem.kind, status: s.inboxItem.status, count: sql<number>`count(*)::int` })
    .from(s.inboxItem)
    .where(eq(s.inboxItem.personId, personId))
    .groupBy(s.inboxItem.kind, s.inboxItem.status);
  const open: Record<string, number> = {};
  let resolved = 0;
  for (const row of rows) {
    if (row.status === "Resolved") resolved += row.count;
    else if (row.status === "Open" && KIND[row.kind]) open[KIND[row.kind]] = (open[KIND[row.kind]] ?? 0) + row.count;
  }
  return { open, resolved };
}

/** S-12: the items a query names for this person, with everything the pane shows. */
export async function listForPerson(personId: string, query: ItemQuery): Promise<InboxItem[]> {
  const rows = await dbRo()
    .select({
      id: s.inboxItem.id,
      kind: s.inboxItem.kind,
      status: s.inboxItem.status,
      createdAt: s.inboxItem.createdAt,
      sourceType: s.inboxItem.sourceType,
      // D394: an Update carries its own words and link.
      updateTitleEn: s.inboxItem.titleEn,
      updateTitleAr: s.inboxItem.titleAr,
      updateLink: s.inboxItem.linkPath,

      approvalKey: s.approval.key,
      approvalRisk: s.approval.risk,
      approvalAction: s.approval.action,
      approvalArgs: s.approval.argumentsRedacted,
      approvalEvidence: s.approval.evidence,
      approvalPolicy: s.approval.policy,
      approvalAgent: s.agent.code,
      approvalRun: sql<string | null>`(select r.key from ai.run r where r.id = ${outer(s.approval.runId)})`,
      approvalWorkItem: sql<string | null>`(select wi.key from work.work_item wi where wi.id = ${outer(s.approval.workItemId)})`,
      approvers: sql<string[]>`(
        select coalesce(array_agg(p.name_en order by ad.sequence), '{}')
        from ai.approval_decision ad join core.person p on p.id = ad.approver_person_id
        where ad.approval_id = ${s.approval.id}
      )`,

      question: s.agentQuestion.question,
      questionAgent: sql<string | null>`(
        select a.code from ai.agent a join ai.run r on r.agent_id = a.id where r.id = ${s.agentQuestion.runId}
      )`,
      questionRun: sql<string | null>`(select r.key from ai.run r where r.id = ${outer(s.agentQuestion.runId)})`,

      workItemKey: s.workItem.key,
      workItemTitleEn: s.workItem.titleEn,
      workItemTitleAr: s.workItem.titleAr,
      workItemAgent: sql<string | null>`(select a.code from ai.agent a where a.id = ${outer(s.workItem.assigneeId)})`,

      roomKey: s.discussionRoom.key,
      roomTitleEn: s.discussionRoom.titleEn,
      roomTitleAr: s.discussionRoom.titleAr,

      // D393: a registration waiting for approval is a Review item whose source is the person.
      registrantNameEn: s.person.nameEn,
      registrantNameAr: s.person.nameAr,

      approvalExpired: sql<boolean>`${s.approval.escalateAfter} is not null and ${s.approval.escalateAfter} < now()`,
      approvalRequestedBy: s.approval.createdBy,
      approvalRunStatus: sql<string | null>`(select r.status from ai.run r where r.id = ${outer(s.approval.runId)})`,
      approvalRunContext: sql<string | null>`(select r.context_type from ai.run r where r.id = ${outer(s.approval.runId)})`,
      questionOptions: s.agentQuestion.options,

      // `UC-72.1-04`: a budget crossing is told to the agent's owner, not decided by them.
      budgetAgent: sql<string | null>`(
        select a.code from ai.agent a
        join gov.agent_budget ab on ab.agent_id = a.id
        where ab.id = ${s.inboxItem.sourceId} and ${s.inboxItem.sourceType} = 'Budget'
      )`,
      budgetEvent: sql<string | null>`(
        select be.type from gov.budget_event be
        where be.budget_id = ${s.inboxItem.sourceId} and ${s.inboxItem.sourceType} = 'Budget'
        order by be.at desc limit 1
      )`,
    })
    .from(s.inboxItem)
    .leftJoin(s.approval, and(eq(s.inboxItem.sourceType, "Approval"), eq(s.approval.id, s.inboxItem.sourceId)))
    .leftJoin(s.agent, eq(s.agent.id, s.approval.requestedById))
    .leftJoin(s.agentQuestion, and(eq(s.inboxItem.sourceType, "AgentQuestion"), eq(s.agentQuestion.id, s.inboxItem.sourceId)))
    .leftJoin(s.workItem, and(eq(s.inboxItem.sourceType, "WorkItem"), eq(s.workItem.id, s.inboxItem.sourceId)))
    // A mention's source is the message that named the person; its room is the message's.
    .leftJoin(s.roomMessage, and(eq(s.inboxItem.sourceType, "RoomMessage"), eq(s.roomMessage.id, s.inboxItem.sourceId)))
    .leftJoin(
      s.discussionRoom,
      or(
        and(eq(s.inboxItem.sourceType, "Room"), eq(s.discussionRoom.id, s.inboxItem.sourceId)),
        eq(s.discussionRoom.id, s.roomMessage.roomId),
      ),
    )
    .leftJoin(s.person, and(eq(s.inboxItem.sourceType, "Person"), eq(s.person.id, s.inboxItem.sourceId)))
    .where(and(eq(s.inboxItem.personId, personId), ...itemFilter(query)))
    .orderBy(
      query.newestFirst ? desc(s.inboxItem.createdAt) : asc(s.inboxItem.createdAt),
      query.newestFirst ? desc(s.inboxItem.id) : asc(s.inboxItem.id),
    )
    .limit(query.limit)
    .offset(query.offset ?? 0);

  return rows.map((row) => {
    const kind = KIND[row.kind];
    const budgetTitle = row.budgetAgent
      ? row.budgetEvent === "HardLimitReached"
        ? [`${row.budgetAgent} reached its budget limit`, `${row.budgetAgent} بلغ حد ميزانيته`]
        : [`${row.budgetAgent} is near its budget limit`, `${row.budgetAgent} يقترب من حد ميزانيته`]
      : null;
    const registration = row.sourceType === "Person";
    const title =
      (registration ? `New registration: ${row.registrantNameEn ?? "decided"}` : null) ??
      budgetTitle?.[0] ??
      row.updateTitleEn ??
      row.approvalEvidence ??
      row.question ??
      row.workItemTitleEn ??
      (row.roomTitleEn ? `Mentioned you in ${row.roomKey}` : "");
    const titleAr =
      (registration ? `طلب تسجيل جديد: ${row.registrantNameAr ?? "تم البت فيه"}` : null) ??
      budgetTitle?.[1] ??
      row.updateTitleAr ??
      row.approvalEvidence ??
      row.question ??
      row.workItemTitleAr ??
      (row.roomTitleAr ? `أشار إليك في ${row.roomKey}` : "");
    // Why a decision cannot be taken. The server refuses each of these; the pane says so
    // rather than offering a button that will fail.
    const blocked: [string, string] | null =
      row.approvalRunStatus === "Cancelled"
        ? ["Run cancelled — no decision needed", "أُلغيت العملية — لا حاجة لقرار"]
        : row.approvalExpired
          ? ["Expired — escalated to the next approver", "انتهت الصلاحية — صُعّدت إلى المعتمد التالي"]
          : row.approvalRequestedBy === personId && !REQUESTER_DECIDES_IN.includes(row.approvalRunContext ?? "")
            ? ["You cannot approve your own request", "لا يمكنك اعتماد طلبك"]
            : null;

    return {
      id: row.id,
      kind,
      risk: row.approvalRisk,
      from: row.approvalAgent ?? row.questionAgent ?? row.workItemAgent ?? row.budgetAgent ?? "",
      t: kind === "sla" && row.workItemKey ? `${row.workItemKey} breaches SLA` : title,
      tAr: kind === "sla" && row.workItemKey ? `${row.workItemKey} سيتجاوز اتفاقية الخدمة` : titleAr,
      at: row.createdAt.toISOString(),
      tool: row.approvalAction,
      args: row.approvalArgs ? JSON.stringify(row.approvalArgs, null, 2) : null,
      evidence: row.approvalEvidence ? [row.approvalEvidence] : [],
      runKey: row.approvalRun ?? row.questionRun,
      workItemKey: row.approvalWorkItem ?? row.workItemKey,
      policy:
        row.approvalPolicy === null
          ? null
          : row.approvers && row.approvers.length > 0
            ? `${row.approvalPolicy}: ${row.approvers.join(" → ")}`
            : row.approvalPolicy,
      resolved: row.status === "Resolved",
      roomKey: row.roomKey,
      options: row.questionOptions ?? [],
      blocked: blocked?.[0] ?? null,
      blockedAr: blocked?.[1] ?? null,
      registration,
      link: row.updateLink,
    };
  });
}

/** D394: marks one of this person's Updates as read; false when it is not theirs, not an Update, or already read. */
export async function markUpdateRead(personId: string, inboxItemId: string): Promise<boolean> {
  const rows = await db()
    .update(s.inboxItem)
    .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.inboxItem.personId, personId), eq(s.inboxItem.id, inboxItemId), eq(s.inboxItem.kind, "Update"), eq(s.inboxItem.status, "Open")))
    .returning({ id: s.inboxItem.id });
  return rows.length > 0;
}

/** Closes an inbox row once its approval or question has been answered. */
export async function resolve(personId: string, inboxItemId: string): Promise<void> {
  await db()
    .update(s.inboxItem)
    .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.inboxItem.personId, personId), eq(s.inboxItem.id, inboxItemId)));
}

/**
 * Reads the approval an inbox row points at, with everything a decision depends on.
 *
 * The run status and the expiry are read with it rather than checked later: `UC-12.1-08`
 * and `UC-12.1-09` are both "this decision no longer means anything", and one taken against
 * a cancelled run would resume nothing while recording a choice about work that stopped.
 * Only the person's own row: an item is the decision of the person it was given to (D243).
 */
export async function readApprovalFor(inboxItemId: string, personId: string) {
  const [row] = await dbRo()
    .select({
      approvalId: s.approval.id,
      key: s.approval.key,
      status: s.approval.status,
      policy: s.approval.policy,
      callId: s.approval.callId,
      escalateAfter: s.approval.escalateAfter,
      /** The person whose run this is, which is who asked for the work (`UC-12.1-10`). */
      requestedBy: s.approval.createdBy,
      runId: s.approval.runId,
      runStatus: sql<string | null>`(select r.status from ai.run r where r.id = ${outer(s.approval.runId)})`,
      runKey: sql<string | null>`(select r.key from ai.run r where r.id = ${outer(s.approval.runId)})`,
      runContextType: sql<string | null>`(select r.context_type from ai.run r where r.id = ${outer(s.approval.runId)})`,
    })
    .from(s.inboxItem)
    .innerJoin(s.approval, eq(s.approval.id, s.inboxItem.sourceId))
    .where(and(eq(s.inboxItem.id, inboxItemId), eq(s.inboxItem.personId, personId), eq(s.inboxItem.sourceType, "Approval")))
    .limit(1);
  return row ?? null;
}

/** `UC-12.1-03`, `-04` and `-11`: who has already decided on this approval, and how. */
export async function decisionsFor(
  approvalId: string,
): Promise<{ personId: string; nameEn: string; decision: string; sequence: number }[]> {
  return dbRo()
    .select({
      personId: s.approvalDecision.approverPersonId,
      nameEn: s.person.nameEn,
      decision: s.approvalDecision.decision,
      sequence: s.approvalDecision.sequence,
    })
    .from(s.approvalDecision)
    .innerJoin(s.person, eq(s.person.id, s.approvalDecision.approverPersonId))
    .where(eq(s.approvalDecision.approvalId, approvalId))
    .orderBy(asc(s.approvalDecision.sequence), asc(s.approvalDecision.decidedAt));
}

/** Every inbox row that points at one approval, in the order the approvers were named. */
export async function inboxItemsFor(
  approvalId: string,
): Promise<{ id: string; personId: string; status: string; createdAt: Date }[]> {
  return dbRo()
    .select({
      id: s.inboxItem.id,
      personId: s.inboxItem.personId,
      status: s.inboxItem.status,
      createdAt: s.inboxItem.createdAt,
    })
    .from(s.inboxItem)
    .innerJoin(s.person, eq(s.person.id, s.inboxItem.personId))
    .where(and(eq(s.inboxItem.sourceType, "Approval"), eq(s.inboxItem.sourceId, approvalId)))
    // The rows of one fan-out share a timestamp, so the order a sequential approval follows
    // is the approvers' own, not whatever the tie happens to return.
    .orderBy(asc(s.person.nameEn), asc(s.inboxItem.personId));
}

/** `UC-12.1-04`: one member of a group decided, so the item is done for all of them. */
export async function resolveAllFor(approvalId: string): Promise<void> {
  await db()
    .update(s.inboxItem)
    .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.inboxItem.sourceType, "Approval"), eq(s.inboxItem.sourceId, approvalId)));
}

/** `UC-12.1-08` and `-09`: an approval nobody can decide any more. */
export async function markApprovalStatus(approvalId: string, status: string): Promise<void> {
  await db()
    .update(s.approval)
    .set({ status, updatedAt: new Date() })
    .where(eq(s.approval.id, approvalId));
}

/**
 * Records one approver decision, and the approval status when that decision settles it.
 *
 * `UC-12.1-11`: two members of a group deciding at the same moment is a real race. The
 * `Pending` guard on the update is what makes the first decision win, rather than the last
 * write landing on top of it.
 *
 * @returns whether this decision was the one that settled the approval.
 */
export async function decide(
  approvalId: string,
  personId: string,
  decision: "Approved" | "Rejected" | "ChangesRequested",
  reason: string | null,
  sequence: number,
  settles: boolean,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    await tx
      .insert(s.approvalDecision)
      .values({ approvalId, approverPersonId: personId, decision, reason, sequence });
    if (!settles) return false;

    const rows = await tx
      .update(s.approval)
      .set({
        status: decision === "Approved" ? "Approved" : decision === "Rejected" ? "Rejected" : "ChangesRequested",
        updatedAt: new Date(),
        updatedBy: personId,
      })
      .where(and(eq(s.approval.id, approvalId), eq(s.approval.status, "Pending")))
      .returning({ id: s.approval.id });
    return rows.length > 0;
  });
}

/** This person's Inbox item for one agent question, when the question was asked of them. */
export async function questionItemOf(personId: string, questionId: string): Promise<string | null> {
  const [row] = await dbRo()
    .select({ id: s.inboxItem.id })
    .from(s.inboxItem)
    .where(and(eq(s.inboxItem.personId, personId), eq(s.inboxItem.sourceType, "AgentQuestion"), eq(s.inboxItem.sourceId, questionId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The agent question behind one Inbox item, only when the item is this person's: its run, the
 * answer and who gave it, and the run's status. Null for anybody else's item (D243).
 */
export async function readQuestionFor(inboxItemId: string, personId: string) {
  const [row] = await dbRo()
    .select({
      questionId: s.agentQuestion.id,
      runId: s.agentQuestion.runId,
      answer: s.agentQuestion.answer,
      answeredByName: sql<string | null>`(
        select p.name_en from core.person p where p.id = ${s.agentQuestion.answeredBy}
      )`,
      runStatus: sql<string | null>`(select r.status from ai.run r where r.id = ${outer(s.agentQuestion.runId)})`,
    })
    .from(s.inboxItem)
    .innerJoin(s.agentQuestion, eq(s.agentQuestion.id, s.inboxItem.sourceId))
    .where(and(eq(s.inboxItem.id, inboxItemId), eq(s.inboxItem.personId, personId), eq(s.inboxItem.sourceType, "AgentQuestion")))
    .limit(1);
  return row ?? null;
}

/**
 * Records an answer, if the question is still unanswered.
 *
 * `UC-12.2-04`: a question asked of a group is answered once. The guard is on the row, not
 * on what the caller read a moment earlier.
 *
 * @returns whether this answer was the one recorded.
 */
export async function answerQuestion(questionId: string, personId: string, answer: string): Promise<boolean> {
  const rows = await db()
    .update(s.agentQuestion)
    .set({ answer, answeredBy: personId, answeredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.agentQuestion.id, questionId), isNull(s.agentQuestion.answer)))
    .returning({ id: s.agentQuestion.id });
  return rows.length > 0;
}

/** `UC-12.2-04`: the question is settled for everyone it was asked of. */
export async function resolveQuestionItems(questionId: string): Promise<void> {
  await db()
    .update(s.inboxItem)
    .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.inboxItem.sourceType, "AgentQuestion"), eq(s.inboxItem.sourceId, questionId)));
}

/**
 * One approval as the assistant panel shows it (D281): the person's own inbox item for it,
 * when they are its approver, and the names of everyone it waits on.
 */
export async function approvalByKey(key: string, personId: string): Promise<{ inboxItemId: string | null; approvers: string[] } | null> {
  const rows = await dbRo()
    .select({ itemId: s.inboxItem.id, personId: s.inboxItem.personId, nameEn: s.person.nameEn, requestedBy: s.approval.createdBy })
    .from(s.approval)
    .innerJoin(s.inboxItem, and(eq(s.inboxItem.sourceType, "Approval"), eq(s.inboxItem.sourceId, s.approval.id)))
    .innerJoin(s.person, eq(s.person.id, s.inboxItem.personId))
    .where(eq(s.approval.key, key))
    .orderBy(asc(s.person.nameEn));
  // Only the person who asked and the approvers may see who it waits on.
  if (!rows.length || !rows.some((row) => row.requestedBy === personId || row.personId === personId)) return null;
  return {
    inboxItemId: rows.find((row) => row.personId === personId)?.itemId ?? null,
    approvers: [...new Set(rows.map((row) => row.nameEn))],
  };
}
