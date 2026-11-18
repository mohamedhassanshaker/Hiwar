import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * What an approval is an approval *of* (D20, D21, D49).
 *
 * An approval that names only a tool approves a payload nobody read: a person agrees to
 * "publish this request type", and the call that then runs may carry different arguments
 * against a record that has changed since. So the approval binds to the exact call, and
 * the server spends it once, before the write.
 *
 * These cases go at the claim itself rather than through the harness, because the claim is
 * the control: every binding is one WHERE clause, and a binding that stops holding is a
 * call that must not run.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "test-run-token-signing-key-at-least-32-chars";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("a bound approval", () => {
  let ownerId = "";
  const realFetch = globalThis.fetch;

  /** The call a person is agreeing to, in these cases. */
  const CALL = { code: "RT-BOUND", expectedVersion: 2 };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /**
   * A run, an approval for `CALL`, and a person's decision on it — the state every case
   * below starts from. The run is real because the approval's binding names it.
   */
  async function approvedCall(args: Record<string, unknown> = CALL) {
    const { startRun } = await import("@/features/agents/service");
    const { requestApproval } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;

    const runId = await startRun({
      agentCode: "pa",
      prompt: "Publish it",
      screen: "/requests",
      surface: "AssistantPanel",
    });

    const approval = await requestApproval({
      run_id: runId,
      tool_name: "request_type_publish",
      call_id: `call-${runId}`,
      arguments: args,
      tier: "T2",
      reason: "publishing takes the draft into use",
      context_type: "Console",
      context_id: "/requests",
    });
    // A person decides it. What the decision screen does is covered by the Inbox cases;
    // here it is the state the claim reads.
    await testPool().query("update ai.approval set status = 'Approved' where id = $1", [approval.id]);
    return { runId, approvalId: approval.id };
  }

  it("lets the approved call through, once", async () => {
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();

    const binding = {
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 2,
    };

    expect(await claimApproval(binding)).toMatchObject({ ok: true });
    // D21. A pending approval left open is a standing grant, so spending it is final: a
    // second call on the same agreement is a second change nobody agreed to.
    expect(await claimApproval(binding)).toEqual({ ok: false, reason: "already_used" });
  });

  it("spends the approval through the run service the MCP server calls, once", async () => {
    const { spendApproval } = await import("@/features/agents/run-service");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();
    const binding = {
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 2,
    };

    expect(await spendApproval(binding)).toMatchObject({ ok: true });
    expect(await spendApproval(binding)).toEqual({ ok: false, reason: "already_used" });
  });

  it("refuses a call whose arguments are not the ones that were approved", async () => {
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();

    const claim = await claimApproval({
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash({ ...CALL, code: "RT-SOMETHING-ELSE" }),
      targetVersion: 2,
    });
    expect(claim).toEqual({ ok: false, reason: "arguments_changed" });
  });

  it("reads the same arguments in any key order as the same call", async () => {
    // A model does not emit its keys in a stable order, and two orderings are one call.
    // Without this an approved retry would look tampered with and never go through.
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();

    const claim = await claimApproval({
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash({ expectedVersion: 2, code: "RT-BOUND" }),
      targetVersion: 2,
    });
    expect(claim).toMatchObject({ ok: true });
  });

  it("refuses a call against a record that moved since it was approved", async () => {
    // The cascade the approver read described the record as it stood. If someone else
    // saved it in between, that description no longer holds and they have to read it again.
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();

    const claim = await claimApproval({
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 3,
    });
    expect(claim).toEqual({ ok: false, reason: "record_changed" });
  });

  it("refuses an approval that has expired", async () => {
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();
    await testPool().query("update ai.approval set expires_at = now() - interval '1 minute' where id = $1", [
      approvalId,
    ]);

    const claim = await claimApproval({
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 2,
    });
    expect(claim).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an approval another run was given", async () => {
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { approvalId } = await approvedCall();
    const other = await approvedCall();

    const claim = await claimApproval({
      approvalId,
      runId: other.runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 2,
    });
    expect(claim).toEqual({ ok: false, reason: "wrong_run" });
  });

  it("refuses a call on an approval nobody has decided yet", async () => {
    const { claimApproval } = await import("@/features/agents/repository");
    const { argumentsHash } = await import("@/lib/approval-binding");
    const { runId, approvalId } = await approvedCall();
    await testPool().query("update ai.approval set status = 'Pending' where id = $1", [approvalId]);

    const claim = await claimApproval({
      approvalId,
      runId,
      toolName: "request_type_publish",
      argumentsHash: argumentsHash(CALL),
      targetVersion: 2,
    });
    expect(claim).toEqual({ ok: false, reason: "not_approved" });
  });

  it("sends a delegated run's approval to people, never to the agent that delegated it", async () => {
    // D18. A parent agent approving its child's T2 call would launder the approval: the
    // whole gate exists so a person sees the change. Every approver is a person holding
    // `approvals:decide`, whichever agent in the chain asked.
    const { registerDelegatedRun } = await import("@/features/agents/service");
    const { requestApproval } = await import("@/features/agents/run-service");
    const { randomUUID } = await import("node:crypto");
    signedInAs = ownerId;
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;

    // A real parent run, because the child's grant is bounded by the parent's row (D36).
    const parent = await approvedCall();
    const childRunId = randomUUID();
    const registered = await registerDelegatedRun({
      runId: childRunId,
      parentRunId: parent.runId,
      agentCode: "pa",
      contextType: "Console",
      contextId: null,
    });
    expect(registered.ok).toBe(true);

    const approval = await requestApproval({
      run_id: childRunId,
      tool_name: "request_type_publish",
      call_id: `call-${childRunId}`,
      arguments: CALL,
      tier: "T2",
      reason: "the child run wants to publish",
      context_type: "Console",
      context_id: "",
    });

    expect(approval.approvers).toBeGreaterThan(0);
    // The inbox rows are what actually route it. Every one resolves to a person, so no
    // agent in the chain is among them. A panel run's approval goes to the person who
    // started the mission (D19, D281), the same person for the delegated child (D18).
    const routed = await testPool().query<{ person_id: string; is_person: boolean }>(
      `select i.person_id, (p.id is not null) as is_person
         from ai.inbox_item i
         left join core.person p on p.id = i.person_id
        where i.source_type = 'Approval' and i.source_id = $1`,
      [approval.id],
    );
    expect(routed.rowCount).toBe(approval.approvers);
    expect(routed.rows.every((row) => row.is_person)).toBe(true);
    expect(routed.rows.map((row) => row.person_id)).toEqual([ownerId]);
  });
});

