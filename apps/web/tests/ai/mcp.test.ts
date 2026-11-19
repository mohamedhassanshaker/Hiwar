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
      tools: ["skill_list"],
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
      tools: ["skill_list"],
    });
    const response = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, token);
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((one) => one.name)).toEqual(["skill_list"]);
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
      tools: ["skill_list"],
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
      tools: ["skill_list"],
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
      tools: ["skill_list"],
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
        { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "skill_list", arguments: {} } },
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
    const create = TOOLS_BY_NAME.get("knowledge_collection_create");
    expect(create).toBeDefined();
    const schema = inputSchemaOf(create!) as { properties?: Record<string, unknown> };
    // A model told only `{}` has to guess field names and learn them from rejections,
    // which is fatal to a bulk mission that must be written correctly the first time.
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["collectionId", "nameEn", "nameAr", "visibility"]),
    );
  });

  it("names every tool exactly once across the whole catalogue", () => {
    const names = PLATFORM_TOOLS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

});
