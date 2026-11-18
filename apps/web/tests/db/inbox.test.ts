import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-12 the Inbox: the decisions that resume a run, and the ones that may not be taken.
 *
 * A decision here is not a status column. A run is blocked on a Temporal signal, so every
 * case below is really "what does the platform do with a run that is waiting" — including
 * the three where the honest answer is "nothing, and here is why".
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";
/** What the agent service was told, so a test can see the run was resumed. */
let signals: { path: string; body: unknown }[] = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("the inbox", () => {
  let ownerId = "";
  let approverId = "";
  let memberId = "";
  let runId = "";
  const realFetch = globalThis.fetch;

  const asPerson = async (email: string) => {
    const { rows } = await testPool().query<{ id: string }>(
      "select id from core.person where email = $1",
      [email],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    ownerId = await asPerson("mariam@tahseel.ae");
    approverId = await asPerson("fatima@tahseel.ae");
    memberId = await asPerson("layla@tahseel.ae");
    const run = await testPool().query<{ id: string }>(
      "select id from ai.run where status in ('Succeeded','Waiting') order by key limit 1",
    );
    runId = run.rows[0].id;
  });

  beforeEach(() => {
    signals = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      signals.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, text: async () => "" } as Response;
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await testPool().query("delete from ai.inbox_item where source_id in (select id from ai.approval where key like 'APR-%')");
    await testPool().query("delete from ai.approval where key like 'APR-%'");
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** One approval created the way a T2 tool call creates it, with its inbox rows. */
  const createApproval = async (options: { callId?: string } = {}) => {
    const { requestApproval } = await import("@/features/agents/run-service");
    const previous = signedInAs;
    signedInAs = ownerId;
    const approval = await requestApproval({
      run_id: runId,
      tool_name: "payments.release",
      call_id: options.callId ?? "call-1",
      arguments: { amount: 1200, currency: "AED" },
      tier: "T2",
      reason: "Over the auto-approve limit",
      context_type: "",
      context_id: "",
    });
    signedInAs = previous;
    const items = await testPool().query<{ id: string; person_id: string }>(
      "select id, person_id from ai.inbox_item where source_id = $1",
      [approval.id],
    );
    return { approval, items: items.rows };
  };

  it("UC-12.1-01 UC-12.1-10 an approval reaches the approvers, and never its requester", async () => {
    const { items } = await createApproval();

    // Everyone who may decide gets one...
    expect(items.length).toBeGreaterThan(0);
    // ...except the person the run acts for: approving your own request is not a second
    // pair of eyes, so there is no inbox row to do it from.
    expect(items.map((item) => item.person_id)).not.toContain(ownerId);
  });

  it("UC-12.1-01 a run waits for its own approval rather than reading as merely slow", async () => {
    await createApproval();

    // A run blocked on a Temporal signal is not making progress — without this, the Agent
    // run list and the room both show it as "Running" forever, with nothing to tell anyone
    // it is actually waiting on them.
    const run = await testPool().query<{ status: string; ended_at: Date | null }>(
      "select status, ended_at from ai.run where id = $1",
      [runId],
    );
    expect(run.rows[0].status).toBe("Waiting");
    // Waiting is not over: a run paused for a person still has no end time.
    expect(run.rows[0].ended_at).toBeNull();
  });

  it("UC-12.1-02 approving resumes the waiting run with the call it was for", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval({ callId: "call-release" });
    const mine = items.find((item) => item.person_id === approverId);
    if (!mine) return;
    signedInAs = approverId;

    const outcome = await decideApproval({ inboxItemId: mine.id, decision: "Approved" });
    expect(outcome.settled).toBe(true);
    expect(outcome.runResumed).toBe(true);

    // The signal carries the call id, which is what the run is blocked on.
    expect(signals).toHaveLength(1);
    expect(signals[0].path).toContain("/approve");
    expect(signals[0].body).toMatchObject({ call_id: "call-release", approved: true });

    const stored = await testPool().query<{ status: string }>(
      "select status from ai.approval where id = $1",
      [approval.id],
    );
    expect(stored.rows[0].status).toBe("Approved");

    // The decision actually reached the run, so it is Running again, not stuck on Waiting.
    const run = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
    expect(run.rows[0].status).toBe("Running");
  });

  it("UC-12.1-04 one member of the group deciding resolves it for all of them", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    if (items.length < 2) return;
    signedInAs = items[0].person_id;

    await decideApproval({ inboxItemId: items[0].id, decision: "Approved" });

    const open = await testPool().query(
      "select 1 from ai.inbox_item where source_id = $1 and status = 'Open'",
      [approval.id],
    );
    expect(open.rowCount).toBe(0);
  });

  it("UC-12.1-03 a sequential policy passes the item on instead of settling it", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    expect(items.length).toBeGreaterThan(1);
    await testPool().query("update ai.approval set policy = 'Sequential' where id = $1", [approval.id]);

    // Sequential means every approver in turn, however many there are: only the last
    // decision settles it, and the run waits on the next one until then.
    for (const [index, item] of items.entries()) {
      const last = index === items.length - 1;
      signedInAs = item.person_id;
      const decision = await decideApproval({ inboxItemId: item.id, decision: "Approved" });

      expect(decision.settled).toBe(last);
      expect(signals).toHaveLength(last ? 1 : 0);
      if (last) continue;

      expect(decision.waitingOn).toBe(items[index + 1].person_id);
      const pending = await testPool().query<{ status: string }>(
        "select status from ai.approval where id = $1",
        [approval.id],
      );
      expect(pending.rows[0].status).toBe("Pending");

      // The one being waited on still has it in their inbox.
      const stillOpen = await testPool().query<{ id: string }>(
        "select id from ai.inbox_item where source_id = $1 and status = 'Open'",
        [approval.id],
      );
      expect(stillOpen.rows.map((row) => row.id)).toContain(items[index + 1].id);
    }
  });

  it("UC-12.1-07 a rejection carries its reason and still resumes the run", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    signedInAs = items[0].person_id;

    await decideApproval({
      inboxItemId: items[0].id,
      decision: "Rejected",
      reason: "The vendor is not on the approved list.",
    });

    // The call does not happen, and the run is told why rather than waiting for a timeout.
    expect(signals[0].body).toMatchObject({ approved: false });
    const decision = await testPool().query<{ decision: string; reason: string }>(
      "select decision, reason from ai.approval_decision where approval_id = $1",
      [approval.id],
    );
    expect(decision.rows[0]).toEqual({
      decision: "Rejected",
      reason: "The vendor is not on the approved list.",
    });
  });

  it("UC-12.1-05 requesting changes resumes the run with the feedback", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    signedInAs = items[0].person_id;

    await decideApproval({
      inboxItemId: items[0].id,
      decision: "ChangesRequested",
      reason: "Split this into two payments.",
    });

    // The call does not happen, and the agent is given what to do instead of a dead end.
    expect(signals[0].body).toMatchObject({ approved: false, note: "Split this into two payments." });
    const stored = await testPool().query<{ status: string }>(
      "select status from ai.approval where id = $1",
      [approval.id],
    );
    expect(stored.rows[0].status).toBe("ChangesRequested");
  });

  it("UC-12.1-06 a rejection with no reason is refused before it reaches the service", async () => {
    const { decisionInput } = await import("@/features/inbox/schema");
    expect(() =>
      decisionInput.parse({ inboxItemId: crypto.randomUUID(), decision: "Rejected" }),
    ).toThrow();
    // The same decision with a reason parses.
    expect(() =>
      decisionInput.parse({ inboxItemId: crypto.randomUUID(), decision: "Rejected", reason: "No." }),
    ).not.toThrow();
  });

  it("UC-12.1-11 the second decision is told who decided first", async () => {
    const { decideApproval, StaleDecisionError } = await import("@/features/inbox/service");
    const { items } = await createApproval();
    if (items.length < 2) return;

    signedInAs = items[0].person_id;
    await decideApproval({ inboxItemId: items[0].id, decision: "Approved" });

    signedInAs = items[1].person_id;
    await expect(decideApproval({ inboxItemId: items[1].id, decision: "Rejected", reason: "No." }))
      .rejects.toBeInstanceOf(StaleDecisionError);
  });

  it("UC-12.1-08 an expired approval is refused, and says it escalated", async () => {
    const { decideApproval, InboxRejected } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    await testPool().query("update ai.approval set escalate_after = now() - interval '1 hour' where id = $1", [
      approval.id,
    ]);
    signedInAs = items[0].person_id;

    await expect(decideApproval({ inboxItemId: items[0].id, decision: "Approved" })).rejects.toBeInstanceOf(
      InboxRejected,
    );
    // Nothing was signalled: there is no decision to deliver.
    expect(signals).toHaveLength(0);
  });

  it("UC-12.1-09 a cancelled run needs no decision, and the item closes", async () => {
    const { decideApproval, InboxRejected } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    const before = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
    await testPool().query("update ai.run set status = 'Cancelled' where id = $1", [runId]);
    signedInAs = items[0].person_id;

    await expect(decideApproval({ inboxItemId: items[0].id, decision: "Approved" })).rejects.toBeInstanceOf(
      InboxRejected,
    );
    const open = await testPool().query(
      "select 1 from ai.inbox_item where source_id = $1 and status = 'Open'",
      [approval.id],
    );
    expect(open.rowCount).toBe(0);
    expect(signals).toHaveLength(0);

    await testPool().query("update ai.run set status = $1 where id = $2", [before.rows[0].status, runId]);
  });

  it("UC-12.2-01 UC-12.2-03 an answer resumes the run, and an offered option is one of them", async () => {
    const { askPerson } = await import("@/features/agents/run-service");
    const { answerQuestion } = await import("@/features/inbox/service");
    signedInAs = ownerId;

    const question = await askPerson({
      run_id: runId,
      question: "Which cost centre should this go to?",
      options: ["Finance", "Procurement"],
    });
    const item = await testPool().query<{ id: string }>(
      "select id from ai.inbox_item where source_id = $1",
      [question.id],
    );

    // Asking is the same pause as an approval: the run is Waiting on this answer, not stalled.
    const waiting = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
    expect(waiting.rows[0].status).toBe("Waiting");

    const outcome = await answerQuestion(item.rows[0].id, "Procurement");
    expect(outcome.runResumed).toBe(true);
    expect(signals[0].path).toContain("/answer");
    expect(signals[0].body).toMatchObject({ question_id: question.id, answer: "Procurement" });

    const stored = await testPool().query<{ answer: string; options: string[] }>(
      "select answer, options from ai.agent_question where id = $1",
      [question.id],
    );
    expect(stored.rows[0]).toEqual({ answer: "Procurement", options: ["Finance", "Procurement"] });

    // The answer reached the run, so it resumed instead of reading as Waiting forever.
    const resumed = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
    expect(resumed.rows[0].status).toBe("Running");

    await testPool().query("delete from ai.inbox_item where source_id = $1", [question.id]);
    await testPool().query("delete from ai.agent_question where id = $1", [question.id]);
  });

  it("UC-12.2-04 a question answered by someone else is not answered twice", async () => {
    const { askPerson } = await import("@/features/agents/run-service");
    const { answerQuestion, StaleDecisionError } = await import("@/features/inbox/service");
    signedInAs = ownerId;

    const question = await askPerson({ run_id: runId, question: "Proceed?", options: [] });
    const item = await testPool().query<{ id: string }>(
      "select id from ai.inbox_item where source_id = $1",
      [question.id],
    );
    await answerQuestion(item.rows[0].id, "Yes");

    await expect(answerQuestion(item.rows[0].id, "No")).rejects.toBeInstanceOf(StaleDecisionError);

    await testPool().query("delete from ai.inbox_item where source_id = $1", [question.id]);
    await testPool().query("delete from ai.agent_question where id = $1", [question.id]);
  });

  it("UC-12.3-01 a member may not decide an approval at all", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { NotPermitted } = await import("@/lib/session");
    const { items } = await createApproval();
    signedInAs = memberId;

    await expect(decideApproval({ inboxItemId: items[0].id, decision: "Approved" })).rejects.toBeInstanceOf(
      NotPermitted,
    );
  });

  it("UC-12.1-01 the badge counts what the Inbox lists, and the peek names the newest", async () => {
    const { countOpenForMe, loadInbox, peekItems } = await import("@/features/inbox/service");
    const { items } = await createApproval();
    const mine = items.find((item) => item.person_id === approverId);
    expect(mine).toBeTruthy();
    signedInAs = approverId;

    const open = await testPool().query<{ n: number }>(
      "select count(*)::int as n from ai.inbox_item where person_id = $1 and status = 'Open'",
      [approverId],
    );
    expect(await countOpenForMe()).toBe(open.rows[0].n);

    const listed = await loadInbox({ filter: "approval" }, { limit: 500, offset: 0 });
    expect(listed.items.map((item) => item.id)).toContain(mine!.id);
    const peek = await peekItems();
    expect(Object.values(peek!.counts.open).reduce((sum, n) => sum + n, 0)).toBe(open.rows[0].n);
    // The newest open item is the approval just raised.
    expect(peek!.latest[0]?.id).toBe(mine!.id);
  });

  it("D349 the Inbox reads a page at a time, and the peek's counts stay exact past what it names", async () => {
    const { loadInbox, peekItems } = await import("@/features/inbox/service");
    // Twelve reviews a minute apart, the newest last; the work items they name need not exist.
    const { rows } = await testPool().query<{ id: string }>(
      `insert into ai.inbox_item (person_id, kind, source_type, source_id, status, created_at)
       select $1, 'Review', 'WorkItem', gen_random_uuid(), 'Open', now() - interval '1 hour' + n * interval '1 minute'
       from generate_series(1, 12) n
       order by n
       returning id`,
      [approverId],
    );
    const made = rows.map((row) => row.id);
    try {
      signedInAs = approverId;
      const before = await testPool().query<{ n: number }>(
        "select count(*)::int as n from ai.inbox_item where person_id = $1 and status = 'Open' and kind = 'Review'",
        [approverId],
      );

      const first = await loadInbox({ filter: "review" }, { limit: 5, offset: 0 });
      const second = await loadInbox({ filter: "review" }, { limit: 5, offset: 5 });
      expect(first.total).toBe(before.rows[0].n);
      expect(first.items).toHaveLength(5);
      expect(second.items).toHaveLength(5);
      // Oldest first, and the second page carries on where the first stopped.
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(10);
      expect(first.items.at(-1)!.at <= second.items[0].at).toBe(true);
      expect(first.items.every((item) => item.kind === "review" && !item.resolved)).toBe(true);

      // An item the address names opens whichever page it is on; somebody else's does not.
      const last = made.at(-1)!;
      expect((await loadInbox({ filter: "review", sel: last }, { limit: 5, offset: 0 })).selected?.id).toBe(last);
      signedInAs = memberId;
      expect((await loadInbox({ sel: last })).selected).toBeNull();

      signedInAs = approverId;
      const peek = await peekItems();
      expect(peek!.counts.open.review).toBe(before.rows[0].n);
      expect(peek!.latest.length).toBeLessThanOrEqual(10);
      expect(peek!.latest[0].id).toBe(last);
    } finally {
      await testPool().query("delete from ai.inbox_item where id = any($1)", [made]);
    }
  });

  it("UC-12.3-01 someone who may not open the Inbox gets no peek and no list", async () => {
    const { loadInbox, peekItems } = await import("@/features/inbox/service");
    const { NotPermitted } = await import("@/lib/session");
    // The one seeded person without `inbox:read`.
    signedInAs = await asPerson("hessa@tahseel.ae");

    expect(await peekItems()).toBeNull();
    await expect(loadInbox()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("an inbox item that is not an approval, or not a question, is refused as such", async () => {
    const { answerQuestion, decideApproval, InboxRejected } = await import("@/features/inbox/service");
    signedInAs = approverId;

    await expect(decideApproval({ inboxItemId: crypto.randomUUID(), decision: "Approved" })).rejects.toBeInstanceOf(InboxRejected);
    await expect(answerQuestion(crypto.randomUUID(), "Yes")).rejects.toThrow(/not an agent question/);
    expect(signals).toHaveLength(0);
  });

  it("D243 an approval or a question is decided only from the person's own inbox item", async () => {
    const { answerQuestion, decideApproval, InboxRejected } = await import("@/features/inbox/service");
    const { askPerson } = await import("@/features/agents/run-service");
    const { approval, items } = await createApproval();
    const others = items.filter((item) => item.person_id !== approverId);
    expect(others.length).toBeGreaterThan(0);
    signedInAs = approverId;
    await expect(decideApproval({ inboxItemId: others[0].id, decision: "Approved" })).rejects.toThrow(
      "That inbox item is not an approval waiting on you.",
    );
    const stored = await testPool().query<{ status: string }>("select status from ai.approval where id = $1", [approval.id]);
    expect(stored.rows[0].status).toBe("Pending");

    signedInAs = ownerId;
    const question = await askPerson({ run_id: runId, question: "Proceed?", options: [] });
    const asked = await testPool().query<{ id: string; person_id: string }>("select id, person_id from ai.inbox_item where source_id = $1", [question.id]);
    try {
      signedInAs = asked.rows[0].person_id === approverId ? memberId : approverId;
      await expect(answerQuestion(asked.rows[0].id, "Yes")).rejects.toBeInstanceOf(InboxRejected);
      const unanswered = await testPool().query<{ answer: string | null }>("select answer from ai.agent_question where id = $1", [question.id]);
      expect(unanswered.rows[0].answer).toBeNull();
      expect(signals).toHaveLength(0);
    } finally {
      await testPool().query("delete from ai.inbox_item where source_id = $1", [question.id]);
      await testPool().query("delete from ai.agent_question where id = $1", [question.id]);
    }
  });

  it("UC-12.1-10 the person who asked for the work cannot approve it, even from another approver's item", async () => {
    const { decideApproval, InboxRejected } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval();
    const requester = await testPool().query<{ created_by: string }>("select created_by from ai.approval where id = $1", [approval.id]);
    signedInAs = requester.rows[0].created_by;

    await expect(decideApproval({ inboxItemId: items[0].id, decision: "Approved" })).rejects.toBeInstanceOf(InboxRejected);
    const stored = await testPool().query<{ status: string }>("select status from ai.approval where id = $1", [approval.id]);
    expect(stored.rows[0].status).toBe("Pending");
  });

  it("D105 D269 in a room the person who asked is the approver, and decides it without approvals:decide", async () => {
    const { requestApproval } = await import("@/features/agents/run-service");
    const { decideApproval } = await import("@/features/inbox/service");
    // A room run of this test's own, asked for by Layla, who does not hold approvals:decide.
    const asker = memberId;
    const room = await testPool().query<{ id: string }>(
      `insert into ai.run (key, agent_id, agent_version_id, trigger, context_type, status, created_by, updated_by)
       select 'RUN-T' || floor(random() * 1e9)::text, agent_id, agent_version_id, trigger, 'Room', 'Running', $1, $1
         from ai.run where id = $2
       returning id`,
      [asker, runId],
    );
    signedInAs = asker;
    const approval = await requestApproval({
      run_id: room.rows[0].id,
      tool_name: "payments.release",
      call_id: "call-room",
      arguments: { amount: 1200, currency: "AED" },
      tier: "T2",
      reason: "Over the auto-approve limit",
      context_type: "Room",
      context_id: "",
    });
    const items = await testPool().query<{ id: string; person_id: string }>("select id, person_id from ai.inbox_item where source_id = $1", [approval.id]);
    expect(items.rows.map((item) => item.person_id)).toEqual([asker]);

    const outcome = await decideApproval({ inboxItemId: items.rows[0].id, decision: "Approved" });
    expect(outcome.settled).toBe(true);
    const stored = await testPool().query<{ status: string }>("select status from ai.approval where id = $1", [approval.id]);
    expect(stored.rows[0].status).toBe("Approved");

    // Anything else still needs the permission: an approval outside a room, which is not hers.
    const { NotPermitted } = await import("@/lib/session");
    const other = await createApproval({ callId: "call-not-hers" });
    signedInAs = asker;
    await expect(decideApproval({ inboxItemId: other.items[0].id, decision: "Approved" })).rejects.toBeInstanceOf(NotPermitted);

    await testPool().query("delete from ai.approval_decision where approval_id = $1", [approval.id]);
    await testPool().query("delete from ai.inbox_item where source_id = $1", [approval.id]);
    await testPool().query("delete from ai.approval where id = $1", [approval.id]);
    await testPool().query("delete from ai.run where id = $1", [room.rows[0].id]);
  });

  it("D281 D284 in the assistant panel the person who asked decides, a call that changes access included", async () => {
    const { requestApproval } = await import("@/features/agents/run-service");
    const { decideApproval, panelApproval } = await import("@/features/inbox/service");
    // A panel run (context Console) of this test's own, asked for by Layla, who does not hold approvals:decide.
    const panel = await testPool().query<{ id: string }>(
      `insert into ai.run (key, agent_id, agent_version_id, trigger, context_type, status, created_by, updated_by)
       select 'RUN-T' || floor(random() * 1e9)::text, agent_id, agent_version_id, trigger, 'Console', 'Running', $1, $1
         from ai.run where id = $2
       returning id`,
      [memberId, runId],
    );
    const raise = (callId: string, separateApprover?: true) => {
      signedInAs = memberId;
      return requestApproval({
        run_id: panel.rows[0].id,
        tool_name: "payments.release",
        call_id: callId,
        arguments: { amount: 1200, currency: "AED" },
        tier: "T2",
        reason: "Over the auto-approve limit",
        context_type: "Console",
        context_id: "",
        ...(separateApprover ? { separateApprover } : {}),
      });
    };
    const itemsOf = async (approvalId: string) =>
      (await testPool().query<{ id: string; person_id: string }>("select id, person_id from ai.inbox_item where source_id = $1", [approvalId])).rows;

    const ordinary = await raise("call-panel");
    const items = await itemsOf(ordinary.id);
    expect(items.map((item) => item.person_id)).toEqual([memberId]);
    expect(await panelApproval(ordinary.key)).toMatchObject({ inboxItemId: items[0].id });
    expect((await decideApproval({ inboxItemId: items[0].id, decision: "Approved" })).settled).toBe(true);

    // A change to who may reach what is the asker's to decide in the panel as well.
    const access = await raise("call-panel-access", true);
    const accessItems = await itemsOf(access.id);
    expect(accessItems.map((item) => item.person_id)).toEqual([memberId]);
    expect(await panelApproval(access.key)).toMatchObject({ inboxItemId: accessItems[0].id });
    expect((await decideApproval({ inboxItemId: accessItems[0].id, decision: "Approved" })).settled).toBe(true);

    // Somebody who neither asked nor decides it is not told who does.
    signedInAs = approverId;
    const stranger = await raise("call-panel-stranger");
    signedInAs = ownerId;
    expect(await panelApproval(stranger.key)).toBeNull();

    for (const approval of [ordinary, access, stranger]) {
      await testPool().query("delete from ai.approval_decision where approval_id = $1", [approval.id]);
      await testPool().query("delete from ai.inbox_item where source_id = $1", [approval.id]);
      await testPool().query("delete from ai.approval where id = $1", [approval.id]);
    }
    await testPool().query("delete from ai.run where id = $1", [panel.rows[0].id]);
  });

  it("UC-12.1-02 a decision stands when the run cannot be told", async () => {
    const { decideApproval } = await import("@/features/inbox/service");
    const { approval, items } = await createApproval({ callId: "call-unreachable" });
    const mine = items.find((item) => item.person_id === approverId);
    expect(mine).toBeTruthy();
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "unavailable" }) as Response) as typeof fetch;
    signedInAs = approverId;

    const outcome = await decideApproval({ inboxItemId: mine!.id, decision: "Approved" });
    expect(outcome).toEqual({ settled: true, waitingOn: null, runResumed: false });
    const stored = await testPool().query<{ status: string }>("select status from ai.approval where id = $1", [approval.id]);
    expect(stored.rows[0].status).toBe("Approved");
  });

  it("UC-12.2-01 an answer stands when the run cannot be told, and a cancelled run needs none", async () => {
    const { askPerson } = await import("@/features/agents/run-service");
    const { answerQuestion, InboxRejected } = await import("@/features/inbox/service");
    signedInAs = ownerId;
    const before = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);

    const ask = async () => {
      const question = await askPerson({ run_id: runId, question: "Which quarter?", options: [] });
      const item = await testPool().query<{ id: string }>("select id from ai.inbox_item where source_id = $1", [question.id]);
      return { questionId: question.id, itemId: item.rows[0].id };
    };
    const forget = async (questionId: string) => {
      await testPool().query("delete from ai.inbox_item where source_id = $1", [questionId]);
      await testPool().query("delete from ai.agent_question where id = $1", [questionId]);
    };

    const unreachable = await ask();
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "unavailable" }) as Response) as typeof fetch;
    expect(await answerQuestion(unreachable.itemId, "Q3")).toEqual({ runResumed: false });
    const answered = await testPool().query<{ answer: string }>("select answer from ai.agent_question where id = $1", [unreachable.questionId]);
    expect(answered.rows[0].answer).toBe("Q3");
    await forget(unreachable.questionId);

    const cancelled = await ask();
    await testPool().query("update ai.run set status = 'Cancelled' where id = $1", [runId]);
    await expect(answerQuestion(cancelled.itemId, "Q4")).rejects.toBeInstanceOf(InboxRejected);
    const open = await testPool().query("select 1 from ai.inbox_item where source_id = $1 and status = 'Open'", [cancelled.questionId]);
    expect(open.rowCount).toBe(0);
    const unanswered = await testPool().query<{ answer: string | null }>("select answer from ai.agent_question where id = $1", [cancelled.questionId]);
    expect(unanswered.rows[0].answer).toBeNull();

    await testPool().query("update ai.run set status = $1 where id = $2", [before.rows[0].status, runId]);
    await forget(cancelled.questionId);
  });
});
