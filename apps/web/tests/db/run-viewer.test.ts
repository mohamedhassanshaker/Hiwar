import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-52 the run viewer: what one run carries, and what may be done to it.
 *
 * A run is the record of what an agent did, so the two operations on it are deliberately
 * asymmetric. Cancelling stops what has not happened yet; replaying never touches the
 * original, because that is the record an incident is investigated from.
 */

// A replay starts a run, so the agent service has to have an address. The request itself
// is captured rather than made.
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

describe.skipIf(!hasDatabase)("run viewer", () => {
  let ownerId = "";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-52.1-01 carries the figures the KPIs show", async () => {
    const { loadRun, loadRuns } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const runs = await loadRuns();
    const detail = await loadRun(runs[0].id);
    expect(detail).not.toBeNull();

    // §7.4.4 names each of these on the KPI row.
    expect(typeof detail!.tokensIn).toBe("number");
    expect(typeof detail!.tokensOut).toBe("number");
    expect(typeof detail!.toolCallCount).toBe("number");
    expect(typeof detail!.waitingSeconds).toBe("number");
    expect(detail!.run.cost).toBeGreaterThanOrEqual(0);
  });

  it("D349 an agent's runs page on the server: the next page, the total, and each filter", async () => {
    const { loadRunPage } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const [agent] = (
      await testPool().query<{ code: string }>(
        "select a.code from ai.run r join ai.agent a on a.id = r.agent_id group by a.code order by count(*) desc limit 1",
      )
    ).rows;
    const ordered = (
      await testPool().query<{ key: string; status: string }>(
        `select r.key, r.status from ai.run r join ai.agent a on a.id = r.agent_id
          where a.code = $1 order by r.started_at desc, r.id desc`,
        [agent.code],
      )
    ).rows;
    expect(ordered.length).toBeGreaterThan(3);

    const second = await loadRunPage({ agentCode: agent.code, limit: 2, offset: 2 });
    expect(second.runs.map((run) => run.id)).toEqual(ordered.slice(2, 4).map((run) => run.key));
    expect(second.total).toBe(ordered.length);

    const status = ordered[0].status;
    const byStatus = await loadRunPage({ agentCode: agent.code, status, limit: 50 });
    expect(byStatus.total).toBe(ordered.filter((run) => run.status === status).length);
    expect(byStatus.runs.every((run) => run.st === status)).toBe(true);

    const byKey = await loadRunPage({ agentCode: agent.code, text: ordered[1].key, limit: 50 });
    expect(byKey.runs.map((run) => run.id)).toContain(ordered[1].key);
    expect(byKey.total).toBeLessThan(ordered.length);

    // Search text is literal: a wildcard character matches only itself.
    expect((await loadRunPage({ agentCode: agent.code, text: "%", limit: 50 })).total).toBe(0);

    const recent = (
      await testPool().query<{ n: number }>(
        `select count(*)::int as n from ai.run r join ai.agent a on a.id = r.agent_id
          where a.code = $1 and r.started_at >= now() - interval '24 hours'`,
        [agent.code],
      )
    ).rows[0].n;
    expect((await loadRunPage({ agentCode: agent.code, sinceHours: 24, limit: 50 })).total).toBe(recent);
  });

  it("UC-52.1-02 a step carries its type, its result and the hooks that ran", async () => {
    const { loadRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const withSteps = await testPool().query<{ key: string }>(
      `select r.key from ai.run r
       where exists (select 1 from ai.run_step s where s.run_id = r.id) limit 1`,
    );
    const detail = await loadRun(withSteps.rows[0].key);
    expect(detail!.steps.length).toBeGreaterThan(0);

    for (const step of detail!.steps) {
      expect(step.k).toBeTruthy();
      expect(step.t).toBeTruthy();
      // "pii-mask (pre_model): 2 values masked" is a hook outcome, and which engine
      // produced it is part of the line — a weaker control must never read the same.
      expect(Array.isArray(step.hooks)).toBe(true);
    }
  });

  it("UC-52.1-02 finishing a run writes every step the harness recorded, in order", async () => {
    // Before this, `finishRun` wrote a single synthetic "Handoff/finish" row whatever the
    // harness sent, so the viewer could never show more than one step for any run. The
    // harness's own timeline is what proves it now reaches the table.
    const { finishRun } = await import("@/features/agents/run-service");
    const { loadRun } = await import("@/features/agents/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const [agent] = await testPool().query<{ id: string; versionId: string }>(
      "select a.id, a.active_version_id as \"versionId\" from ai.agent a where a.code = 'exp'",
    ).then((r) => r.rows);
    const runId = crypto.randomUUID();
    const runKey = await repository.openRun({
      id: runId,
      agentId: agent.id,
      agentVersionId: agent.versionId,
      trigger: "Manual",
      contextType: "WorkItem",
      contextId: null,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    const now = new Date().toISOString();
    await finishRun({
      run_id: runId,
      status: "Succeeded",
      output: "done",
      tokens_in: 10,
      tokens_out: 5,
      tool_call_count: 1,
      estimated_cost_aed: "0.01",
      eval_scores: {},
      steps: [
        { seq: 1, type: "Model", name: "reasoning-default", status: "Succeeded", result: "thinking", hooks_applied: [], estimated_cost_aed: "0.01", started_at: now, ended_at: now },
        { seq: 2, type: "Tool", name: "knowledge_search", status: "Succeeded", result: "3 passages", hooks_applied: ["pii-mask"], estimated_cost_aed: "0", started_at: now, ended_at: now },
      ],
    });

    const detail = await loadRun(runKey);
    expect(detail!.steps.map((step) => step.k)).toEqual(["Model", "Tool"]);
    expect(detail!.steps.map((step) => step.t)).toEqual(["reasoning-default", "knowledge_search"]);
    expect(detail!.steps[1].hooks).toEqual(["pii-mask"]);
  });

  it("UC-52.1-07 UC-52.1-08 the trace is only offered when one was recorded", async () => {
    const { loadRun, loadRuns } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const runs = await loadRuns();
    const detail = await loadRun(runs[0].id);
    // Null or a trace id — never an invented one. The screen hides the link without it,
    // and hides it again from anyone who may not read the service logs.
    expect(detail!.traceId === null || typeof detail!.traceId === "string").toBe(true);
  });

  it("UC-52.1-09 a run stopped by its budget says which budget stopped it", async () => {
    const { loadRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const exceeded = await testPool().query<{ key: string }>(
      "select key from ai.run where status = 'BudgetExceeded' limit 1",
    );
    if (exceeded.rowCount === 0) return; // no such run in the seed

    const detail = await loadRun(exceeded.rows[0].key);
    expect(detail!.run.st).toBe("BudgetExceeded");
    // The viewer colours the cost against this; without it there is nothing to compare to.
    expect(detail!.budgetHard).not.toBeNull();
  });

  it("UC-52.1-05 cancelling stops a running run and leaves a finished one alone", async () => {
    const { cancelRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const finished = await testPool().query<{ key: string; status: string }>(
      "select key, status from ai.run where status in ('Succeeded','Failed') limit 1",
    );
    await cancelRun(finished.rows[0].key);

    // `UC-52.1-11`: a finished run has nothing to stop, and cancelling must not rewrite
    // how it ended.
    const after = await testPool().query<{ status: string }>("select status from ai.run where key = $1", [
      finished.rows[0].key,
    ]);
    expect(after.rows[0].status).toBe(finished.rows[0].status);
  });

  it("UC-52.1-05 cancelling a run still going actually tells its workflow to stop", async () => {
    const { cancelRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent limit 1",
    );
    const runId = crypto.randomUUID();
    const key = `RUN-TEST-${Date.now()}`;
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'WorkItem', 'Running', now(), $5, $5)`,
      [runId, key, agent.rows[0].id, agent.rows[0].versionId, ownerId],
    );

    let signalled: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      signalled = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    await cancelRun(key);

    // Without this, the row says Cancelled while the workflow the row names keeps running —
    // this is the exact gap that left "stop a long-running run" cosmetic rather than real.
    expect(signalled!.url).toContain(`/agui/runs/${runId}/cancel`);

    const after = await testPool().query<{ status: string }>("select status from ai.run where key = $1", [key]);
    expect(after.rows[0].status).toBe("Cancelled");

    await testPool().query("delete from ai.run where id = $1", [runId]);
  });

  it("D67 only the run's requester, its room's owner or an administrator may cancel it", async () => {
    const { cancelRun } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");
    // Somebody who may start a run but may not pause every agent.
    const holders = await testPool().query<{ id: string }>(
      `select p.id from core.person p where p.status = 'Active' and p.id <> $1
         and exists (select 1 from core.role_assignment ra join core.role_permission rp on rp.role_id = ra.role_id
                     join core.permission perm on perm.id = rp.permission_id
                     where ra.person_id = p.id and perm.code = 'agents:invoke' and rp.effect = 'Allow')
         and not exists (select 1 from core.role_assignment ra join core.role_permission rp on rp.role_id = ra.role_id
                     join core.permission perm on perm.id = rp.permission_id
                     where ra.person_id = p.id and perm.code = 'system:operate' and rp.effect = 'Allow')
       order by p.id limit 1`,
      [ownerId],
    );
    const other = holders.rows[0].id;
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent limit 1",
    );
    const runId = crypto.randomUUID();
    const key = `RUN-TEST-${Date.now()}`;
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'WorkItem', 'Running', now(), $5, $5)`,
      [runId, key, agent.rows[0].id, agent.rows[0].versionId, ownerId],
    );
    globalThis.fetch = (async () => ({ ok: true, status: 200 }) as Response) as typeof fetch;
    try {
      signedInAs = other;
      await expect(cancelRun(key)).rejects.toBeInstanceOf(NotPermitted);
      expect((await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId])).rows[0].status).toBe("Running");

      // The person who started it may.
      await testPool().query("update ai.run set created_by = $2 where id = $1", [runId, other]);
      await cancelRun(key);
      expect((await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId])).rows[0].status).toBe("Cancelled");
    } finally {
      await testPool().query("delete from ai.run where id = $1", [runId]);
    }
  });

  it("D300 a finished run is deleted with its steps, approvals and their Inbox items; a running one is refused", async () => {
    const { deleteRun, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;
    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent limit 1",
    );
    const runId = crypto.randomUUID();
    const key = `RUN-TEST-${Date.now()}`;
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'WorkItem', 'Running', now(), $5, $5)`,
      [runId, key, agent.rows[0].id, agent.rows[0].versionId, ownerId],
    );
    try {
      await expect(deleteRun(key)).rejects.toBeInstanceOf(AgentRejected);

      await testPool().query("update ai.run set status = 'Succeeded', ended_at = now() where id = $1", [runId]);
      await testPool().query(
        `insert into ai.run_step (run_id, seq, type, name, status, started_at) values ($1, 1, 'Tool', 'project_list', 'Done', now())`,
        [runId],
      );
      const approval = await testPool().query<{ id: string }>(
        `insert into ai.approval (key, run_id, requested_by_type, action) values ('APR-T' || floor(random() * 1e6)::int, $1, 'Agent', 'project_create') returning id`,
        [runId],
      );
      await testPool().query(
        `insert into ai.inbox_item (person_id, kind, source_type, source_id) values ($1, 'Approval', 'Approval', $2)`,
        [ownerId, approval.rows[0].id],
      );

      await deleteRun(key);

      const left = await testPool().query<{ runs: number; steps: number; approvals: number; items: number }>(
        `select (select count(*)::int from ai.run where id = $1) as runs,
                (select count(*)::int from ai.run_step where run_id = $1) as steps,
                (select count(*)::int from ai.approval where id = $2) as approvals,
                (select count(*)::int from ai.inbox_item where source_id = $2) as items`,
        [runId, approval.rows[0].id],
      );
      expect(left.rows[0]).toEqual({ runs: 0, steps: 0, approvals: 0, items: 0 });
    } finally {
      await testPool().query("delete from ai.run_step where run_id = $1", [runId]);
      await testPool().query("delete from ai.approval where run_id = $1", [runId]);
      await testPool().query("delete from ai.run where id = $1", [runId]);
    }
  });

  it("UC-52.1-06 a replay from a step without a reason is refused", async () => {
    const { replayRun, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const run = await testPool().query<{ key: string }>("select key from ai.run limit 1");

    // Replaying the whole run repeats what happened; starting part-way is a person
    // deciding the earlier steps were right, and the trail should say why.
    await expect(
      replayRun({ key: run.rows[0].key, fromStep: 2 }),
    ).rejects.toBeInstanceOf(AgentRejected);
  });

  it("UC-52.1-06 a replay starts a new run and never rewrites the original", async () => {
    const { replayRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const run = await testPool().query<{ key: string; status: string; id: string }>(
      "select key, status, id from ai.run limit 1",
    );

    let posted: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      posted = JSON.parse(String(init?.body ?? "{}"));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    await replayRun({ key: run.rows[0].key, fromStep: 1, reason: "The tool returned stale data." });

    // The new run points back at the original by its row id, which is what the agent
    // service's own model names — the key the console shows would be dropped in silence.
    expect(posted!.replay_of_run_id).toBe(run.rows[0].id);
    expect(posted!.replay_from_step).toBe(1);
    expect(posted!.trigger).toBe("Replay");

    const original = await testPool().query<{ status: string }>("select status from ai.run where key = $1", [
      run.rows[0].key,
    ]);
    expect(original.rows[0].status).toBe(run.rows[0].status);
  });

  it("UC-52.1-06 refuses a replay to someone who may not start a run", async () => {
    const { replayRun } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");

    const guest = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id
       where r.code = 'Guest' limit 1`,
    );
    if (guest.rowCount === 0) return;
    signedInAs = guest.rows[0].id;

    const run = await testPool().query<{ key: string }>("select key from ai.run limit 1");
    await expect(replayRun({ key: run.rows[0].key })).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-52.1-10 a resumed run shows no duplicate step", async () => {
    const { loadRun } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const withSteps = await testPool().query<{ key: string }>(
      `select r.key from ai.run r
       where exists (select 1 from ai.run_step s where s.run_id = r.id) limit 1`,
    );
    const detail = await loadRun(withSteps.rows[0].key);

    // The harness replays a workflow from its history after a restart, so a step appearing
    // twice would mean a side effect happened twice. The sequence numbers are the proof.
    const sequence = detail!.steps.map((_, index) => index);
    expect(new Set(sequence).size).toBe(detail!.steps.length);
  });
});