describe.skipIf(!hasDatabase)("how wide one run may delegate", () => {
  let ownerId = "";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("D15 refuses a ninth delegation, and says why rather than failing the run", async () => {
    // Depth alone does not bound a tree: one agent delegating fifty children is as
    // expensive as a deep chain and arrives much faster. Enforced in the server, because
    // a limit the agent could decline to apply is not a limit.
    const { registerDelegatedRun, startRun } = await import("@/features/agents/service");
    const { randomUUID } = await import("node:crypto");
    signedInAs = ownerId;
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;

    const parentRunId = await startRun({
      agentCode: "pa",
      prompt: "Delegate a lot",
      screen: "/dashboard",
      surface: "AssistantPanel",
    });

    // Eight are allowed. Each is marked finished so the concurrent limit is not what
    // stops them — this case is about the total.
    for (let index = 0; index < 8; index += 1) {
      const childId = randomUUID();
      const made = await registerDelegatedRun({
        runId: childId,
        parentRunId,
        agentCode: "pa",
        contextType: "Console",
        contextId: null,
      });
      expect(made.ok, `delegation ${index + 1}`).toBe(true);
      await testPool().query("update ai.run set status = 'Succeeded' where id = $1", [childId]);
    }

    const ninth = await registerDelegatedRun({
      runId: randomUUID(),
      parentRunId,
      agentCode: "pa",
      contextType: "Console",
      contextId: null,
    });
    expect(ninth.ok).toBe(false);
    if (!ninth.ok) expect(ninth.message).toMatch(/already delegated/i);
  });

  it("D15 refuses a delegation more than two hops below the mission a person started", async () => {
    const { registerDelegatedRun, startRun } = await import("@/features/agents/service");
    const { randomUUID } = await import("node:crypto");
    signedInAs = ownerId;
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;

    let parentRunId = await startRun({
      agentCode: "pa",
      prompt: "Delegate down a chain",
      screen: "/dashboard",
      surface: "AssistantPanel",
    });
    const delegate = (parent: string) =>
      registerDelegatedRun({ runId: randomUUID(), parentRunId: parent, agentCode: "pa", contextType: "Console", contextId: null });

    // A child, then a grandchild: two hops.
    for (let hop = 1; hop <= 2; hop += 1) {
      const childId = randomUUID();
      const made = await registerDelegatedRun({ runId: childId, parentRunId, agentCode: "pa", contextType: "Console", contextId: null });
      expect(made.ok, `hop ${hop}`).toBe(true);
      parentRunId = childId;
    }

    const third = await delegate(parentRunId);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.message).toMatch(/2 hops below/);
  });

  it("D15 refuses a fourth delegation while three are still running", async () => {
    const { registerDelegatedRun, startRun } = await import("@/features/agents/service");
    const { randomUUID } = await import("node:crypto");
    signedInAs = ownerId;
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;

    const parentRunId = await startRun({
      agentCode: "pa",
      prompt: "Delegate at once",
      screen: "/dashboard",
      surface: "AssistantPanel",
    });

    for (let index = 0; index < 3; index += 1) {
      const made = await registerDelegatedRun({
        runId: randomUUID(),
        parentRunId,
        agentCode: "pa",
        contextType: "Console",
        contextId: null,
      });
      expect(made.ok, `delegation ${index + 1}`).toBe(true);
    }

    const fourth = await registerDelegatedRun({
      runId: randomUUID(),
      parentRunId,
      agentCode: "pa",
      contextType: "Console",
      contextId: null,
    });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.message).toMatch(/in flight/i);
  });
});
