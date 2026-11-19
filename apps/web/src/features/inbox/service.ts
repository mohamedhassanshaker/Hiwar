import { markRunResumed } from "@/features/agents/service";
import { resumeWithAnswer, resumeWithDecision, RunNotSignalled } from "@/lib/agent-runs";
import { REQUESTER_DECIDES_IN } from "@/lib/approval-binding";
import { Rejected } from "@/lib/rejection";
import { audit } from "@/lib/audit";
import { notifyDashboard, notifyInbox } from "@/lib/live";
import { can, requirePermission, requireSession } from "@/lib/session";
import { SERVER_PAGE_SIZE } from "@/lib/paging";
import * as repository from "./repository";
import type { DecisionInput } from "./schema";
import type { InboxSummary } from "./types";

/** S-12: what is waiting for the signed-in person, and the decisions they take on it. */

/** D394: the person marks an Update they have seen as read, which closes it. */
export async function markUpdateRead(inboxItemId: string): Promise<void> {
  const session = await requireSession();
  await repository.markUpdateRead(session.personId, inboxItemId);
}

export async function countOpenForMe(): Promise<number> {
  const session = await requireSession();
  return repository.countOpen(session.personId);
}

/** How many items the peek lists. */
const PEEK_LATEST = 10;

/**
 * What the shell's badge counts and its peek lists (handoff v2 sections 1.2 and 1.5), read on
 * every console page: the exact counts, and the few items the peek names, never the whole
 * Inbox. Someone who may not open the Inbox gets nothing: the peek would be a way to read it
 * without the permission.
 */
export async function peekItems(): Promise<InboxSummary | null> {
  const session = await requireSession();
  if (!(await can("inbox:read"))) return null;
  const [counts, urgent, latest] = await Promise.all([
    repository.countForPerson(session.personId),
    repository.listForPerson(session.personId, { status: "Open", urgent: true, newestFirst: true, limit: 2 }),
    repository.listForPerson(session.personId, { status: "Open", newestFirst: true, limit: PEEK_LATEST }),
  ]);
  return { counts, urgent, latest };
}

/**
 * S-12: one page of the signed-in person's Inbox, oldest first: open items of one kind (or
 * all), or resolved ones, with the counts every chip shows, and `selected`, the item `sel`
 * names when it is theirs, so a deep link opens it whichever page it is on. Requires
 * `inbox:read`.
 */
export async function loadInbox(
  view: { filter?: string; sel?: string } = {},
  page: { limit: number; offset: number } = { limit: SERVER_PAGE_SIZE, offset: 0 },
) {
  await requirePermission("inbox:read");
  const session = await requireSession();
  const filter = view.filter ?? "all";
  const resolved = filter === "resolved";
  const [counts, items, selected] = await Promise.all([
    repository.countForPerson(session.personId),
    repository.listForPerson(session.personId, {
      status: resolved ? "Resolved" : "Open",
      kind: resolved || filter === "all" ? undefined : filter,
      ...page,
    }),
    view.sel && /^[0-9a-f-]{36}$/i.test(view.sel)
      ? repository.listForPerson(session.personId, { id: view.sel, limit: 1 }).then(([item]) => item ?? null)
      : null,
  ]);
  const total = resolved
    ? counts.resolved
    : filter === "all"
      ? Object.values(counts.open).reduce((sum, n) => sum + n, 0)
      : (counts.open[filter] ?? 0);
  return { items, total, counts, selected };
}

/** `COM-10` and `UC-12.1-11`: someone else decided first. */
export class StaleDecisionError extends Rejected {
  readonly code = "STALE";
  constructor(readonly decidedBy?: string) {
    super(
      decidedBy ? `Already decided by ${decidedBy}.` : "This record was changed by someone else.",
      decidedBy ? `قرّر ${decidedBy} في هذا بالفعل.` : "غيّر شخص آخر هذا السجل.",
    );
    this.name = "StaleDecisionError";
  }
}

/** Thrown when a decision or an answer is refused, with the reason the pane shows. */
export class InboxRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "InboxRejected";
  }
}

