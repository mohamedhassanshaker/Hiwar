import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-03 the page assistant, on the half that is decided before a word is streamed: the run
 * this platform assembles and the token it carries.
 *
 * The contract between the two services is what these cases are really about. The console's
 * runtime pointed every agent at `/agui/agents/{id}`, a path the agent service does not
 * serve, so nothing could ever have run; and the run body has field names only the agent
 * service knows. A test that asserted "a run started" against a stub would have passed
 * throughout. These assert the body itself, field by field, against the model the agent
 * service validates with.
 */

// The run is posted to the agent service, so the service has to have an address. The
// request itself is captured rather than made.
process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
// The run token is signed, and the signature is what the platform MCP server checks. A
// test key is enough: these cases assert the claims, not the cryptography.
process.env.RUN_TOKEN_SIGNING_KEY ??= "test-run-token-signing-key-at-least-32-chars";

let signedInAs = "";
/** What the service posted, captured instead of sent. */
let posted: { url: string; body: Record<string, unknown> } | null = null;

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

describe.skipIf(!hasDatabase)("page assistant", () => {
  let ownerId = "";
  let memberId = "";
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    posted = null;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** Capture the outgoing run instead of making one. */
  function captureRun(response: Partial<Response> = { ok: true, status: 200 }) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      posted = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
      return response as Response;
    }) as typeof fetch;
  }

  it("UC-03.1-01 assembles a run the agent service's own model accepts", async () => {
    const { startRun } = await import("@/features/agents/service");
    signedInAs = ownerId;
    captureRun();

    const runId = await startRun({ agentCode: "pa", prompt: "What needs my attention today?", screen: "/dashboard" , surface: "AssistantPanel" });
    expect(runId).toBeTruthy();
    expect(posted?.url).toMatch(/\/agui\/runs$/);

    const body = posted!.body;
    // The names are the agent service's, not this application's. Getting one wrong is a
    // 422 at the moment someone first asks a question, which is the worst place to find it.
    expect(body).toMatchObject({
      run_id: runId,
      route: expect.any(String),
      context_id: "/dashboard",
      trigger: "Manual",
    });
    expect(body.actor).toMatchObject({ person_id: ownerId, locale: expect.stringMatching(/^(en|ar)$/) });
    expect(body.task).toMatchObject({
      description: "What needs my attention today?",
      acceptance_criteria: [],
    });
    expect(body.budget).toHaveProperty("soft_cost_aed");
    expect(body.budget).toHaveProperty("hard_cost_aed");
  });

  it("UC-03.1-04 carries the asker in the token the run uses for every tool call", async () => {
    const { startRun } = await import("@/features/agents/service");
    const { verifyRunToken } = await import("@/lib/run-token");
    signedInAs = memberId;
    captureRun();

    await startRun({ agentCode: "pa", prompt: "Show me the finance budgets", screen: "/budgets" , surface: "AssistantPanel" });

    const actor = posted!.body.actor as { mcp_token: string };
    const claims = await verifyRunToken(actor.mcp_token);

    // Not the agent's own identity: the platform MCP server checks this person's
    // permissions, so the assistant can reach exactly what they can and nothing more.
    expect(claims.personId).toBe(memberId);
    expect(claims.routes.length).toBeGreaterThan(0);
  });

  it("D38 carries the agent's stored grant in the token, not a list hardcoded here", async () => {
    const { startRun } = await import("@/features/agents/service");
    const { verifyRunToken } = await import("@/lib/run-token");
    signedInAs = ownerId;
    captureRun();

    await startRun({ agentCode: "pa", prompt: "What needs my attention?", screen: "/dashboard", surface: "AssistantPanel" });
    const actor = posted!.body.actor as { mcp_token: string };
    const claims = await verifyRunToken(actor.mcp_token);

    const granted = await testPool().query<{ tool_name: string }>(
      `select t.tool_name from ai.agent_platform_tool t
         join ai.agent a on a.active_version_id = t.agent_version_id
        where a.code = 'pa' order by t.tool_name`,
    );
    expect(granted.rows.length).toBeGreaterThan(0);

    // `pa` is configured with no connector tool, so what is left in the token is its stored
    // grant exactly. Before
    // #28 this was `DEFAULT_PLATFORM_TOOLS` whatever the agent was configured with.
    const connectorTools = await testPool().query(
      `select 1 from ai.agent_tool_mode m
         join ai.agent a on a.active_version_id = m.agent_version_id
        where a.code = 'pa'`,
    );
    expect(connectorTools.rows).toEqual([]);
    expect([...claims.tools].sort()).toEqual(granted.rows.map((row) => row.tool_name));
  });

  it("D371 runs the system agent on the panel as the Console context, with no setup tool", async () => {
    const { startRun } = await import("@/features/agents/service");
    const { verifyRunToken } = await import("@/lib/run-token");
    signedInAs = ownerId;

    // `pa` is the system agent and the owner holds every permission, which together used to
    // be most of what put the setup tools in a run. Neither reaches one now: the panel is
    // the Console context, and no setup tool is in the payload or the token.
    captureRun();
    await startRun({ agentCode: "pa", prompt: "Add a project", screen: "/dashboard", surface: "AssistantPanel" });
    const assistant = await verifyRunToken((posted!.body.actor as { mcp_token: string }).mcp_token);
    expect(posted!.body.context_type).toBe("Console");
    expect(assistant.tools.filter((name) => name.startsWith("setup_"))).toEqual([]);
    const offered = (posted!.body.tools as { name: string }[]).map((tool) => tool.name);
    expect(offered.filter((name) => name.startsWith("setup_"))).toEqual([]);
  });

  it("UC-03.1-02 names the screen the question was asked on", async () => {
    const { startRun } = await import("@/features/agents/service");
    signedInAs = ownerId;
    captureRun();

    await startRun({ agentCode: "pa", prompt: "Summarise this page", screen: "/projects" , surface: "AssistantPanel" });
    expect(posted!.body.context_id).toBe("/projects");
    // A screen is not a record. Calling it a `WorkItem` is what sent the path to a uuid
    // column the first time the run asked for an approval: the insert threw, the approval
    // was never recorded, and the run waited on it for ever.
    expect(posted!.body.context_type).toBe("Console");
  });

  it("UC-03.1-02 keeps a screen path out of the work item an approval names", async () => {
    const { startRun } = await import("@/features/agents/service");
    const { requestApproval } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    captureRun();

    await startRun({ agentCode: "pa", prompt: "Draft a change", screen: "/dashboard" , surface: "AssistantPanel" });
    const runId = (posted!.body as { run_id: string }).run_id;

    // The harness sends back whatever the run was started with, so this is the exact call
    // the page assistant makes when it asks to hand the question to another agent.
    const approval = await requestApproval({
      run_id: runId,
      tool_name: "delegate_to_agent",
      call_id: "toolu_test",
      arguments: { agent_code: "def" },
      tier: "T1",
      reason: "this tool asks for confirmation first",
      context_type: "WorkItem",
      context_id: "/dashboard",
    });

    const row = await testPool().query<{ work_item_id: string | null }>(
      "select work_item_id from ai.approval where key = $1",
      [approval.key],
    );
    expect(row.rows[0].work_item_id).toBeNull();
  });

  it("UC-03.1-05 reports the agent service being unavailable rather than failing the page", async () => {
    const { startRun, RunNotStarted } = await import("@/features/agents/service");
    signedInAs = ownerId;

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    // The panel turns this into "the assistant is unavailable, try again"; the screen it is
    // attached to never depended on the answer.
    await expect(startRun({ agentCode: "pa", prompt: "hello", screen: "/dashboard" , surface: "AssistantPanel" })).rejects.toBeInstanceOf(
      RunNotStarted,
    );
  });

  it("UC-03.1-05 reports a refusal from the agent service too", async () => {
    const { startRun, RunNotStarted } = await import("@/features/agents/service");
    signedInAs = ownerId;
    captureRun({ ok: false, status: 503 } as Partial<Response>);

    await expect(startRun({ agentCode: "pa", prompt: "hello", screen: "/dashboard" , surface: "AssistantPanel" })).rejects.toBeInstanceOf(
      RunNotStarted,
    );
  });

  it("records the run against the agent, so an assistant answer is as auditable as any run", async () => {
    const { startRun } = await import("@/features/agents/service");
    signedInAs = ownerId;
    captureRun();

    await startRun({ agentCode: "pa", prompt: "Summarise this page", screen: "/agents" , surface: "AssistantPanel" });

    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "agents:invoke", object_label: "pa" });
  });

  it("refuses to start a run for someone who may not invoke an agent", async () => {
    const { startRun } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");

    const guest = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id
       where r.code = 'Guest' limit 1`,
    );
    if (guest.rowCount === 0) return; // the seed carries no guest; nothing to assert
    signedInAs = guest.rows[0].id;
    captureRun();

    await expect(startRun({ agentCode: "pa", prompt: "hello" , surface: "AssistantPanel" })).rejects.toBeInstanceOf(NotPermitted);
    expect(posted).toBeNull();
  });
});
