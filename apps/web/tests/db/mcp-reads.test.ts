import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * Platform MCP tools that are only reached through the server: the page assistant's two
 * reads, and an OpenAPI connector's operations, which are rows rather than catalogue
 * entries and are resolved by name at call time.
 *
 * Each call goes through `handleMcpRequest` with a minted run token, so what is checked is
 * what the harness gets back: the grant, the acting person's permissions, and the result.
 */

process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";
process.env.APP_KEK ??= Buffer.alloc(32, 7).toString("base64");

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// An MCP connector's tools are listed and called through the connector runtime (D223).
const runtime = vi.hoisted(() => ({
  tools: [] as { name: string; description: string; inputSchema?: Record<string, unknown> }[],
  calls: [] as { connector: string; name: string; args: Record<string, unknown> }[],
  answer: (): { content: string; structured: unknown } => ({ content: "", structured: null }),
}));
vi.mock("@/lib/connector-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connector-runtime")>()),
  reloadConnectors: async () => undefined,
  listTools: async () => runtime.tools,
  callConnectorTool: async (connector: string, name: string, args: Record<string, unknown>) => {
    runtime.calls.push({ connector, name, args });
    return runtime.answer();
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

type McpAnswer = {
  result?: { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  error?: { code: number; message: string };
};

/** MCP's code for a tool the caller may not run. */
const NOT_PERMITTED = -32001;

const personId = async (email: string) =>
  (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;

/** A model token for the run, granting exactly `tools`. */
async function tokenFor(person: string, tools: string[], runId: string = crypto.randomUUID()): Promise<string> {
  const { mintRunToken } = await import("@/lib/run-token");
  const agent = await testPool().query<{ id: string }>("select id from ai.agent where code = 'pa'");
  return mintRunToken({
    kind: "model",
    runId,
    agentId: agent.rows[0].id,
    personId: person,
    routes: [],
    connectors: [],
    tools,
  });
}

/** What `tools/list` offers the run. */
async function list(token: string): Promise<{ name: string; inputSchema: Record<string, unknown> }[]> {
  const { handleMcpRequest } = await import("@/mcp/server");
  const response = await handleMcpRequest(
    new Request("http://web.awp-app.svc:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  return ((await response.json()) as { result: { tools: { name: string; inputSchema: Record<string, unknown> }[] } }).result.tools;
}

async function call(token: string, name: string, args: Record<string, unknown>): Promise<McpAnswer> {
  const { handleMcpRequest } = await import("@/mcp/server");
  const response = await handleMcpRequest(
    new Request("http://web.awp-app.svc:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  return (await response.json()) as McpAnswer;
}

describe.skipIf(!hasDatabase)("page_read and my_attention through the platform MCP server", () => {
  const stamp = Date.now().toString().slice(-6);
  const projectKey = `MA${stamp}`;
  const keys = { mine: `MA${stamp}-1`, done: `MA${stamp}-2`, theirs: `MA${stamp}-3` };
  let ownerId = "";
  let memberId = "";
  let auditorId = "";
  let leadId = "";

  beforeAll(async () => {
    ownerId = await personId("mariam@tahseel.ae");
    memberId = await personId("layla@tahseel.ae");
    auditorId = await personId("hessa@tahseel.ae");
    leadId = await personId("khalid@tahseel.ae");

    const project = await testPool().query<{ id: string }>(
      `insert into work.project (key, name_en, name_ar) values ($1, 'Attention', 'انتباه') returning id`,
      [projectKey],
    );
    const item = (key: string, assignee: string, status: string) =>
      testPool().query<{ id: string }>(
        `insert into work.work_item (key, project_id, title_en, title_ar, status, assignee_type, assignee_id, due_at)
         values ($1, $2, $1, $1, $3, 'Person', $4, '2000-01-01T00:00:00Z') returning id`,
        [key, project.rows[0].id, status, assignee],
      );
    const mine = await item(keys.mine, memberId, "InProgress");
    await item(keys.done, memberId, "Done");
    await item(keys.theirs, leadId, "InProgress");
    await testPool().query(
      `insert into ai.inbox_item (person_id, kind, source_type, source_id) values ($1, 'Review', 'WorkItem', $2)`,
      [memberId, mine.rows[0].id],
    );
  });

  afterAll(async () => {
    await testPool().query(
      `delete from ai.inbox_item where source_type = 'WorkItem' and source_id in (
         select wi.id from work.work_item wi join work.project p on p.id = wi.project_id where p.key = $1)`,
      [projectKey],
    );
    await testPool().query("delete from work.work_item where project_id in (select id from work.project where key = $1)", [projectKey]);
    await testPool().query("delete from work.project where key = $1", [projectKey]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-03.1-02 page_read reads the screen a path names as that screen's own service reads it", async () => {
    const token = await tokenFor(ownerId, ["page_read"]);

    const answer = await call(token, "page_read", { path: "/work-items?open=X-1#activity" });
    expect(answer.error).toBeUndefined();
    const page = answer.result?.structuredContent as { screen: string; path: string; content: { items: { k: string }[] } };
    // The query and the fragment pick a row on the screen; the screen is the path.
    expect(page.screen).toBe("tasks");
    expect(page.path).toBe("/work-items");
    expect(page.content.items.map((item) => item.k)).toEqual(expect.arrayContaining(Object.values(keys)));
    expect(JSON.parse(answer.result?.content[0]?.text ?? "null")).toEqual(page);

    // A screen with nothing to read says so, so the agent does not guess at it.
    const blank = await call(token, "page_read", { path: "/settings" });
    expect(blank.result?.structuredContent).toEqual({
      screen: "settings",
      path: "/settings",
      content: { note: "This screen has no readable content. Say so rather than guessing at it." },
    });
  });

  it("D31 D32 page_read refuses a screen the person may not open, and a run not granted it", async () => {
    const refused = await call(await tokenFor(memberId, ["page_read"]), "page_read", { path: "/budgets" });
    expect(refused.result).toBeUndefined();
    expect(refused.error?.code).toBe(NOT_PERMITTED);
    expect(refused.error?.message).toMatch(/budgets:read\. user_permission: /);

    const ungranted = await call(await tokenFor(ownerId, ["my_attention"]), "page_read", { path: "/work-items" });
    expect(ungranted.error?.code).toBe(NOT_PERMITTED);
    expect(ungranted.error?.message).toContain("agent_grant: page_read is not granted to this agent.");
  });

  it("UC-03.1-02 my_attention lists what waits on the person before their own open work, each with the path that opens it", async () => {
    const answer = await call(await tokenFor(memberId, ["my_attention"]), "my_attention", { limit: 50 });
    expect(answer.error).toBeUndefined();
    const { items } = answer.result?.structuredContent as {
      items: { kind: string; key: string; rank: number; why: string; href: string }[];
    };

    const review = items.findIndex((item) => item.kind === "Review" && item.href === `/work-items?open=${keys.mine}`);
    const work = items.findIndex((item) => item.kind === "WorkItem" && item.key === keys.mine);
    expect(review).toBeGreaterThanOrEqual(0);
    expect(items[review]).toMatchObject({ rank: 1, why: "Work is waiting on this review." });
    expect(items[work]).toMatchObject({ rank: 3, href: `/work-items?open=${keys.mine}`, why: "InProgress · Medium priority" });
    // A review blocks somebody else's work; the person's own work follows it.
    expect(review).toBeLessThan(work);
    // Finished work waits on nobody.
    expect(items.some((item) => item.key === keys.done)).toBe(false);
    // Most blocking first, whatever else the person has waiting.
    expect(items.map((item) => item.rank)).toEqual([...items.map((item) => item.rank)].sort((a, b) => a - b));
  });

  it("UC-03.1-02 my_attention lists the person's own open work, not work assigned to somebody else", async () => {
    const answer = await call(await tokenFor(memberId, ["my_attention"]), "my_attention", { limit: 50 });
    const { items } = answer.result?.structuredContent as { items: { kind: string; key: string }[] };

    expect(items.some((item) => item.key === keys.mine)).toBe(true);
    expect(items.filter((item) => item.key === keys.theirs)).toEqual([]);
  });

  it("D31 D32 my_attention refuses a person without an Inbox, and a run not granted it", async () => {
    const refused = await call(await tokenFor(auditorId, ["my_attention"]), "my_attention", {});
    expect(refused.error?.code).toBe(NOT_PERMITTED);
    expect(refused.error?.message).toMatch(/inbox:read\. user_permission: /);

    const ungranted = await call(await tokenFor(memberId, ["page_read"]), "my_attention", {});
    expect(ungranted.error?.code).toBe(NOT_PERMITTED);
    expect(ungranted.error?.message).toContain("agent_grant: my_attention is not granted to this agent.");
  });
});

describe.skipIf(!hasDatabase)("an OpenAPI connector operation through the platform MCP server", () => {
  const code = `ledger-${Date.now().toString(36)}`;
  const secret = "ledger-bearer-for-the-tests";
  /** Every request the API received, in order. */
  const received: { method: string; url: string; authorization: string; accept: string; contentType: string; body: string }[] = [];
  let api: Server;
  let ownerId = "";

  const bodyOf = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let text = "";
      request.on("data", (chunk) => (text += String(chunk)));
      request.on("end", () => resolve(text));
    });

  beforeAll(async () => {
    api = createServer(async (request, response) => {
      const body = await bodyOf(request);
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        accept: request.headers.accept ?? "",
        contentType: request.headers["content-type"] ?? "",
        body,
      });
      const [path] = (request.url ?? "").split("?");
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.method === "GET" && path === "/v1/entries/42") return json(200, { id: "42", amount: 10 });
      if (request.method === "GET") return json(404, { error: `no entry ${path.split("/").pop()}` });
      if (request.method === "POST") return json(201, { id: "43", ...JSON.parse(body || "{}") });
      return json(405, { error: "method" });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const { port } = api.address() as AddressInfo;

    ownerId = await personId("mariam@tahseel.ae");
    signedInAs = ownerId;
    const { importApiConnector } = await import("@/features/connectors/service");
    await importApiConnector({
      code,
      document: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Ledger", version: "1.0" },
        servers: [{ url: `http://127.0.0.1:${port}/v1` }],
        paths: {
          "/entries/{id}": {
            get: {
              operationId: "readEntry",
              summary: "Read an entry",
              parameters: [
                { name: "id", in: "path", required: true, schema: { type: "string" } },
                { name: "verbose", in: "query", required: false, schema: { type: "boolean" } },
              ],
              responses: {},
            },
            delete: {
              operationId: "deleteEntry",
              summary: "Delete an entry",
              parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
              responses: {},
            },
          },
          "/entries": {
            post: {
              operationId: "postEntry",
              summary: "Post an entry",
              requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
              responses: {},
            },
          },
        },
      }),
      serverUrl: "",
      authType: "Bearer",
      credential: { type: "Bearer", token: secret },
      defaultTier: "T1",
      enabled: true,
    });
    signedInAs = "";
    // Deleting is the operation a person has to agree to first.
    await testPool().query(
      `update ai.connector_tool set tier = 'T2'
       where name = 'deleteEntry' and connector_id = (select id from ai.connector where code = $1)`,
      [code],
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await testPool().query("delete from ai.connector where code = $1", [code]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-54.1-09 calls the operation with the stored credential and the model's arguments, and hands the answer back", async () => {
    const token = await tokenFor(ownerId, [`${code}/readEntry`, `${code}/postEntry`]);
    received.length = 0;

    const read = await call(token, `${code}/readEntry`, { id: "42", verbose: true });
    expect(read.error).toBeUndefined();
    expect(read.result).toMatchObject({ isError: false, structuredContent: { id: "42", amount: 10 } });
    expect(received[0]).toMatchObject({
      method: "GET",
      url: "/v1/entries/42?verbose=true",
      authorization: `Bearer ${secret}`,
      accept: "application/json",
      body: "",
    });

    const posted = await call(token, `${code}/postEntry`, { body: { amount: 5, memo: "رسوم" } });
    expect(posted.result?.structuredContent).toEqual({ id: "43", amount: 5, memo: "رسوم" });
    expect(received[1]).toMatchObject({ method: "POST", url: "/v1/entries", contentType: "application/json" });
    expect(JSON.parse(received[1].body)).toEqual({ amount: 5, memo: "رسوم" });

    const audited = await testPool().query<{ outcome: string; status: string; actor: string }>(
      `select outcome, detail_json->>'status' as status, actor_type as actor from audit.audit_entry
       where action = $1 order by at`,
      [`mcp:${code}/readEntry`],
    );
    expect(audited.rows).toEqual([{ outcome: "Allowed", status: "200", actor: "Agent" }]);
  });

  it("UC-54.1-09 refuses an operation the connector does not have, or a call missing a required parameter, without calling the API", async () => {
    const token = await tokenFor(ownerId, [`${code}/nope`, `${code}/readEntry`]);
    received.length = 0;

    const missing = await call(token, `${code}/nope`, {});
    expect(missing.error?.message).toBe(`${code} has no operation nope.`);

    const incomplete = await call(token, `${code}/readEntry`, { verbose: true });
    expect(incomplete.error?.message).toBe("readEntry needs id.");
    expect(received).toEqual([]);
  });

  it("D138 a non-2xx answer is the API's answer, handed to the agent as data rather than as a platform failure", async () => {
    const token = await tokenFor(ownerId, [`${code}/readEntry`]);
    received.length = 0;

    const answer = await call(token, `${code}/readEntry`, { id: "missing" });
    expect(received.map((request) => request.url)).toEqual(["/v1/entries/missing"]);
    expect(answer.error).toBeUndefined();
    expect(answer.result?.isError).toBe(false);
    expect(JSON.parse(answer.result?.content[0]?.text ?? "null")).toEqual({ error: "no entry missing" });
  });

  it("D30 refuses a connector operation the run's grant does not name, before the API is called", async () => {
    const token = await tokenFor(ownerId, [`${code}/readEntry`]);
    received.length = 0;

    const answer = await call(token, `${code}/postEntry`, { body: { amount: 1 } });
    expect(answer.error?.code).toBe(NOT_PERMITTED);
    expect(answer.error?.message).toContain("agent_grant:");
    expect(received).toEqual([]);
  });

  it("D223 lists a granted operation under a name a model may call, with its schema, and that name reaches it", async () => {
    const token = await tokenFor(ownerId, [`${code}/readEntry`]);
    received.length = 0;

    const offered = (await list(token)).filter((tool) => tool.name.startsWith(code));
    expect(offered.map((tool) => tool.name)).toEqual([`${code}__readEntry`]);
    expect(offered[0].inputSchema).toMatchObject({ properties: { id: { type: "string" } }, required: ["id"] });

    const read = await call(token, `${code}__readEntry`, { id: "42" });
    expect(read.result?.structuredContent).toEqual({ id: "42", amount: 10 });
    expect(received.map((request) => request.url)).toEqual(["/v1/entries/42"]);
  });

  it("D49 refuses a T2 connector operation with no approval, before the API is called", async () => {
    const token = await tokenFor(ownerId, [`${code}/deleteEntry`]);
    received.length = 0;

    const answer = await call(token, `${code}/deleteEntry`, { id: "42" });
    expect(answer.error?.code).toBe(NOT_PERMITTED);
    expect(answer.error?.message).toContain("approval_required");
    expect(received).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)("an MCP connector's tools through the platform MCP server (D223)", () => {
  const code = `cubes-${Date.now().toString(36)}`;
  let ownerId = "";

  beforeAll(async () => {
    ownerId = await personId("mariam@tahseel.ae");
    const connector = await testPool().query<{ id: string }>(
      `insert into ai.connector (code, name_en, name_ar, transport, server_url, is_enabled, status)
       values ($1, 'Cubes', 'المكعبات', 'StreamableHttp', 'http://cubes.example.test/mcp', true, 'Connected') returning id`,
      [code],
    );
    for (const [name, tier] of [
      ["execute_query", "T1"],
      ["drop_cube", "T2"],
      ["list_cubes", "T0"],
    ]) {
      await testPool().query(
        `insert into ai.connector_tool (connector_id, name, title_en, title_ar, description_en, tier) values ($1, $2, $2, $2, $2, $3)`,
        [connector.rows[0].id, name, tier],
      );
    }
    runtime.tools = [
      {
        name: "execute_query",
        description: "Run a query",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      { name: "drop_cube", description: "Drop a cube", inputSchema: { type: "object" } },
      { name: "list_cubes", description: "List cubes", inputSchema: { type: "object" } },
    ];
  });

  afterAll(async () => {
    await testPool().query("delete from ai.connector where code = $1", [code]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("lists exactly the granted tools under their model names, with the server's own schema", async () => {
    const token = await tokenFor(ownerId, [`${code}/execute_query`]);
    const offered = (await list(token)).filter((tool) => tool.name.startsWith(code));
    expect(offered).toEqual([
      expect.objectContaining({
        name: `${code}__execute_query`,
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      }),
    ]);
  });

  it("forwards a granted call to the connector runtime, hands back what the server answered, and audits it", async () => {
    const token = await tokenFor(ownerId, [`${code}/execute_query`]);
    runtime.calls.length = 0;
    runtime.answer = () => ({ content: "", structured: { result: [{ revenue: 1200 }] } });

    const answer = await call(token, `${code}__execute_query`, { query: "EVALUATE Revenue" });
    expect(answer.error).toBeUndefined();
    expect(answer.result?.structuredContent).toEqual({ result: [{ revenue: 1200 }] });
    expect(runtime.calls).toEqual([{ connector: code, name: "execute_query", args: { query: "EVALUATE Revenue" } }]);

    const audited = await testPool().query<{ outcome: string }>("select outcome from audit.audit_entry where action = $1", [
      `mcp:${code}/execute_query`,
    ]);
    expect(audited.rows).toEqual([{ outcome: "Allowed" }]);
  });

  it("gives the model the server's own error rather than a platform failure", async () => {
    const token = await tokenFor(ownerId, [`${code}/execute_query`]);
    runtime.answer = () => {
      throw new Error("Query (1, 10) The syntax for 'Revenue' is incorrect.");
    };
    const answer = await call(token, `${code}__execute_query`, { query: "EVALUATE Revenue" });
    expect(answer.error?.message).toBe("Query (1, 10) The syntax for 'Revenue' is incorrect.");
  });

  it("D30 D49 refuses an ungranted tool, and a T2 one with no approval, before the runtime is called", async () => {
    runtime.calls.length = 0;
    const ungranted = await call(await tokenFor(ownerId, [`${code}/execute_query`]), `${code}__list_cubes`, {});
    expect(ungranted.error?.message).toContain("agent_grant:");

    const unapproved = await call(await tokenFor(ownerId, [`${code}/drop_cube`]), `${code}__drop_cube`, {});
    expect(unapproved.error?.message).toContain("approval_required");
    expect(runtime.calls).toEqual([]);
  });

  it("refuses a call to a disabled connector, saying so", async () => {
    await testPool().query("update ai.connector set is_enabled = false where code = $1", [code]);
    try {
      const answer = await call(await tokenFor(ownerId, [`${code}/execute_query`]), `${code}__execute_query`, { query: "x" });
      expect(answer.error?.message).toBe(`${code} is disabled.`);
    } finally {
      await testPool().query("update ai.connector set is_enabled = true where code = $1", [code]);
    }
  });
});

describe.skipIf(!hasDatabase)("D104 D291 a room run's reads", () => {
  const key = `SES-FL${Date.now().toString().slice(-6)}`;
  let ownerId = "";
  let runId = "";

  beforeAll(async () => {
    ownerId = await personId("mariam@tahseel.ae");
    // Hessa is an Auditor: she may read the room, not the knowledge base or memory.
    const auditorId = await personId("hessa@tahseel.ae");
    const room = await testPool().query<{ id: string }>(
      `insert into work.discussion_room (key, project_id, title_en, title_ar, turn_taking)
       select $1, id, 'Floor', 'Floor', 'Autonomous' from work.project order by key limit 1 returning id`,
      [key],
    );
    await testPool().query(
      `insert into work.room_participant (room_id, principal_type, principal_id, room_role)
       values ($1, 'Person', $2, 'Owner'), ($1, 'Person', $3, 'Member')`,
      [room.rows[0].id, ownerId, auditorId],
    );
    const agent = (
      await testPool().query<{ id: string; versionId: string }>(
        `select id, active_version_id as "versionId" from ai.agent where code = 'pa'`,
      )
    ).rows[0];
    runId = crypto.randomUUID();
    await testPool().query(
      `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, context_id, status, started_at, created_by, updated_by)
       values ($1, $2, $3, $4, 'Manual', 'Room', $5, 'Running', now(), $6, $6)`,
      [runId, `RUN-FL-${runId.slice(0, 8)}`, agent.id, agent.versionId, room.rows[0].id, ownerId],
    );
  });

  afterAll(async () => {
    // The finished run wrote its steps (D360).
    await testPool().query("delete from ai.run_step where run_id = $1", [runId]);
    await testPool().query("delete from ai.run where id = $1", [runId]);
    await testPool().query("delete from work.discussion_room where key = $1", [key]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("D291 knowledge_search is bounded by the agent's grant and the requester, not by the room's other members", async () => {
    const token = await tokenFor(ownerId, ["knowledge_search", "memory_search"], runId);

    const knowledge = await call(token, "knowledge_search", { query: "judicial deposits" });
    expect(knowledge.error).toBeUndefined();
    expect(knowledge.result?.structuredContent).toHaveProperty("ok");

    // Every other read stays bounded by what each member may see (D104).
    const memory = await call(token, "memory_search", { query: "deposits" });
    expect(memory.error?.code).toBe(NOT_PERMITTED);
    expect(memory.error?.message).toContain("room_read_floor: not everyone in this room may memory:read");
  });

  it("D360 the harness records the run's finish whatever the room's members may do", async () => {
    // Hessa holds no `agents:invoke`: under the read floor `run_finish` was refused, and the
    // run read Running for ever (RUN-88233).
    const { mintRunToken } = await import("@/lib/run-token");
    const agent = await testPool().query<{ id: string }>("select id from ai.agent where code = 'pa'");
    const harness = await mintRunToken({
      kind: "harness",
      runId,
      agentId: agent.rows[0].id,
      personId: ownerId,
      routes: [],
      connectors: [],
      tools: ["run_finish"],
    });

    const finished = await call(harness, "run_finish", { run_id: runId, status: "Succeeded", output: "Done." });

    expect(finished.error).toBeUndefined();
    const run = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
    expect(run.rows[0].status).toBe("Succeeded");
  });
});
