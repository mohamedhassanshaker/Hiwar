import { beforeAll, describe, expect, it, vi } from "vitest";

// The server reaches the session layer, which reaches Auth.js and the Next.js request.
// Neither exists in a Vitest process, and neither decides anything these cases check.
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
  auth: async () => null,
}));

import { mintRunToken, verifyRunToken } from "@/lib/run-token";
import { handleMcpRequest, MCP_PROTOCOL_VERSION } from "@/mcp/server";
import { PLATFORM_TOOLS, TOOLS_BY_NAME } from "@/mcp/tools";

/**
 * The platform MCP server is the only door into domain data that an agent has, so what is
 * checked here is the door itself: who may open it, and what it says is behind it.
 *
 * The tools themselves are the services the screens already use, and their behaviour is
 * covered by `tests/db/actions.test.ts` against a real database.
 */

const KEY = "test-run-token-signing-key";

/** The run every token below is minted for. The plumbing tools validate it as a uuid. */
const RUN = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  // `env()` validates the whole environment at once, so the cases supply the two values
  // it insists on even though nothing here opens a connection.
  process.env.RUN_TOKEN_SIGNING_KEY = KEY;
  process.env.AUTH_SECRET = "test";
  process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";
});

async function post(body: unknown, token?: string): Promise<Response> {
  return handleMcpRequest(
    new Request("http://web.awp-app.svc:3000/api/mcp", {
      method: "POST",
      // `content-type` because the transport parses a declared JSON body and nothing else;
      // a string body would otherwise be sent as `text/plain` and answered 415.
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * A token in the shape minted before the `kind`, `tools` and `runId` claims existed.
 *
 * Signed with the same key, so it verifies: what it does not carry is the point. It is
 * built here rather than by `mintRunToken`, which cannot leave the claims out any more.
 */
async function signLegacyToken(claims: { agentId: string; personId: string }): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ ...claims, routes: [], connectors: [] })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("awp-web")
    .setAudience("awp-agents")
    .setSubject(claims.agentId)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(KEY));
}

describe("the run token", () => {
  it("carries the person an agent acts for, and the routes and connectors it may use", async () => {
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "agent-1",
      personId: "person-1",
      routes: ["reasoning-default"],
      connectors: ["erp"],
      tools: ["work_item_search"],
    });
    const claims = await verifyRunToken(token);
    expect(claims).toMatchObject({
      agentId: "agent-1",
      personId: "person-1",
      routes: ["reasoning-default"],
      connectors: ["erp"],
    });
  });

  it("refuses a token whose claims were edited after signing", async () => {
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "a",
      personId: "person-1",
      routes: [],
      connectors: [],
      tools: [],
    });
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    claims.personId = "someone-else";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
      signature,
    ].join(".");

    await expect(verifyRunToken(tampered)).rejects.toThrow();
  });
});

