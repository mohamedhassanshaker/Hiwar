import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-76 and S-77 against the database.
 *
 * An integration client is the one principal that is not a person, so what is checked here
 * is what a key is worth: when it works, when it stops, and what it may reach while it does.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";
process.env.APP_KEK ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("integration clients", () => {
  let adminId = "";
  let memberId = "";
  const created: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const admin = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'integrations:write' and rp.effect = 'Allow' and p.status = 'Active'
       order by ra.person_id limit 1`,
    );
    adminId = admin.rows[0].id;
    // A Member holds no `integrations:*` permission.
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");
    memberId = member.rows[0].id;
  });

  afterEach(() => {
    signedInAs = "";
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    if (created.length > 0) {
      await testPool().query("delete from gov.integration_client where client_id = any($1)", [created]);
    }
    await closeTestPool();
  });

  /** A client of its own, so one case cannot change what another sees. */
  const makeClient = async (permissions: string[] = ["work_items:read"]) => {
    const { createClient } = await import("@/features/integrations/service");
    const clientCode = `test-client-${Date.now().toString(36)}-${created.length}`;
    await createClient({
      clientId: clientCode,
      nameEn: "A test client",
      nameAr: "عميل اختباري",
      ownerPersonId: adminId,
      permissions,
    });
    created.push(clientCode);
    return clientCode;
  };

  const keyIdOf = async (clientCode: string) => {
    const { rows } = await testPool().query<{ id: string }>(
      `select k.id from gov.client_key k join gov.integration_client c on c.id = k.client_id
       where c.client_id = $1 order by k.created_at desc limit 1`,
      [clientCode],
    );
    return rows[0].id;
  };

  it("UC-77.1-01 the secret is returned once and never stored in readable form", async () => {
    const { authenticateClient, createKey } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient();

    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: 90 });
    expect(secret).toContain(clientCode);

    const { rows } = await testPool().query<{ prefix: string; secret_hash: Buffer }>(
      `select k.prefix, k.secret_hash from gov.client_key k join gov.integration_client c on c.id = k.client_id
       where c.client_id = $1`,
      [clientCode],
    );
    expect(secret.startsWith(rows[0].prefix)).toBe(true);
    expect(rows[0].secret_hash.toString("utf8")).not.toContain(secret);

    const caller = await authenticateClient(secret);
    expect(caller?.clientCode).toBe(clientCode);
  });

  it("UC-77.1-02 a rotated key gives a new secret, and the old one lasts out its grace", async () => {
    const { authenticateClient, createKey, rotateKey } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient();
    const original = await createKey({ clientId: clientCode, name: "production", expiresInDays: 90 });

    const rotated = await rotateKey({ keyId: await keyIdOf(clientCode), graceHours: 24 });
    expect(rotated).not.toBe(original);
    expect(await authenticateClient(rotated)).not.toBeNull();
    // Still inside the grace, so a caller that has not redeployed keeps working.
    expect(await authenticateClient(original)).not.toBeNull();

    // Past the grace, it stops on its own.
    await testPool().query(
      `update gov.client_key set expires_at = now() - interval '1 minute'
       where id in (select k.id from gov.client_key k join gov.integration_client c on c.id = k.client_id
                    where c.client_id = $1 order by k.created_at limit 1)`,
      [clientCode],
    );
    expect(await authenticateClient(original)).toBeNull();
  });

  it("UC-77.1-03 UC-77.1-04 a revoked key stops at once, and an expired one is refused", async () => {
    const { authenticateClient, createKey, revokeKey } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient();
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: 1 });

    await revokeKey(await keyIdOf(clientCode));
    expect(await authenticateClient(secret)).toBeNull();

    const expiring = await createKey({ clientId: clientCode, name: "short", expiresInDays: 1 });
    expect(await authenticateClient(expiring)).not.toBeNull();
    await testPool().query("update gov.client_key set expires_at = now() - interval '1 second' where id = $1", [
      await keyIdOf(clientCode),
    ]);
    expect(await authenticateClient(expiring)).toBeNull();
  });

  it("UC-77.5-01 deactivating the client stops every key it has", async () => {
    const { authenticateClient, createKey, setClientStatus } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient();
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });

    await setClientStatus({ clientCode, status: "Inactive" });
    expect(await authenticateClient(secret)).toBeNull();

    await setClientStatus({ clientCode, status: "Active" });
    expect(await authenticateClient(secret)).not.toBeNull();
  });

  it("UC-77.4-01 UC-77.4-02 a client reaches only what it was exposed and permitted", async () => {
    const { createKey, setMcp, setPermissions } = await import("@/features/integrations/service");
    const { handleMcpRequest } = await import("@/mcp/server");
    signedInAs = adminId;
    const clientCode = await makeClient(["work_items:read"]);
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });

    const call = async (method: string, params?: unknown) =>
      (await (
        await handleMcpRequest(
          new Request("http://platform.test/api/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }),
        )
      ).json()) as { result?: { tools?: { name: string }[] }; error?: { message: string } };

    // `UC-77.2-03`: with MCP off the client reaches nothing, whatever its permissions say.
    expect((await call("tools/call", { name: "work_item_search", arguments: {} })).error?.message).toBe("not permitted");

    await setMcp({ clientCode, enabled: true, authType: "ApiKey", exposedTools: ["work_item_search"] });
    const listed = await call("tools/list");
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(["work_item_search"]);

    // `UC-77.4-02`: a tool outside the exposed set is refused and recorded against the client.
    expect((await call("tools/call", { name: "work_item_create", arguments: {} })).error?.message).toBe("not permitted");
    const denied = await testPool().query<{ outcome: string; actor_label: string }>(
      `select outcome, actor_label from audit.audit_entry
       where actor_type = 'Client' and object_label = 'work_item_create' order by at desc limit 1`,
    );
    expect(denied.rows[0]?.outcome).toBe("Denied");

    // `UC-77.4-01`: taking the permission away stops the call it was allowing.
    await setPermissions({ clientCode, permissions: ["rooms:read"], agentCodes: [] });
    expect((await call("tools/call", { name: "work_item_search", arguments: {} })).error?.message).toBe("not permitted");
  });

  it("UC-77.3-01 UC-77.3-03 an AG-UI call is refused when it is off, from a strange origin, or for another agent", async () => {
    const { createKey, setAgui, setPermissions, startClientRun } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient(["agents:invoke"]);
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });
    const agent = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false limit 1");

    const call = (origin: string | null, agentCode = agent.rows[0].code) =>
      startClientRun({ secret, origin, agentCode, prompt: "Hello" });

    expect(await call("https://partner.example")).toMatchObject({ refusal: "AguiOff" });

    await setAgui({
      clientCode,
      enabled: true,
      allowedEvents: ["TEXT_MESSAGE_CONTENT"],
      allowedOrigins: ["https://partner.example"],
    });
    expect(await call("https://somewhere-else.example")).toMatchObject({ refusal: "OriginNotAllowed" });
    expect(await call(null)).toMatchObject({ refusal: "OriginNotAllowed" });

    // The client has no agent yet, so even an allowed origin reaches nothing.
    expect(await call("https://partner.example")).toMatchObject({ refusal: "AgentNotAllowed" });

    await setPermissions({ clientCode, permissions: ["rooms:read"], agentCodes: [agent.rows[0].code] });
    expect(await call("https://partner.example")).toMatchObject({ refusal: "NotPermitted" });

    const refusals = await testPool().query<{ total: number }>(
      `select count(*)::int as total from audit.audit_entry
       where actor_type = 'Client' and action = 'agui:stream' and outcome = 'Denied'`,
    );
    expect(refusals.rows[0].total).toBeGreaterThan(0);
  });

  it("UC-76.1-03 a client with no permission, or a duplicate id, is refused", async () => {
    const { createClient, setPermissions } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient();

    await expect(
      createClient({ clientId: clientCode, nameEn: "The same id", nameAr: "نفس المعرّف", ownerPersonId: adminId, permissions: ["rooms:read"] }),
    ).rejects.toThrow();
    await expect(setPermissions({ clientCode, permissions: [], agentCodes: [] })).rejects.toThrow(/at least one/);
  });

  it("S-76 lists every client with the catalogue's tools and permissions", async () => {
    const { loadIntegrations } = await import("@/features/integrations/service");
    const { PLATFORM_TOOLS } = await import("@/mcp/tools");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = adminId;
    const clientCode = await makeClient();

    const stored = await testPool().query<{ client_id: string }>("select client_id from gov.integration_client");
    const loaded = await loadIntegrations();

    expect(loaded.clients.map((client) => client.id).sort()).toEqual(stored.rows.map((row) => row.client_id).sort());
    expect(Object.keys(loaded.details)).toContain(clientCode);
    expect(loaded.tools.map((tool) => tool.code)).toEqual(PLATFORM_TOOLS.map((tool) => tool.name));
    // The permissions offered are the ones the catalogue's tools check, plus running agents.
    const codes = loaded.permissions.map((permission) => permission.code);
    expect(codes).toContain("agents:invoke");
    for (const tool of PLATFORM_TOOLS) expect(codes).toContain(tool.permission);
    expect(new Set(codes).size).toBe(codes.length);
    expect(loaded.base.endsWith("/")).toBe(false);

    signedInAs = memberId;
    await expect(loadIntegrations()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("deleting a client removes it with its keys", async () => {
    const { authenticateClient, createKey, deleteClient } = await import("@/features/integrations/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = adminId;
    const clientCode = await makeClient();
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });
    const keyId = await keyIdOf(clientCode);

    // A Member may not, and the client is untouched.
    signedInAs = memberId;
    await expect(deleteClient(clientCode)).rejects.toBeInstanceOf(NotPermitted);
    expect(await authenticateClient(secret)).not.toBeNull();

    signedInAs = adminId;
    await deleteClient(clientCode);
    const client = await testPool().query("select 1 from gov.integration_client where client_id = $1", [clientCode]);
    expect(client.rowCount).toBe(0);
    const key = await testPool().query("select 1 from gov.client_key where id = $1", [keyId]);
    expect(key.rowCount).toBe(0);
    expect(await authenticateClient(secret)).toBeNull();
  });

  it("UC-77.2-02 testing the MCP connection reports the handshake and records it", async () => {
    const { createKey, setMcp, testMcpConnection } = await import("@/features/integrations/service");
    const { handleMcpRequest, MCP_PROTOCOL_VERSION } = await import("@/mcp/server");
    signedInAs = adminId;
    const clientCode = await makeClient(["work_items:read"]);
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });
    await setMcp({ clientCode, enabled: true, authType: "ApiKey", exposedTools: ["work_item_search"] });

    const lastResult = async () =>
      (
        await testPool().query<{ last_test_result: string }>(
          `select e.last_test_result from gov.client_mcp_exposure e
           join gov.integration_client c on c.id = e.client_id where c.client_id = $1`,
          [clientCode],
        )
      ).rows[0].last_test_result;

    // The platform's own endpoint is the network boundary: the stub hands the request to it.
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      urls.push(String(url));
      return handleMcpRequest(new Request(url, init));
    }) as unknown as typeof fetch;

    const ok = await testMcpConnection(clientCode, secret);
    expect(urls[0].endsWith("/api/mcp")).toBe(true);
    expect(ok).toBe(`Handshake OK · protocol ${MCP_PROTOCOL_VERSION} · 1 tools listed`);
    expect(await lastResult()).toBe(ok);

    const refused = await testMcpConnection(clientCode, "not-a-key");
    expect(refused.startsWith("Refused: ")).toBe(true);
    expect(await lastResult()).toBe(refused);

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    const unreachable = await testMcpConnection(clientCode, secret);
    expect(unreachable).toBe("No answer: connect ECONNREFUSED");
    expect(await lastResult()).toBe(unreachable);
  });

  it("UC-77.2-02 a Member may not test a connection, and nothing is recorded", async () => {
    const { createKey, setMcp, testMcpConnection } = await import("@/features/integrations/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = adminId;
    const clientCode = await makeClient();
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });
    await setMcp({ clientCode, enabled: true, authType: "ApiKey", exposedTools: [] });

    globalThis.fetch = (async () => {
      throw new Error("a refused caller must not reach the endpoint");
    }) as typeof fetch;
    signedInAs = memberId;
    await expect(testMcpConnection(clientCode, secret)).rejects.toBeInstanceOf(NotPermitted);
    const recorded = await testPool().query<{ last_test_result: string | null }>(
      `select e.last_test_result from gov.client_mcp_exposure e
       join gov.integration_client c on c.id = e.client_id where c.client_id = $1`,
      [clientCode],
    );
    expect(recorded.rows[0].last_test_result).toBeNull();
  });

  it("UC-77.3-02 a client's stream carries only the events it was allowed", async () => {
    const { clientStreamEvents, createKey, setAgui, startClientRun } = await import("@/features/integrations/service");
    signedInAs = adminId;
    const clientCode = await makeClient(["agents:invoke"]);
    const secret = await createKey({ clientId: clientCode, name: "production", expiresInDays: null });

    await setAgui({
      clientCode,
      enabled: true,
      allowedEvents: ["TEXT_MESSAGE_CONTENT", "RUN_FINISHED"],
      allowedOrigins: ["https://partner.example"],
    });
    expect((await clientStreamEvents(secret)).sort()).toEqual(["RUN_FINISHED", "TEXT_MESSAGE_CONTENT"]);

    // An unknown key carries nothing and starts nothing.
    expect(await clientStreamEvents("not-a-key")).toEqual([]);
    expect(
      await startClientRun({ secret: "not-a-key", origin: "https://partner.example", agentCode: "pa", prompt: "Hello" }),
    ).toMatchObject({ refusal: "NoCredential" });
  });
});