/** What a decision did, so the pane can say it. */
export type DecisionOutcome = {
  /** Whether this decision settled the approval, or passed it to the next approver. */
  settled: boolean;
  /** `UC-12.1-03`: who the approval is waiting on now. */
  waitingOn: string | null;
  /** Whether the run was told. A decision stands even when the run could not be reached. */
  runResumed: boolean;
};

/** D281: the approval a panel run waits on, with the person's own item when they decide it. */
export async function panelApproval(key: string): Promise<{ inboxItemId: string | null; approvers: string[] } | null> {
  const session = await requireSession();
  return repository.approvalByKey(key, session.personId);
}

/**
 * `UC-12.1-02` … `-11`: decide an approval, and resume the run that is waiting on it.
 *
 * The decision is recorded before the run is told, because a decision that was recorded
 * and not delivered can be re-sent, while a run resumed on a decision nothing recorded has
 * acted on an approval that does not exist.
 */
export async function decideApproval(input: DecisionInput): Promise<DecisionOutcome> {
  const session = await requireSession();

  const approval = await repository.readApprovalFor(input.inboxItemId, session.personId);
  // In a room or the assistant panel the person who asked is the approver (D105, D281) and
  // needs no `approvals:decide` to decide their own agent's call (D269); anyone else does.
  const ownApproval =
    !!approval && REQUESTER_DECIDES_IN.includes(approval.runContextType ?? "") && approval.requestedBy === session.personId;
  if (!ownApproval) await requirePermission("approvals:decide");
  if (!approval) throw new InboxRejected("That inbox item is not an approval waiting on you.", "هذا البند في صندوق الوارد ليس اعتماداً بانتظارك.");

  // `UC-12.1-09`: the run stopped, so there is nothing left to decide.
  if (approval.runStatus === "Cancelled") {
    await repository.markApprovalStatus(approval.approvalId, "Expired");
    await repository.resolveAllFor(approval.approvalId);
    throw new InboxRejected("Run cancelled — no decision needed.", "أُلغي التشغيل — لا حاجة إلى قرار.");
  }
  // `UC-12.1-08`: the approval escalated before anyone decided.
  if (approval.escalateAfter && approval.escalateAfter.getTime() < Date.now()) {
    await repository.markApprovalStatus(approval.approvalId, "Expired");
    throw new InboxRejected("Expired — escalated to the next approver.", "انتهت المهلة — رُفع إلى المعتمِد التالي.");
  }
  if (approval.status !== "Pending") {
    const decisions = await repository.decisionsFor(approval.approvalId);
    throw new StaleDecisionError(decisions.at(-1)?.nameEn);
  }
  // `UC-12.1-10`: approving your own request is not a second pair of eyes, except where the
  // person who asked is the approver (D105, D281): the only way they hold the item.
  if (approval.requestedBy && approval.requestedBy === session.personId && !ownApproval) {
    throw new InboxRejected("You cannot approve your own request.", "لا يمكنك اعتماد طلبك.");
  }

  const decisions = await repository.decisionsFor(approval.approvalId);
  if (decisions.some((one) => one.personId === session.personId)) {
    throw new StaleDecisionError(session.nameEn);
  }

  // `UC-12.1-03`: a sequential policy passes the item to the next approver instead of
  // settling, but only while the decision is an approval — a rejection ends it at once.
  const items = await repository.inboxItemsFor(approval.approvalId);
  const sequence = decisions.length + 1;
  const sequential = approval.policy === "Sequential";
  const more = sequential && input.decision === "Approved" && sequence < items.length;

  const settled = await repository.decide(
    approval.approvalId,
    session.personId,
    input.decision,
    input.reason ?? null,
    sequence,
    !more,
  );
  if (!more && !settled) {
    const latest = await repository.decisionsFor(approval.approvalId);
    throw new StaleDecisionError(latest.find((one) => one.personId !== session.personId)?.nameEn);
  }

  // This approver is done either way; the others stay open only while more are needed.
  await repository.resolve(session.personId, input.inboxItemId);
  if (!more) await repository.resolveAllFor(approval.approvalId);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "approvals:decide",
    objectType: "Approval",
    objectId: approval.approvalId,
    objectLabel: approval.key,
    detail: { decision: input.decision, sequence, settled: !more },
  });

  let runResumed = false;
  if (!more && approval.runId && approval.callId) {
    try {
      // `UC-12.1-05` and `-07`: a refusal resumes the run as well. The call does not
      // happen, the agent is told why, and it carries on with that as the result — a run
      // never told of a rejection would wait until the approval timed out.
      await resumeWithDecision({
        runId: approval.runId,
        callId: approval.callId,
        approved: input.decision === "Approved",
        decidedBy: session.nameEn,
        note: input.reason,
        changesRequested: input.decision === "ChangesRequested",
      });
      runResumed = true;
      await markRunResumed(approval.runId, session.personId);
    } catch (problem) {
      if (!(problem instanceof RunNotSignalled)) throw problem;
      runResumed = false;
    }
  }

  const waitingOn = more ? (items[sequence]?.personId ?? null) : null;
  await Promise.all([
    notifyDashboard("approval"),
    notifyInbox(session.personId, "approval"),
    ...(waitingOn ? [notifyInbox(waitingOn, "approval")] : []),
  ]);
  return { settled: !more, waitingOn, runResumed };
}