describe("the platform MCP server", () => {
  it("refuses a call with no run token", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
  });

  it("refuses a call whose token does not verify", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "not-a-token");
    expect(response.status).toBe(401);
  });

  it("refuses a token that names no person, because a tool runs as somebody", async () => {
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "agent-1", personId: "", routes: [], connectors: [], tools: [] });
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    expect(response.status).toBe(401);
  });

  it("answers the handshake with the protocol version the Integrations screen shows", async () => {
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools: [] });
    const handshake = async (asked: string) => {
      const response = await post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: "test", version: "0" } },
        },
        token,
      );
      return (await response.json()) as { result: { protocolVersion: string } };
    };

    expect((await handshake(MCP_PROTOCOL_VERSION)).result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    // A client on an older revision is answered its own, so what the screen reports is the
    // newest this server speaks rather than the only one it will agree to.
    expect((await handshake("2025-06-18")).result.protocolVersion).toBe("2025-06-18");
  });

  it("lists every granted tool with the tier the platform set, not one the agent chose", async () => {
    const granted = PLATFORM_TOOLS.map((entry) => entry.name);
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools: granted });
    const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, token);
    const body = (await response.json()) as {
      result: { tools: Array<{ name: string; annotations: Record<string, unknown> }> };
    };
    expect(body.result.tools).toHaveLength(PLATFORM_TOOLS.length);
    for (const listed of body.result.tools) {
      const declared = PLATFORM_TOOLS.find((entry) => entry.name === listed.name);
      expect(listed.annotations["awp/tier"]).toBe(declared?.tier);
      expect(listed.annotations.readOnlyHint).toBe(declared?.tier === "T0");
    }
  });

  it("offers an agent only the tools its configuration granted", async () => {
    // Specification 7.4: an agent is its instructions *and* its skills, tools, memory and
    // knowledge. What it may call is its configuration, never the catalogue.
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "a",
      personId: "p",
      routes: [],
      connectors: [],
      tools: ["work_item_search"],
    });
    const response = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, token);
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((one) => one.name)).toEqual(["work_item_search"]);
  });

  it("refuses a tool the agent was not granted, however it learned the name", async () => {
    // The hole this closes: every agent caller was offered the whole catalogue, so the
    // only thing keeping a run out of `agent_trust_edit` was that the model had not been told
    // it existed. The bound belongs on the call, not on what the model was told.
    // A real agent id: the refusal is audited, and `audit.actor_id` is a uuid column.
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["work_item_search"],
    });
    const response = await post(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agent_trust_edit", arguments: {} } },
      token,
    );
    const body = (await response.json()) as { error?: { message: string } };
    expect(body.error?.message).toMatch(/not granted/i);
  });

  it("never lists the harness's own plumbing, and refuses it on a model token", async () => {
    // `run_finish` ends a run. It travels on the harness token, so the model is neither
    // told it exists nor able to call it by guessing the name.
    const harness = await mintRunToken({
      kind: "harness",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["run_finish", "approval_create"],
    });
    const listed = (await (
      await post({ jsonrpc: "2.0", id: 6, method: "tools/list" }, harness)
    ).json()) as { result: { tools: unknown[] } };
    expect(listed.result.tools).toEqual([]);

    const model = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["work_item_search"],
    });
    const refused = (await (
      await post(
        { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "run_finish", arguments: {} } },
        model,
      )
    ).json()) as { error?: { message: string } };
    expect(refused.error?.message).toMatch(/agent_grant/);
  });

  it("names why a refusal happened, so the agent explains the right thing", async () => {
    // `agent_grant` is "your configuration does not include this", which is a different
    // sentence from "you personally may not do this" — the agent has to say the right one.
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["work_item_search"],
    });
    const body = (await (
      await post(
        { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "agent_trust_edit", arguments: {} } },
        token,
      )
    ).json()) as { error?: { message: string } };
    expect(body.error?.message).toMatch(/agent_grant: agent_trust_edit is not granted/);
  });

  it("grants no tool at all to a token minted before the claim existed", async () => {
    // "Unknown grant" reads as "none", not as "everything".
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools: [] });
    const response = await post({ jsonrpc: "2.0", id: 5, method: "tools/list" }, token);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toEqual([]);
  });

  it("refuses a harness token acting on a run other than its own", async () => {
    // D52. Without the binding, one run's harness could finish another run, record an
    // approval against it, or answer its question: every plumbing tool names a run in its
    // arguments and nothing checked that name against the token presenting it.
    const harness = await mintRunToken({
      kind: "harness",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["run_finish", "approval_create", "agent_question_create", "run_start"],
    });
    const someoneElse = "22222222-2222-4222-8222-222222222222";

    for (const [name, args] of [
      ["run_finish", { run_id: someoneElse, status: "Succeeded" }],
      ["approval_create", { run_id: someoneElse, tool_name: "agent_trust_edit", call_id: "c1" }],
      ["agent_question_create", { run_id: someoneElse, question: "well?" }],
      ["run_start", { run_id: someoneElse, parent_run_id: someoneElse, agent_code: "pa" }],
    ] as const) {
      const body = (await (
        await post({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name, arguments: args } }, harness)
      ).json()) as { error?: { message: string } };
      expect(body.error?.message, name).toMatch(/run_binding: /);
    }
  });

  it("lets a harness token start a run delegated from its own", async () => {
    // The other half of D52: `run_start` registers a *new* run, so its `run_id` is not the
    // caller's by design. What has to be the caller's is the run delegating it. This gets
    // past the binding and fails later, in the database, which is what proves the binding
    // is not what stopped it.
    const harness = await mintRunToken({
      kind: "harness",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["run_start"],
    });
    const body = (await (
      await post(
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: {
            name: "run_start",
            arguments: { run_id: "33333333-3333-4333-8333-333333333333", parent_run_id: RUN, agent_code: "pa" },
          },
        },
        harness,
      )
    ).json()) as { error?: { message: string } };
    expect(body.error?.message ?? "").not.toMatch(/run_binding/);
  });

  it("lets no legacy token reach a tool or its own plumbing, so in-flight runs are drained", async () => {
    // D51. A token minted before the `tools` and `runId` claims existed carries neither,
    // and both read as "nothing" rather than "everything". An in-flight run at deploy can
    // therefore neither call a tool nor finish itself, which is why the runs are drained
    // first rather than the old tokens exempted.
    const legacy = await signLegacyToken({
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
    });
    const claims = await verifyRunToken(legacy);
    expect(claims).toMatchObject({ kind: "model", runId: "", tools: [] });

    const listed = (await (await post({ jsonrpc: "2.0", id: 22, method: "tools/list" }, legacy)).json()) as {
      result: { tools: unknown[] };
    };
    expect(listed.result.tools).toEqual([]);

    const tool = (await (
      await post(
        { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "work_item_search", arguments: {} } },
        legacy,
      )
    ).json()) as { error?: { message: string } };
    expect(tool.error?.message).toMatch(/agent_grant: /);

    const plumbing = (await (
      await post(
        {
          jsonrpc: "2.0",
          id: 24,
          method: "tools/call",
          params: { name: "run_finish", arguments: { run_id: RUN, status: "Succeeded" } },
        },
        legacy,
      )
    ).json()) as { error?: { message: string } };
    expect(plumbing.error?.message).toMatch(/agent_grant: /);
  });

  it("refuses a granted T2 call that shows no approval, and says what to bind one to", async () => {
    // D49. The harness pauses on a T2 call before making it, but a pause the harness
    // chooses to take is a convention, not a control. This is the server refusing: a
    // granted, well-formed, permitted call, turned down for want of an approval, before
    // the tool's own service runs and so before anything is written.
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["agent_trust_edit"],
    });
    const body = (await (
      await post(
        {
          jsonrpc: "2.0",
          id: 25,
          method: "tools/call",
          params: { name: "agent_trust_edit", arguments: { code: "exp", trust: "Standard", version: 1 } },
        },
        token,
      )
    ).json()) as { error?: { message: string; data?: Record<string, unknown> } };

    expect(body.error?.message).toMatch(/approval_required/);
    // The descriptor, so the harness can create the right approval and retry the same
    // call rather than guessing what it is asking a person to agree to.
    const { argumentsHash } = await import("@/lib/approval-binding");
    expect(body.error?.data).toMatchObject({
      reasonCode: "approval_required",
      tool: "agent_trust_edit",
      argumentsHash: argumentsHash({ code: "exp", trust: "Standard", version: 1 }),
    });
  });

  it("escalates a T1 edit to an approval because of the field it touches", async () => {
    // D58. `request_type_step_edit` is T1 to rename a step and a decision when it makes
    // one terminal, because a terminal step loses every audience and outgoing rule it has.
    // The tool declares the base tier; the server reads the payload and escalates, so the
    // tier is not something the agent could choose by phrasing the call differently.
    const token = await mintRunToken({
      kind: "model",
      runId: RUN,
      agentId: "00000000-0000-4000-8000-00000000a9e7",
      personId: "00000000-0000-4000-8000-00000000be55",
      routes: [],
      connectors: [],
      tools: ["request_type_step_edit"],
    });
    const edit = { code: "RT-1", stepName: "Check", expectedVersion: 3 };

    // Renaming is not escalated: it reaches the service, which refuses it on the person's
    // own permissions instead. Whatever the answer, it is not approval_required.
    const rename = (await (
      await post(
        {
          jsonrpc: "2.0",
          id: 26,
          method: "tools/call",
          params: { name: "request_type_step_edit", arguments: { ...edit, nameEn: "Reviewed" } },
        },
        token,
      )
    ).json()) as { error?: { message: string } };
    expect(rename.error?.message ?? "").not.toMatch(/approval_required/);

    const terminal = (await (
      await post(
        {
          jsonrpc: "2.0",
          id: 27,
          method: "tools/call",
          params: { name: "request_type_step_edit", arguments: { ...edit, isTerminal: true } },
        },
        token,
      )
    ).json()) as { error?: { message: string; data?: Record<string, unknown> } };
    expect(terminal.error?.message).toMatch(/approval_required/);
    expect(terminal.error?.data).toMatchObject({
      tool: "request_type_step_edit",
      fields: ["isTerminal"],
      expectedVersion: 3,
    });
  });

  it("hashes a call the same whatever order the model wrote the keys in", async () => {
    // Two orderings of the same arguments are one call. Hashing the raw body would make
    // an approved retry fail to match, which reads as tampering when nothing happened.
    const { argumentsHash, canonicalJson } = await import("@/lib/approval-binding");
    expect(argumentsHash({ a: 1, b: [2, 3] })).toBe(argumentsHash({ b: [2, 3], a: 1 }));
    // An array's order is meaning, not formatting.
    expect(argumentsHash({ b: [3, 2] })).not.toBe(argumentsHash({ b: [2, 3] }));
    // The approval reference is how a retry presents its approval, not part of the call.
    expect(argumentsHash({ a: 1, __approval: "x" })).toBe(argumentsHash({ a: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("says so when the method is not one it serves", async () => {
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools: [] });
    const response = await post({ jsonrpc: "2.0", id: 3, method: "resources/list" }, token);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it("takes no answer for a notification", async () => {
    const token = await mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools: [] });
    const response = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, token);
    expect(response.status).toBe(202);
  });
});

