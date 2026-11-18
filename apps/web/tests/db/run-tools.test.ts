import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `run_list` and `run_get`: an agent reads runs as the run list and the run viewer show them, so
 * it can name the runs that keep an agent from being deleted, and `agent_delete` names them too.
 */

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

async function tool(name: string) {
  const { PLATFORM_TOOLS } = await import("@/mcp/tools");
  const entry = PLATFORM_TOOLS.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return { entry, call: (input: unknown) => entry.run(entry.input.parse(input) as never) };
}

type ListedRun = { key: string; agentCode: string; status: string; contextType: string; contextKey: string | null; parentRunKey: string | null; endedAt: string | null };

describe.skipIf(!hasDatabase)("run_list and run_get", () => {
  let ownerId = "";
  let approverId = "";
  const code = `zz-runs-${Date.now().toString(36)}`;
  /** Oldest first: the parent, its Running child about a request, then ten Failed runs. */
  const runs: { id: string; key: string }[] = [];
  let request = { id: "", key: "" };

  beforeAll(async () => {
    const person = async (email: string) =>
      (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;
    ownerId = await person("mariam@tahseel.ae");
    // An Approver: no agents:read.
    approverId = await person("fatima@tahseel.ae");
    request = (await testPool().query<{ id: string; key: string }>("select id, key from work.request order by key limit 1")).rows[0];

    const { createAgent } = await import("@/features/agents/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;
    const route = await testPool().query<{ alias: string }>("select alias from ai.route where kind = 'Standard' limit 1");
    await createAgent({
      code,
      nameEn: "Runs",
      nameAr: "عمليات",
      orgUnitId: null,
      profile: "Triage",
      trust: "Standard",
      routeAlias: route.rows[0].alias,
    });
    const [agent] = (
      await testPool().query<{ id: string; versionId: string }>(
        'select id, active_version_id as "versionId" from ai.agent where code = $1',
        [code],
      )
    ).rows;

    for (let index = 0; index < 12; index += 1) {
      const id = crypto.randomUUID();
      const key = await repository.openRun({
        id,
        agentId: agent.id,
        agentVersionId: agent.versionId,
        trigger: "Manual",
        contextType: index === 1 ? "Request" : "Console",
        contextId: index === 1 ? request.id : null,
        temporalWorkflowId: null,
        replayOfRunId: null,
        replayFromStep: null,
        grantedTools: [],
        personId: ownerId,
        parentRunId: index === 1 ? runs[0].id : null,
      });
      runs.push({ id, key });
      // A minute apart, so newest first is one order and not a tie.
      await testPool().query(
        `update ai.run set status = $2, started_at = now() - make_interval(mins => 60 - $3::int),
           ended_at = case when $2 = 'Running' then null else now() - make_interval(mins => 59 - $3::int) end
         where id = $1`,
        [id, index === 0 ? "Succeeded" : index === 1 ? "Running" : "Failed", index],
      );
    }
  });

  afterAll(async () => {
    const repository = await import("@/features/agents/repository");
    for (const run of [...runs].reverse()) await repository.deleteRun(run.id);
    signedInAs = ownerId;
    const { deleteAgent } = await import("@/features/agents/service");
    await deleteAgent(code);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("lists one agent's runs newest first, with their context and the run that delegated them", async () => {
    signedInAs = ownerId;
    const { call } = await tool("run_list");

    const listed = ((await call({ agentCode: code })) as { runs: ListedRun[] }).runs;
    expect(listed.map((run) => run.key)).toEqual(runs.map((run) => run.key).reverse());
    expect(listed.every((run) => run.agentCode === code)).toBe(true);

    const child = listed.find((run) => run.key === runs[1].key)!;
    expect(child).toMatchObject({
      status: "Running",
      contextType: "Request",
      contextKey: request.key,
      parentRunKey: runs[0].key,
      endedAt: null,
    });
    const parent = listed.find((run) => run.key === runs[0].key)!;
    expect(parent).toMatchObject({ status: "Succeeded", contextType: "Console", contextKey: null, parentRunKey: null });
    expect(parent.endedAt).not.toBeNull();
  });

  it("filters by status and bounds the count", async () => {
    signedInAs = ownerId;
    const { entry, call } = await tool("run_list");

    const running = ((await call({ agentCode: code, status: "Running" })) as { runs: ListedRun[] }).runs;
    expect(running.map((run) => run.key)).toEqual([runs[1].key]);

    const newest = ((await call({ agentCode: code, limit: 3 })) as { runs: ListedRun[] }).runs;
    expect(newest.map((run) => run.key)).toEqual(runs.slice(-3).map((run) => run.key).reverse());

    expect(entry.input.safeParse({ limit: 201 }).success).toBe(false);
    expect(entry.input.safeParse({ status: "Done" }).success).toBe(false);
  });

  it("reads one run by key as the run viewer does, and says when there is none", async () => {
    signedInAs = ownerId;
    const { call } = await tool("run_get");
    const { AgentRejected } = await import("@/features/agents/service");

    const detail = (await call({ key: runs[1].key })) as { run: ListedRun & { id: string; st: string } };
    expect(detail.run).toMatchObject({ id: runs[1].key, st: "Running", parentRunKey: runs[0].key });

    await expect(call({ key: "RUN-0" })).rejects.toBeInstanceOf(AgentRejected);
  });

  it("refuses somebody without agents:read", async () => {
    signedInAs = approverId;
    const { NotPermitted } = await import("@/lib/session");

    await expect((await tool("run_list")).call({})).rejects.toBeInstanceOf(NotPermitted);
    await expect((await tool("run_get")).call({ key: runs[0].key })).rejects.toBeInstanceOf(NotPermitted);
  });

  it("agent_delete names the newest ten runs in its way and how many more there are", async () => {
    signedInAs = ownerId;
    const { call } = await tool("agent_delete");

    const refusal = await call({ code }).then(
      () => null,
      (problem: Error & { messageAr?: string }) => problem,
    );
    expect(refusal?.message).toBe(
      `This agent cannot be deleted: it still has 12 runs (${runs
        .slice(2)
        .map((run) => run.key)
        .reverse()
        .join(", ")} and 2 more).`,
    );
    expect(refusal?.messageAr).toContain(runs[11].key);
  });

  it("gives the built-in Assistant the run reads on every version", async () => {
    const { BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    expect(BUILTIN_DEFAULTS.tools).toEqual(expect.arrayContaining(["run_list", "run_get"]));

    const missing = await testPool().query(
      `select v.id from ai.agent_version v join ai.agent a on a.id = v.agent_id and a.is_builtin
        where (select count(*) from ai.agent_platform_tool t
                where t.agent_version_id = v.id and t.tool_name in ('run_list', 'run_get')) < 2`,
    );
    expect(missing.rows).toEqual([]);
  });
});