/** What an answer did. */
export type AnswerOutcome = { runResumed: boolean };

/**
 * D239: the answer given where the question was asked, in the assistant panel, which knows
 * the question and not the Inbox item. Only the person it was asked of has an item for it.
 */
export async function answerAskedQuestion(questionId: string, answer: string): Promise<AnswerOutcome> {
  const session = await requirePermission("inbox:read");
  const itemId = await repository.questionItemOf(session.personId, questionId);
  if (!itemId) throw new InboxRejected("That question was not asked of you.", "لم يُطرح هذا السؤال عليك.");
  return answerQuestion(itemId, answer);
}

/**
 * `UC-12.2-01` … `-04`: answer an agent question from the caller's own Inbox item (D243) and
 * resume the run waiting on it. Refuses an answered question with who answered it, and on a
 * cancelled run closes the question's items and refuses. The answer is recorded only while
 * the question is unanswered, its items are closed for everyone it was asked of, and it is
 * audited before the run is signalled. A run that cannot be signalled leaves `runResumed`
 * false; the answer stands.
 */
export async function answerQuestion(inboxItemId: string, answer: string): Promise<AnswerOutcome> {
  const session = await requirePermission("inbox:read");

  const question = await repository.readQuestionFor(inboxItemId, session.personId);
  if (!question) throw new InboxRejected("That inbox item is not an agent question asked of you.", "هذا البند في صندوق الوارد ليس سؤال وكيل مطروحاً عليك.");
  // `UC-12.2-04`: someone else in the group answered first; their answer is the one.
  if (question.answer !== null) {
    throw new StaleDecisionError(question.answeredByName ?? undefined);
  }
  if (question.runStatus === "Cancelled") {
    await repository.resolveQuestionItems(question.questionId);
    throw new InboxRejected("Run cancelled — no answer needed.", "أُلغي التشغيل — لا حاجة إلى إجابة.");
  }

  const recorded = await repository.answerQuestion(question.questionId, session.personId, answer);
  if (!recorded) {
    const latest = await repository.readQuestionFor(inboxItemId, session.personId);
    throw new StaleDecisionError(latest?.answeredByName ?? undefined);
  }
  await repository.resolveQuestionItems(question.questionId);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "inbox:answer",
    objectType: "AgentQuestion",
    objectId: question.questionId,
  });

  let runResumed = false;
  try {
    await resumeWithAnswer({
      runId: question.runId,
      questionId: question.questionId,
      answer,
      answeredBy: session.nameEn,
    });
    runResumed = true;
    await markRunResumed(question.runId, session.personId);
  } catch (problem) {
    if (!(problem instanceof RunNotSignalled)) throw problem;
  }
  await Promise.all([notifyDashboard("question"), notifyInbox(session.personId, "question")]);
  return { runResumed };
}