describe("the grant recorded on a run", () => {
  it("narrows a child's grant to the parent's, and never widens it", async () => {
    // D36. Delegation must not be a way to reach further than the run that asked for it,
    // and an agent configured without a tool does not acquire it by being delegated to.
    const { childGrant } = await import("@/features/agents/run-payload");

    expect(childGrant(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"]);
    // The child's configuration alone cannot add to what the parent held.
    expect(childGrant(["a"], ["a", "agent_trust_edit"])).toEqual(["a"]);
    expect(childGrant([], ["a"])).toEqual([]);
    // A parent that recorded no grant at all predates the column. Its reach is unknown,
    // and the safe reading of an unknown grant is the child's own configuration — never
    // everything the parent might have had.
    expect(childGrant(null, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("lets a resumed run's grant shrink but never grow", async () => {
    // D50. A tool revoked while the run was waiting is gone when it resumes, which is the
    // point of revoking it. One granted meanwhile does not apply to work already under way.
    const { resumeGrant } = await import("@/features/agents/run-payload");

    expect(resumeGrant(["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
    // Revoked while it waited.
    expect(resumeGrant(["a", "b"], ["a"])).toEqual(["a"]);
    // Granted while it waited: not retroactive.
    expect(resumeGrant(["a"], ["a", "b"])).toEqual(["a"]);
    expect(resumeGrant(null, ["a"])).toEqual([]);
  });
});

describe("the action tool catalogue", () => {
  it("advertises each tool's real input schema, not an empty object", async () => {
    const { inputSchemaOf } = await import("@/mcp/action-tool");
    const create = TOOLS_BY_NAME.get("request_type_create");
    expect(create).toBeDefined();
    const schema = inputSchemaOf(create!) as { properties?: Record<string, unknown> };
    // A model told only `{}` has to guess field names and learn them from rejections,
    // which is fatal to a bulk mission that must be written correctly the first time.
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["code", "nameEn", "nameAr", "categoryEn"]),
    );
  });

  it("names every tool exactly once across the whole catalogue", () => {
    const names = PLATFORM_TOOLS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers the request type actions a composite mission needs", () => {
    // The merchant-credential-reset mission: a type, the field it asks for, and a publish.
    for (const name of [
      "request_type_create",
      "request_type_attribute_create",
      "request_type_step_create",
      "request_type_audience_create",
      "request_type_publish",
    ]) {
      expect(TOOLS_BY_NAME.has(name), name).toBe(true);
    }
  });
});

import { afterAll } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./db/harness";

/**
 * #29: the partial edit each feature module now offers, against the database.
 *
 * One write path per subject means one place where a patch can go wrong, so each module's
 * edit is checked for the same three things: the cascade is in the diff an approver reads,
 * a sensitive field is refused to an agent that has no approval for it and nothing is
 * written when it is, and two patches written against the same version do not silently
 * lose one of them.
 *
 * The acting identity is always an agent, because `runAs` is how the MCP boundary enters
 * the services and this file has no signed-in person. The fourth argument is what the
 * boundary passes after it has spent a bound approval (D72), so a case that needs a
 * sensitive field to go through names it there rather than going round the rule.
 */
const AGENT = { id: "00000000-0000-4000-8000-00000000a9e7", label: "m8-tests" };

describe.skipIf(!hasDatabase)("the project edit", () => {
  let ownerId = "";
  let projectKey = "";
  let agentCode = "";

  const versionOf = async (key: string) => {
    const row = await testPool().query<{ version: number }>("select version from work.project where key = $1", [key]);
    return row.rows[0].version;
  };

  beforeAll(async () => {
    const { createProject } = await import("@/features/projects/service");
    const { runAs } = await import("@/lib/session");
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const unit = await testPool().query<{ name: string }>("select name_en as name from core.org_unit limit 1");
    const agent = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code limit 1",
    );
    agentCode = agent.rows[0].code;

    projectKey = `M8${Date.now().toString().slice(-5)}`;
    await runAs(ownerId, AGENT, () =>
      createProject({
        key: projectKey,
        nameEn: "A project for the edit cases",
        nameAr: "مشروع لحالات التعديل",
        orgUnit: unit.rows[0].name,
        ownerPersonId: ownerId,
        sensitivity: "Internal",
        status: "Backlog",
        requireReviewerNotAuthor: false,
      }),
    );
  });

  afterAll(async () => {
    const { deleteProject } = await import("@/features/projects/service");
    const { runAs } = await import("@/lib/session");
    await runAs(ownerId, AGENT, () => deleteProject(projectKey));
  });

  it("names the allowed agents and approval rules it drops, so an approval is informed", async () => {
    const { updateProject } = await import("@/features/projects/service");
    const { runAs } = await import("@/lib/session");
    const approved = ["allowedAgents", "approvalRules"];

    await runAs(
      ownerId,
      AGENT,
      async () =>
        updateProject({
          key: projectKey,
          expectedVersion: await versionOf(projectKey),
          allowedAgents: [agentCode],
          approvalRules: [{ ref: "tests.m8", minimumTier: "T2" }],
        }),
      { approvedFields: approved },
    );

    // Each list is replaced whole, so a shorter one drops what it leaves out: an agent
    // that may no longer be given work, and the human gate on an action.
    const diff = await runAs(
      ownerId,
      AGENT,
      async () =>
        updateProject({
          key: projectKey,
          expectedVersion: await versionOf(projectKey),
          allowedAgents: [],
          approvalRules: [],
        }),
      { approvedFields: approved },
    );
    expect(diff.before).toMatchObject({ allowedAgents: [agentCode] });
    expect(diff.cascade.agents).toEqual([agentCode]);
    expect(diff.cascade.approvalRules).toEqual(["tests.m8:T2"]);
  });

  it("refuses a sensitive field to an agent until an approval binds it", async () => {
    const { updateProject } = await import("@/features/projects/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");

    const asAgent = runAs(ownerId, AGENT, async () =>
      updateProject({ key: projectKey, expectedVersion: await versionOf(projectKey), sensitivity: "Confidential" }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    // Refused before anything was written, which is what makes a retry after approval safe.
    const after = await testPool().query<{ sensitivity: string }>(
      "select sensitivity from work.project where key = $1",
      [projectKey],
    );
    expect(after.rows[0].sensitivity).toBe("Internal");
  });

  it("lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { ProjectRejected, updateProject } = await import("@/features/projects/service");
    const { runAs } = await import("@/lib/session");
    const version = await versionOf(projectKey);

    const results = await Promise.allSettled([
      runAs(ownerId, AGENT, () => updateProject({ key: projectKey, expectedVersion: version, nameEn: "First" })),
      runAs(ownerId, AGENT, () => updateProject({ key: projectKey, expectedVersion: version, nameEn: "Second" })),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ProjectRejected);
  });
});

describe.skipIf(!hasDatabase)("the work item edit", () => {
  let ownerId = "";
  let projectKey = "";
  /** Children first, because a parent with a sub item under it refuses the delete. */
  const created: string[] = [];

  const versionOf = async (key: string) => {
    const row = await testPool().query<{ version: number }>("select version from work.work_item where key = $1", [key]);
    return row.rows[0].version;
  };

  const raise = async (titleEn: string) => {
    const { createWorkItem } = await import("@/features/work-items/service");
    const { runAs } = await import("@/lib/session");
    const key = await runAs(ownerId, AGENT, () =>
      createWorkItem({ projectKey, type: "Task", titleEn, titleAr: titleEn, priority: "Medium" }),
    );
    created.unshift(key);
    return key;
  };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    projectKey = project.rows[0].key;
  });

  afterAll(async () => {
    const { deleteWorkItem } = await import("@/features/work-items/service");
    const { runAs } = await import("@/lib/session");
    for (const key of created) await runAs(ownerId, AGENT, () => deleteWorkItem(key));
  });

  it("names the sub items still open when the work is closed", async () => {
    const { addSubItem, updateWorkItem } = await import("@/features/work-items/service");
    const { runAs } = await import("@/lib/session");
    const key = await raise("Work with a sub item");
    created.unshift(await runAs(ownerId, AGENT, () => addSubItem(key, "Still to do")));

    // Cancelling a parent does not cancel what is under it, so the diff says how much is
    // left behind rather than letting an approver assume the whole branch closed.
    const diff = await runAs(
      ownerId,
      AGENT,
      async () => updateWorkItem({ key, expectedVersion: await versionOf(key), status: "Cancelled" }),
      { approvedFields: ["status"] },
    );
    expect(diff.before).toMatchObject({ status: "Backlog" });
    expect(diff.after).toMatchObject({ status: "Cancelled" });
    expect(diff.cascade.openSubItems).toBe(1);
  });

  it("refuses a status change to an agent until an approval binds it", async () => {
    const { updateWorkItem } = await import("@/features/work-items/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    const key = await raise("Work an agent would close");

    const asAgent = runAs(ownerId, AGENT, async () =>
      updateWorkItem({ key, expectedVersion: await versionOf(key), status: "Cancelled" }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    const after = await testPool().query<{ status: string }>("select status from work.work_item where key = $1", [key]);
    expect(after.rows[0].status).toBe("Backlog");
  });

  it("lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { updateWorkItem } = await import("@/features/work-items/service");
    const { StaleWriteError } = await import("@/lib/concurrency");
    const { runAs } = await import("@/lib/session");
    const key = await raise("Work two people edit at once");
    const version = await versionOf(key);

    const results = await Promise.allSettled([
      runAs(ownerId, AGENT, () => updateWorkItem({ key, expectedVersion: version, titleEn: "First" })),
      runAs(ownerId, AGENT, () => updateWorkItem({ key, expectedVersion: version, titleEn: "Second" })),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleWriteError);
  });
});

describe.skipIf(!hasDatabase)("the org unit edit", () => {
  let ownerId = "";
  let parentId = "";
  let childId = "";
  let elsewhereId = "";

  const versionOf = async (id: string) => {
    const row = await testPool().query<{ version: number }>("select version from core.org_unit where id = $1", [id]);
    return row.rows[0].version;
  };

  beforeAll(async () => {
    const { createOrgUnit } = await import("@/features/organisation/service");
    const { runAs } = await import("@/lib/session");
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const elsewhere = await testPool().query<{ id: string }>(
      "select id from core.org_unit where parent_org_unit_id is null order by code limit 1",
    );
    elsewhereId = elsewhere.rows[0].id;

    const stamp = Date.now().toString().slice(-6);
    parentId = await runAs(ownerId, AGENT, () =>
      createOrgUnit({
        code: `M8P${stamp}`,
        nameEn: "A unit for the edit cases",
        nameAr: "وحدة لحالات التعديل",
        parentOrgUnitId: null,
        leadPersonId: null,
      }),
    );
    childId = await runAs(ownerId, AGENT, () =>
      createOrgUnit({
        code: `M8C${stamp}`,
        nameEn: "A unit under it",
        nameAr: "وحدة تابعة لها",
        parentOrgUnitId: parentId,
        leadPersonId: null,
      }),
    );
  });

  afterAll(async () => {
    const { removeOrgUnit } = await import("@/features/organisation/service");
    const { runAs } = await import("@/lib/session");
    const codes = await testPool().query<{ id: string; code: string }>(
      "select id, code from core.org_unit where id = any($1::uuid[])",
      [[childId, parentId]],
    );
    // The child first: a unit that still has one under it refuses the delete.
    for (const id of [childId, parentId]) {
      const row = codes.rows.find((one) => one.id === id);
      if (row) await runAs(ownerId, AGENT, () => removeOrgUnit(row.id, row.code));
    }
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("names what moves with the unit when its parent changes", async () => {
    const { updateOrgUnit } = await import("@/features/organisation/service");
    const { runAs } = await import("@/lib/session");

    const diff = await runAs(
      ownerId,
      AGENT,
      async () =>
        updateOrgUnit({ id: parentId, expectedVersion: await versionOf(parentId), parentOrgUnitId: elsewhereId }),
      { approvedFields: ["parentOrgUnitId"] },
    );
    expect(diff.before).toMatchObject({ parentOrgUnitId: null });
    // The unit under it moves with it, which is the real size of the change.
    expect(diff.cascade.children).toBe(1);
  });

  it("refuses a parent that would put the unit under itself", async () => {
    const { OrgUnitError, updateOrgUnit } = await import("@/features/organisation/service");
    const { runAs } = await import("@/lib/session");

    // The chart is drawn from the root down, so a cycle is not a cosmetic defect: every
    // unit inside it disappears from the organisation rather than appearing in the wrong place.
    const loop = runAs(
      ownerId,
      AGENT,
      async () => updateOrgUnit({ id: parentId, expectedVersion: await versionOf(parentId), parentOrgUnitId: childId }),
      { approvedFields: ["parentOrgUnitId"] },
    );
    await expect(loop).rejects.toBeInstanceOf(OrgUnitError);
  });

  it("refuses a sensitive field to an agent until an approval binds it", async () => {
    const { updateOrgUnit } = await import("@/features/organisation/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");

    const asAgent = runAs(ownerId, AGENT, async () =>
      updateOrgUnit({ id: childId, expectedVersion: await versionOf(childId), parentOrgUnitId: null }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    const after = await testPool().query<{ parent: string | null }>(
      "select parent_org_unit_id as parent from core.org_unit where id = $1",
      [childId],
    );
    expect(after.rows[0].parent).toBe(parentId);
  });

  it("lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { OrgUnitError, updateOrgUnit } = await import("@/features/organisation/service");
    const { runAs } = await import("@/lib/session");
    const version = await versionOf(childId);

    const results = await Promise.allSettled([
      runAs(ownerId, AGENT, () => updateOrgUnit({ id: childId, expectedVersion: version, nameEn: "First" })),
      runAs(ownerId, AGENT, () => updateOrgUnit({ id: childId, expectedVersion: version, nameEn: "Second" })),
    ]);
    expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((one) => one.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrgUnitError);
  });
});

describe("the action tool catalogue on three more modules", () => {
  it("offers each module's subjects under one vocabulary", () => {
    // D61: a model that has learnt request types can write projects, work items and org
    // units without being told the names, which is the whole point of the convention.
    for (const name of [
      "project_list",
      "project_create",
      "project_edit",
      "project_delete",
      "project_member_create",
      "project_member_delete",
      "work_item_edit",
      "work_item_delete",
      "work_item_review_create",
      "work_item_approval_create",
      "work_item_change_request_create",
      "work_item_comment_create",
      "work_item_sub_item_create",
      "org_unit_list",
      "org_unit_create",
      "org_unit_edit",
      "org_unit_delete",
      "person_list",
      // No `person_create`: inviting somebody creates a principal and grants it a role,
      // which decision (e) puts permanently outside the catalogue. `role_list` reads.
      "role_list",
    ]) {
      expect(TOOLS_BY_NAME.has(name), name).toBe(true);
    }
  });

  it("escalates each edit on the fields that need a person, and on nothing else", () => {
    // D58: the tool declares its base tier and the server escalates per payload, so the
    // tier is not something an agent could choose by phrasing the call differently.
    const escalated = (name: string, payload: Record<string, unknown>) =>
      TOOLS_BY_NAME.get(name)?.escalates?.(payload, "00000000-0000-4000-8000-00000000be55") ?? [];

    expect(escalated("project_edit", { key: "P", expectedVersion: 1, nameEn: "x" })).toEqual([]);
    expect(escalated("project_edit", { key: "P", expectedVersion: 1, sensitivity: "Confidential" })).toEqual([
      "sensitivity",
    ]);
    expect(escalated("work_item_edit", { key: "W-1", expectedVersion: 1, titleEn: "x" })).toEqual([]);
    expect(escalated("work_item_edit", { key: "W-1", expectedVersion: 1, status: "Done" })).toEqual(["status"]);
    expect(escalated("org_unit_edit", { id: "u", expectedVersion: 1, nameEn: "x" })).toEqual([]);
    expect(escalated("org_unit_edit", { id: "u", expectedVersion: 1, parentOrgUnitId: null })).toEqual([
      "parentOrgUnitId",
    ]);
  });

  it("takes no unknown field, and no edit that changes nothing", () => {
    // `.strict()` with at least one field: a patch nobody meant is a patch that silently
    // does something else, and an empty one is a write with no change to make.
    const edit = TOOLS_BY_NAME.get("project_edit")?.input;
    if (!edit) throw new Error("project_edit is not registered");
    expect(edit.safeParse({ key: "P", expectedVersion: 1, nameEn: "x" }).success).toBe(true);
    expect(edit.safeParse({ key: "P", expectedVersion: 1, nmeEn: "x" }).success).toBe(false);
    expect(edit.safeParse({ key: "P", expectedVersion: 1 }).success).toBe(false);
  });
});

describe("the action tool catalogue on the remaining modules", () => {
  it("offers each module's subjects under the same vocabulary", () => {
    // D61: the names are a subject and an operation, so a model that has learnt one
    // module can write the next without being told each name.
    for (const name of [
      "knowledge_collection_list",
      "knowledge_collection_get",
      "knowledge_collection_create",
      "knowledge_collection_edit",
      "knowledge_collection_delete",
      "knowledge_source_create",
      "knowledge_source_delete",
      "knowledge_search",
      "skill_list",
      "skill_create",
      "skill_version_create",
      "skill_publish",
      "skill_delete",
      "connector_list",
      "connector_operation_list",
      "channel_list",
      "deployment_list",
      "storyline_problem_list",
      "storyline_simulation_create",
      "artifact_list",
      "file_list",
      "file_create",
      "file_edit",
      "file_delete",
      "attachment_create",
      "memory_list",
      "memory_rollback",
      "memory_delete",
      "integration_client_list",
      "budget_list",
      "budget_create",
      "budget_edit",
    ]) {
      expect(TOOLS_BY_NAME.has(name), name).toBe(true);
    }
  });

  it("escalates each edit on the fields that need a person, and on nothing else", () => {
    // D58: the tool declares its base tier and the server escalates on the payload, so a
    // retune of chunking and a change to who may read the collection are not one tier.
    const escalated = (name: string, payload: Record<string, unknown>) =>
      TOOLS_BY_NAME.get(name)?.escalates?.(payload, "00000000-0000-4000-8000-00000000be55") ?? [];

    expect(
      escalated("knowledge_collection_edit", { collectionId: "c", expectedVersion: 1, syncSchedule: "Daily" }),
    ).toEqual([]);
    expect(
      escalated("knowledge_collection_edit", { collectionId: "c", expectedVersion: 1, visibility: "Public" }),
    ).toEqual(["visibility"]);
    expect(
      escalated("knowledge_collection_edit", {
        collectionId: "c",
        expectedVersion: 1,
        embeddingRoute: "other",
        preprocessing: { ocr: true, arabicNormalisation: true, stripHeadersFooters: true, maskPii: false },
      }),
    ).toEqual(["preprocessing", "embeddingRoute"]);

    expect(escalated("budget_edit", { budgetId: "b", expectedVersion: 1, warnAtPct: 50 })).toEqual([]);
    expect(escalated("budget_edit", { budgetId: "b", expectedVersion: 1, limitAed: 9_000 })).toEqual(["limitAed"]);
    expect(escalated("budget_edit", { budgetId: "b", expectedVersion: 1, effectiveTo: null })).toEqual([
      "effectiveTo",
    ]);
    expect(escalated("budget_edit", { budgetId: "b", expectedVersion: 1, actionAt100: "NotifyOnly" })).toEqual([
      "actionAt100",
    ]);
  });

  it("takes no unknown field, and no edit that changes nothing", () => {
    // `.strict()` with at least one field, on every new partial edit: a misspelt field is
    // a patch that silently does something else, and an empty one has no change to make.
    for (const [name, key] of [
      ["knowledge_collection_edit", { collectionId: "c", expectedVersion: 1 }],
      ["budget_edit", { budgetId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 }],
    ] as const) {
      const edit = TOOLS_BY_NAME.get(name)?.input;
      if (!edit) throw new Error(`${name} is not registered`);
      expect(edit.safeParse({ ...key, nothingLikeThis: 1 }).success, name).toBe(false);
      expect(edit.safeParse(key).success, name).toBe(false);
    }

    const knowledge = TOOLS_BY_NAME.get("knowledge_collection_edit")?.input;
    expect(knowledge?.safeParse({ collectionId: "c", expectedVersion: 1, syncSchedule: "Weekly" }).success).toBe(true);
    const budget = TOOLS_BY_NAME.get("budget_edit")?.input;
    expect(
      budget?.safeParse({ budgetId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1, warnAtPct: 10 })
        .success,
    ).toBe(true);
  });

  it("keeps who may read a file out of the edit an agent can send", () => {
    // Decision (e): the scope of use is not gated behind an approval, it is absent. An
    // agent that could set it could grant itself a file it may not read.
    const edit = TOOLS_BY_NAME.get("file_edit")?.input;
    if (!edit) throw new Error("file_edit is not registered");
    expect(edit.safeParse({ name: "f.pdf", kind: "file", expectedVersion: 1, active: false }).success).toBe(true);
    expect(
      edit.safeParse({ name: "f.pdf", kind: "file", expectedVersion: 1, scopeOfUse: "AllProject" }).success,
    ).toBe(false);
    expect(edit.safeParse({ name: "f.pdf", kind: "file", expectedVersion: 1, grants: ["x"] }).success).toBe(false);
  });

  it("offers no write on the two modules whose writes carry credentials and permissions", () => {
    // Integration clients carry permissions, keys and exposures; channels carry provider
    // credentials. Reads only, on both. Connectors are written without their credential, each
    // widening write decided by somebody other than the requester (D277); deployments and
    // storylines are written, with their exposure escalated (D253).
    const writesOf = (prefixes: string[]) =>
      PLATFORM_TOOLS.filter(
        (entry) => prefixes.some((prefix) => entry.name.startsWith(prefix)) && entry.tier !== "T0",
      ).map((entry) => entry.name);

    expect(writesOf(["integration_client_", "channel_"])).toEqual([]);
  });

  it("names every new tool for a subject and an operation the vocabulary knows", async () => {
    const { OPERATIONS } = await import("@/mcp/action-tool");
    const operations = Object.keys(OPERATIONS);
    const fromThisMilestone = PLATFORM_TOOLS.filter((entry) =>
      /^(knowledge_|skill_|connector_|channel_|deployment_|storyline_|artifact_list|file_|attachment_|memory_(list|create|rollback|delete)|integration_client_|budget_)/.test(
        entry.name,
      ),
    );
    // A guard that found nothing to check has not checked anything.
    expect(fromThisMilestone.length).toBeGreaterThan(20);
    for (const entry of fromThisMilestone) {
      const operation = entry.name.slice(entry.name.lastIndexOf("_") + 1);
      expect(operations, entry.name).toContain(operation);
      expect(entry.description.length, entry.name).toBeGreaterThan(40);
    }
  });
});
