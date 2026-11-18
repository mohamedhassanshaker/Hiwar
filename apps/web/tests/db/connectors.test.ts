import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-54 Connectors: what an agent is allowed to reach, and what happens when the server
 * behind a connector changes underneath it.
 *
 * A connector is the platform's door to something outside it, so the decisions here are
 * about blast radius: which tier a tool starts at, which agents may call it at all, and
 * what a tool list that quietly changed does to tiers somebody already set.
 */

// The handshake goes through the connector runtime, which has to have an address.
process.env.CONNECTOR_RUNTIME_URL ??= "http://connector-runtime.test";
// A connector credential is stored encrypted, which needs the key-encryption key.
process.env.APP_KEK ??= Buffer.alloc(32, 7).toString("base64");

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

describe.skipIf(!hasDatabase)("connectors", () => {
  let ownerId = "";
  let memberId = "";
  let connectorCode = "";
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
    const connector = await testPool().query<{ code: string }>(
      "select code from ai.connector order by code limit 1",
    );
    connectorCode = connector.rows[0].code;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-54.1-07 UC-54.1-08 a tool's starting tier follows what the server annotated", async () => {
    const { tierForTool } = await import("@/features/connectors/service");

    // The server itself calls it destructive, so it can never start unattended.
    expect(tierForTool({ destructiveHint: true }, "T1")).toBe("T2");
    // It cannot change anything, so an agent may call it without asking.
    expect(tierForTool({ readOnlyHint: true }, "T1")).toBe("T0");
    // Destructive wins: a tool annotated both ways is the dangerous one.
    expect(tierForTool({ readOnlyHint: true, destructiveHint: true }, "T1")).toBe("T2");
    // A server that said nothing has not said "safe", so the connector's default applies.
    expect(tierForTool({}, "T1")).toBe("T1");
    expect(tierForTool({ readOnlyHint: null, destructiveHint: null }, "T2")).toBe("T2");
  });

  it("UC-54.1-06 refuses an HTTP connector with no server URL", async () => {
    const { testConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    await expect(
      testConnector({ connectorId: "probe", name: "Probe", transport: "http", url: "  " }),
    ).rejects.toBeInstanceOf(ConnectorRejected);

    await expect(
      testConnector({ connectorId: "probe", name: "Probe", transport: "http", url: "not-a-url" }),
    ).rejects.toBeInstanceOf(ConnectorRejected);
  });

  it("a stdio connector with no command is refused, by the test and by the save", async () => {
    const { testConnector, saveConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    await expect(
      testConnector({ connectorId: "probe", name: "Probe", transport: "stdio", command: [] }),
    ).rejects.toBeInstanceOf(ConnectorRejected);

    await expect(
      saveConnector({
        code: "tmp-stdio-blank",
        transport: "Stdio",
        url: "",
        command: "   ",
        authType: "None",
        defaultTier: "T1",
        enabled: false,
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ConnectorRejected);
  });

  it("a stdio connector's command line reaches the runtime split into its argv", async () => {
    const { saveConnector } = await import("@/features/connectors/service");
    const { runtimeConnectors } = await import("@/features/connectors/repository");
    signedInAs = ownerId;

    const pushed: { connectors: { connector_id: string; command?: string[] }[] }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) {
        return { ok: true, json: async () => ({ tools: [] }) } as unknown as Response;
      }
      pushed.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ connectors: ["tmp-stdio"], failed: {} }) } as unknown as Response;
    }) as typeof fetch;

    await saveConnector({
      code: "tmp-stdio",
      transport: "Stdio",
      url: "",
      command: "npx -y @modelcontextprotocol/server-foo",
      authType: "None",
      defaultTier: "T1",
      enabled: true,
      tools: [],
    });

    const sent = pushed[0]?.connectors.find((connector) => connector.connector_id === "tmp-stdio");
    expect(sent?.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-foo"]);

    // What the runtime would be handed on the next save of anything else agrees with what
    // was just stored — the split happens once, read back the same way it went in.
    const stored = await runtimeConnectors();
    expect(stored.find(({ connector }) => connector.connector_id === "tmp-stdio")?.connector.command).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-foo",
    ]);

    await testPool().query("delete from ai.connector where code = 'tmp-stdio'");
  });

  it("D372 a stored stdio connector with no command is held back, so the runtime takes the rest", async () => {
    const { runtimeConnectors } = await import("@/features/connectors/repository");
    // Only a seed ever stored one: the runtime refuses the whole set for it (422), which left
    // every connector unreachable in QA run 20261030_1.
    const before = (
      await testPool().query<{ is_enabled: boolean; command: string | null }>(
        "select is_enabled, command from ai.connector where code = 'sandbox-fs'",
      )
    ).rows[0];
    await testPool().query("update ai.connector set is_enabled = true, command = null where code = 'sandbox-fs'");
    try {
      const codes = (await runtimeConnectors()).map(({ connector }) => connector.connector_id);
      expect(codes).not.toContain("sandbox-fs");
      // D374: `erp` and `knowledge` are seeded Disabled; `m365` is an enabled one.
      expect(codes).toContain("m365");
    } finally {
      await testPool().query("update ai.connector set is_enabled = $1, command = $2 where code = 'sandbox-fs'", [
        before.is_enabled,
        before.command,
      ]);
    }
  });

  it("D296 the runtime is sent each HTTP connector's credential as headers, and told when one is missing", async () => {
    const { pushToRuntime } = await import("@/features/connectors/discovery-service");
    const { encrypt } = await import("@/lib/crypto");
    await testPool().query(
      `insert into ai.connector (id, code, name_en, name_ar, transport, server_url, auth_type, secret_ref, is_enabled) values
         (gen_random_uuid(), 'tmp-bearer', 'Temp', 'مؤقت', 'StreamableHttp', 'https://x.example/mcp', 'Bearer', $1, true),
         (gen_random_uuid(), 'tmp-key', 'Temp', 'مؤقت', 'StreamableHttp', 'https://y.example/mcp', 'ApiKey', $2, true),
         (gen_random_uuid(), 'tmp-oauth', 'Temp', 'مؤقت', 'StreamableHttp', 'https://z.example/mcp', 'OAuth', null, true)`,
      [
        encrypt(JSON.stringify({ type: "Bearer", token: "b-token" })),
        encrypt(JSON.stringify({ type: "ApiKey", in: "query", name: "key", value: "k-value" })),
      ],
    );
    const pushed: { connectors: Record<string, unknown>[] }[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      pushed.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    try {
      await pushToRuntime();
      const sent = (code: string) => pushed[0].connectors.find((connector) => connector.connector_id === code);
      expect(sent("tmp-bearer")).toMatchObject({ headers: { authorization: "Bearer b-token" }, needs_credential: true });
      // A query key is sent beside the URL, never in it, so the runtime's saved state cannot hold it.
      expect(sent("tmp-key")).toMatchObject({ url: "https://y.example/mcp", query: { key: "k-value" } });
      expect(sent("tmp-oauth")).toMatchObject({ needs_credential: true });
      expect(sent("tmp-oauth")?.headers).toBeUndefined();
    } finally {
      await testPool().query("delete from ai.connector where code in ('tmp-bearer', 'tmp-key', 'tmp-oauth')");
    }
  });

  it("UC-54.1-02 a handshake lists the tools the server offers", async () => {
    const { testConnector } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/tools")) {
        return {
          ok: true,
          json: async () => ({ tools: [{ name: "claims.read", description: "Read a claim" }] }),
        } as unknown as Response;
      }
      // The PUT: the runtime answers with what it accepted and what it could not start.
      return { ok: true, json: async () => ({ connectors: ["probe"], failed: {} }) } as unknown as Response;
    }) as typeof fetch;

    const { tools } = await testConnector({
      connectorId: "probe",
      name: "Probe",
      transport: "http",
      url: "https://mcp.example.com",
    });
    // Unannotated, so it is listed at the connector's default tier rather than at T0.
    expect(tools).toEqual([{ name: "claims.read", description: "Read a claim", tier: "T1" }]);
  });

  it("UC-54.1-05 a failed handshake comes back as the error, not as a silent success", async () => {
    const { testConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    // The screen then offers to add it Disabled: a connector that could not be reached is
    // a configuration someone still wants to keep.
    await expect(
      testConnector({ connectorId: "probe", name: "Probe", transport: "http", url: "https://mcp.example.com" }),
    ).rejects.toBeInstanceOf(ConnectorRejected);
  });

  it("UC-54.2-06 a tool that arrived is unavailable until an admin looks at it", async () => {
    const { refreshConnectorTools } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ name: string; tier: string }>(
      `select ct.name, ct.tier from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = $1 order by ct.name`,
      [connectorCode],
    );

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          tools: [
            ...before.rows.map((tool) => ({ name: tool.name, description: "" })),
            { name: "brand.new.tool", description: "Arrived since registration" },
          ],
        }),
      }) as unknown as Response) as typeof fetch;

    const { added, removed } = await refreshConnectorTools(connectorCode);
    expect(added).toContain("brand.new.tool");
    expect(removed).toEqual([]);

    const arrived = await testPool().query<{ is_available: boolean; tier: string }>(
      `select ct.is_available, ct.tier from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = $1 and ct.name = $2`,
      [connectorCode, "brand.new.tool"],
    );
    // Nobody assigned this one a tier, so no agent calls it yet.
    expect(arrived.rows[0].is_available).toBe(false);

    // The tiers an admin already set are untouched: that decision was about the tool, not
    // about this handshake.
    const after = await testPool().query<{ name: string; tier: string }>(
      `select ct.name, ct.tier from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id
       where c.code = $1 and ct.name <> 'brand.new.tool' order by ct.name`,
      [connectorCode],
    );
    expect(after.rows).toEqual(before.rows);

    await testPool().query(
      `delete from ai.connector_tool where name = 'brand.new.tool' and connector_id in
       (select id from ai.connector where code = $1)`,
      [connectorCode],
    );
  });

  it("UC-54.2-06 a tool that disappeared is marked unavailable, not deleted", async () => {
    const { refreshConnectorTools } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    const tools = await testPool().query<{ name: string; is_available: boolean }>(
      `select ct.name, ct.is_available from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = $1 order by ct.name`,
      [connectorCode],
    );
    if (tools.rowCount === 0) return;
    const vanishing = tools.rows[0].name;

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          tools: tools.rows.slice(1).map((tool) => ({ name: tool.name, description: "" })),
        }),
      }) as unknown as Response) as typeof fetch;

    const { removed } = await refreshConnectorTools(connectorCode);
    expect(removed).toContain(vanishing);

    // An agent is configured against it; the admin should see what happened rather than
    // find the row missing.
    const still = await testPool().query<{ is_available: boolean }>(
      `select ct.is_available from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = $1 and ct.name = $2`,
      [connectorCode, vanishing],
    );
    expect(still.rowCount).toBe(1);
    expect(still.rows[0].is_available).toBe(false);

    await testPool().query(
      `update ai.connector_tool set is_available = $1 where name = $2 and connector_id in
       (select id from ai.connector where code = $3)`,
      [tools.rows[0].is_available, vanishing, connectorCode],
    );
  });

  it("UC-54.2-07 a connector that does not answer is shown in Error", async () => {
    const { refreshConnectorTools, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ status: string }>(
      "select status from ai.connector where code = $1",
      [connectorCode],
    );

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    await expect(refreshConnectorTools(connectorCode)).rejects.toBeInstanceOf(ConnectorRejected);

    const after = await testPool().query<{ status: string }>(
      "select status from ai.connector where code = $1",
      [connectorCode],
    );
    expect(after.rows[0].status).toBe("Error");

    await testPool().query("update ai.connector set status = $1 where code = $2", [
      before.rows[0].status,
      connectorCode,
    ]);
  });

  it("D227 a tool granted to an agent reaches its run with no per-connector agent list", async () => {
    const { enabledConnectorCodes, runPayloadFor } = await import("@/features/agents/repository");
    signedInAs = ownerId;

    await testPool().query(
      `insert into ai.connector (id, code, name_en, name_ar, transport, server_url, auth_type, is_enabled, status)
       values (gen_random_uuid(), 'tmp-granted', 'Temp', 'مؤقت', 'StreamableHttp', 'https://x.example', 'None', true, 'Connected')`,
    );
    await testPool().query(
      `insert into ai.connector_tool (connector_id, name, title_en, title_ar, tier)
       values ((select id from ai.connector where code = 'tmp-granted'), 'quotes', 'quotes', 'quotes', 'T0')`,
    );
    const version = await testPool().query<{ id: string }>(
      "select active_version_id as id from ai.agent where is_system = false and active_version_id is not null order by code limit 1",
    );
    await testPool().query(
      `insert into ai.agent_tool_mode (agent_version_id, connector_tool_id, mode)
       values ($1, (select ct.id from ai.connector_tool ct join ai.connector c on c.id = ct.connector_id
                    where c.code = 'tmp-granted' and ct.name = 'quotes'), 'Auto')`,
      [version.rows[0].id],
    );

    // The agent is on no list of the connector's: the grant on its version is what reaches the run.
    const payload = await runPayloadFor(version.rows[0].id, await enabledConnectorCodes());
    expect(payload.tools.map((tool) => tool.name)).toContain("tmp-granted/quotes");
    
    await testPool().query("delete from ai.connector where code = 'tmp-granted'");
  });

  it("UC-54.2-05 removing a connector names the agents it leaves without tools", async () => {
    const { removeConnector } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    // Against a connector made for this case, so the seeded ones stay as they are.
    await testPool().query(
      `insert into ai.connector (id, code, name_en, name_ar, transport, server_url, auth_type)
       values (gen_random_uuid(), 'tmp-remove-me', 'Temp', 'مؤقت', 'StreamableHttp', 'https://x.example', 'None')`,
    );
    const { affectedAgents } = await removeConnector("tmp-remove-me");
    expect(Array.isArray(affectedAgents)).toBe(true);

    const gone = await testPool().query("select 1 from ai.connector where code = 'tmp-remove-me'");
    expect(gone.rowCount).toBe(0);
  });

  it("UC-54.1-03 UC-54.1-06 adds a connector with its tools and tiers", async () => {
    const { saveConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    // `UC-54.1-06`: an HTTP connector with no URL is refused before anything is written.
    await expect(
      saveConnector({
        code: "tmp-added",
        transport: "StreamableHttp",
        command: "",
        url: "",
        authType: "None",
        defaultTier: "T1",
        enabled: false,
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ConnectorRejected);

    await saveConnector({
      code: "tmp-added",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "ApiKey",
      credential: { type: "ApiKey", in: "header", name: "X-API-Key", value: "a-key-nobody-reads-back" },
      defaultTier: "T1",
      // Disabled, so the server does not have to be reachable to store the configuration.
      enabled: false,
      tools: [
        { name: "claims.read", tier: "T0", description: "Read a claim" },
        { name: "claims.close", tier: "T2", description: "Close a claim" },
      ],
    });

    const stored = await testPool().query<{ status: string; is_enabled: boolean; secret_ref: Buffer | null }>(
      "select status, is_enabled, secret_ref from ai.connector where code = 'tmp-added'",
    );
    expect(stored.rows[0].is_enabled).toBe(false);
    expect(stored.rows[0].status).toBe("Disabled");
    // Specification section 9: the credential is stored as ciphertext, never as text.
    expect(stored.rows[0].secret_ref).not.toBeNull();
    expect(stored.rows[0].secret_ref?.toString("utf8")).not.toContain("a-key-nobody-reads-back");

    const tools = await testPool().query<{ name: string; tier: string }>(
      `select ct.name, ct.tier from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = 'tmp-added' order by ct.name`,
    );
    expect(tools.rows).toEqual([
      { name: "claims.close", tier: "T2" },
      { name: "claims.read", tier: "T0" },
    ]);

    // A second connector cannot take the same code: it is how an agent names the tool.
    await expect(
      saveConnector({
        code: "tmp-added",
        transport: "StreamableHttp",
        command: "",
        url: "https://mcp.example.com",
        authType: "None",
        defaultTier: "T1",
        enabled: false,
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ConnectorRejected);

    await testPool().query("delete from ai.connector where code = 'tmp-added'");
  });

  it("D224 a connector keeps the name a person gives it, in both languages, and an edit renames it", async () => {
    const { saveConnector } = await import("@/features/connectors/service");
    const { listConnectors } = await import("@/features/connectors/repository");
    signedInAs = ownerId;
    const base = {
      code: "tmp-named",
      transport: "StreamableHttp" as const,
      command: "",
      url: "https://mcp.example.com",
      authType: "None" as const,
      defaultTier: "T1" as const,
      enabled: false,
      tools: [],
    };
    try {
      await saveConnector({ ...base, nameEn: "Revenue cubes", nameAr: "مكعبات الإيرادات" });
      let saved = (await listConnectors()).find((connector) => connector.n === "tmp-named");
      expect(saved).toMatchObject({ name: "Revenue cubes", nameAr: "مكعبات الإيرادات" });

      await saveConnector({ ...base, nameEn: "SSAS", nameAr: "", version: saved?.version });
      saved = (await listConnectors()).find((connector) => connector.n === "tmp-named");
      // A blank Arabic name reads as the English one rather than as nothing.
      expect(saved).toMatchObject({ name: "SSAS", nameAr: "SSAS" });
    } finally {
      await testPool().query("delete from ai.connector where code = 'tmp-named'");
    }
  });

  it("UC-54.1-05 a connector whose handshake fails can be added only as Disabled", async () => {
    const { saveConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    // The drawer may claim the test passed; the server shakes hands itself before it
    // stores an enabled connector, so a form cannot enable a server that is down.
    await expect(
      saveConnector({
        code: "tmp-unreachable",
        transport: "StreamableHttp",
        command: "",
        url: "https://mcp.example.com",
        authType: "None",
        defaultTier: "T1",
        enabled: true,
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ConnectorRejected);

    const nothing = await testPool().query("select 1 from ai.connector where code = 'tmp-unreachable'");
    expect(nothing.rowCount).toBe(0);

    await saveConnector({
      code: "tmp-unreachable",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
      tools: [],
    });
    const stored = await testPool().query<{ is_enabled: boolean }>(
      "select is_enabled from ai.connector where code = 'tmp-unreachable'",
    );
    expect(stored.rows[0].is_enabled).toBe(false);

    await testPool().query("delete from ai.connector where code = 'tmp-unreachable'");
  });

  it("UC-54.2-03 raising a tool to T2 stops any agent calling it unattended", async () => {
    const { saveConnector } = await import("@/features/connectors/service");
    const { setToolMode, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await saveConnector({
      code: "tmp-tiers",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
      tools: [{ name: "claims.close", tier: "T1", description: "" }],
    });
    const tool = await testPool().query<{ id: string }>(
      `select ct.id from ai.connector_tool ct
       join ai.connector c on c.id = ct.connector_id where c.code = 'tmp-tiers'`,
    );
    const agent = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code limit 1",
    );

    // At T1 an agent may call it without asking.
    await setToolMode({ code: agent.rows[0].code, connectorToolId: tool.rows[0].id, mode: "Auto" });

    const version = await testPool().query<{ version: number }>(
      "select version from ai.connector where code = 'tmp-tiers'",
    );
    await saveConnector({
      code: "tmp-tiers",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
      tools: [{ name: "claims.close", tier: "T2", description: "" }],
      version: version.rows[0].version,
    });

    // At T2 the same mode is refused: the connector's tier is a ceiling on every agent.
    await expect(
      setToolMode({ code: agent.rows[0].code, connectorToolId: tool.rows[0].id, mode: "Auto" }),
    ).rejects.toBeInstanceOf(AgentRejected);

    await testPool().query("delete from ai.connector where code = 'tmp-tiers'");
  });

  it("COM-10 a connector edit against a stale version is refused, not merged", async () => {
    const { saveConnector } = await import("@/features/connectors/service");
    const { StaleWriteError } = await import("@/lib/concurrency");
    signedInAs = ownerId;

    await saveConnector({
      code: "tmp-stale",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
      tools: [],
    });
    const first = await testPool().query<{ version: number }>(
      "select version from ai.connector where code = 'tmp-stale'",
    );
    const edit = {
      code: "tmp-stale",
      transport: "StreamableHttp" as const,
      url: "https://mcp.example.com",
      command: "",
      authType: "None" as const,
      defaultTier: "T2" as const,
      enabled: false,
      tools: [],
      version: first.rows[0].version,
    };
    await saveConnector(edit);
    await expect(saveConnector(edit)).rejects.toBeInstanceOf(StaleWriteError);

    await testPool().query("delete from ai.connector where code = 'tmp-stale'");
  });

  it("UC-54.2-02 turning a connector off takes its tools out of every run token", async () => {
    const { setConnectorEnabled, saveConnector } = await import("@/features/connectors/service");
    const { enabledConnectorCodes } = await import("@/features/agents/repository");
    signedInAs = ownerId;

    await saveConnector({
      code: "tmp-disable",
      transport: "StreamableHttp",
      command: "",
      url: "https://mcp.example.com",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
      tools: [{ name: "claims.read", tier: "T0", description: "" }],
    });

    const enable = async (enabled: boolean) => {
      const { rows } = await testPool().query<{ version: number }>(
        "select version from ai.connector where code = 'tmp-disable'",
      );
      await setConnectorEnabled({ code: "tmp-disable", enabled, version: rows[0].version });
    };

    await enable(true);
    expect(await enabledConnectorCodes()).toContain("tmp-disable");

    // A run token that named a disabled connector would be a grant the platform does not
    // honour, so turning it off is what stops the agent calling any of its tools.
    await enable(false);
    expect(await enabledConnectorCodes()).not.toContain("tmp-disable");

    await testPool().query("delete from ai.connector where code = 'tmp-disable'");
  });

  it("UC-54.1-09 registers every operation of an uploaded OpenAPI document as a tool", async () => {
    const { importApiConnector } = await import("@/features/connectors/service");
    signedInAs = ownerId;
    const code = `tmp-api-${Date.now().toString(36)}`;

    const outcome = await importApiConnector({
      code,
      document: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Ledger", version: "1.0" },
        servers: [{ url: "https://ledger.example.com/v1" }],
        paths: {
          "/entries/{id}": { get: { operationId: "readEntry", summary: "Read", responses: {} } },
          "/entries": { post: { operationId: "postEntry", summary: "Post", responses: {} } },
        },
      }),
      serverUrl: "",
      authType: "Bearer",
      credential: { type: "Bearer", token: "a-token-nobody-reads-back" },
      defaultTier: "T1",
      enabled: false,
    });

    expect(outcome.tools).toBe(2);
    expect(outcome.serverUrl).toBe("https://ledger.example.com/v1");

    // A GET reads and nothing else does, so it is the one operation that starts unattended.
    const tiers = await testPool().query<{ name: string; tier: string; has_operation: boolean }>(
      `select t.name, t.tier, t.operation is not null as has_operation
       from ai.connector_tool t join ai.connector c on c.id = t.connector_id
       where c.code = $1 order by t.name`,
      [code],
    );
    expect(tiers.rows).toEqual([
      { name: "postEntry", tier: "T1", has_operation: true },
      { name: "readEntry", tier: "T0", has_operation: true },
    ]);

    // The credential is stored, and stored encrypted: nothing reads it back as text.
    const stored = await testPool().query<{ transport: string; secret: string | null }>(
      "select transport, encode(secret_ref, 'escape') as secret from ai.connector where code = $1",
      [code],
    );
    expect(stored.rows[0].transport).toBe("OpenApi");
    expect(stored.rows[0].secret).not.toContain("a-token-nobody-reads-back");

    await testPool().query("delete from ai.connector where code = $1", [code]);
  });

  it("UC-54.1-02 a REST API connector is tested by reaching it, and Refresh tools leaves its status alone", async () => {
    const { importApiConnector, testApiConnector, refreshConnectorTools, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;
    const code = `tmp-api-${Date.now().toString(36)}`;
    await importApiConnector({
      code,
      document: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Ledger", version: "1.0" },
        servers: [{ url: "https://ledger.example.com/v1" }],
        paths: { "/entries": { get: { operationId: "listEntries", responses: {} } } },
      }),
      serverUrl: "",
      authType: "Bearer",
      credential: { type: "Bearer", token: "a-token" },
      defaultTier: "T1",
      enabled: true,
    });
    const statusOf = async () =>
      (await testPool().query<{ status: string }>("select status from ai.connector where code = $1", [code])).rows[0].status;
    try {
      const sent: { url: string; authorization: string | null }[] = [];
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
        return new Response("{}", { status: 404 });
      }) as typeof fetch;
      // Any HTTP answer is the API reached, with the stored credential, as a run's call would send it.
      expect(await testApiConnector(code)).toEqual({ httpStatus: 404, tools: [{ name: "listEntries", tier: "T0" }] });
      expect(sent).toEqual([{ url: "https://ledger.example.com/v1", authorization: "Bearer a-token" }]);
      expect(await statusOf()).toBe("Connected");

      // No server lists a REST API's tools, so a refresh is refused rather than marking it in Error.
      await expect(refreshConnectorTools(code)).rejects.toBeInstanceOf(ConnectorRejected);
      expect(await statusOf()).toBe("Connected");

      globalThis.fetch = (async () => {
        throw new Error("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND ledger.example.com") });
      }) as typeof fetch;
      await expect(testApiConnector(code)).rejects.toThrow(/ENOTFOUND/);
      expect(await statusOf()).toBe("Error");
    } finally {
      await testPool().query("delete from ai.connector where code = $1", [code]);
    }
  });

  it("D277 an agent registers and edits a REST connector without ever holding its credential", async () => {
    const { importApiConnector, saveConnector, ConnectorRejected } = await import("@/features/connectors/service");
    const { CONNECTOR_TOOLS } = await import("@/features/connectors/tools");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = `tmp-api-${Date.now().toString(36)}`;
    const document = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Ledger", version: "1.0" },
      servers: [{ url: "https://ledger.example.com/v1" }],
      paths: { "/entries": { get: { operationId: "listEntries", responses: {} }, post: { operationId: "postEntry", responses: {} } } },
    });
    const asAgent = <T,>(body: () => Promise<T>) => runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "def" }, body);
    const row = async () =>
      (
        await testPool().query<{ is_enabled: boolean; name_en: string; secret: string | null; tiers: string }>(
          `select c.is_enabled, c.name_en, encode(c.secret_ref, 'hex') as secret,
                  (select string_agg(t.name || '=' || t.tier, ',' order by t.name) from ai.connector_tool t where t.connector_id = c.id) as tiers
           from ai.connector c where c.code = $1`,
          [code],
        )
      ).rows[0];
    try {
      // A person still has to give the credential the authorisation needs.
      const input = { code, document, serverUrl: "", authType: "Bearer" as const, defaultTier: "T1" as const, enabled: true };
      await expect(importApiConnector(input)).rejects.toBeInstanceOf(ConnectorRejected);

      // An agent's import is stored, Disabled, until a person adds it.
      const imported = await asAgent(() => importApiConnector(input));
      expect(imported.awaitsCredential).toBe(true);
      expect(await row()).toMatchObject({ is_enabled: false, secret: null, tiers: "listEntries=T0,postEntry=T1" });

      // A person adds the credential; an agent's rename keeps it, and the tools and their tiers.
      const version = async () => (await testPool().query<{ version: number }>("select version from ai.connector where code = $1", [code])).rows[0].version;
      await saveConnector({
        code, nameEn: "Ledger", nameAr: "Ledger", transport: "OpenApi", url: "https://ledger.example.com/v1", command: "",
        authType: "Bearer", credential: { type: "Bearer", token: "a-token" }, defaultTier: "T1", enabled: false,
        tools: [{ name: "listEntries", tier: "T0", description: "" }, { name: "postEntry", tier: "T1", description: "" }], version: await version(),
      });
      const secret = (await row()).secret;
      expect(secret).not.toBeNull();
      const edit = CONNECTOR_TOOLS.find((entry) => entry.name === "connector_edit")!;
      const latest = await version();
      await asAgent(() => (edit.run as (input: unknown) => Promise<unknown>)({ code, nameEn: "General ledger", expectedVersion: latest }));
      expect(await row()).toEqual({ is_enabled: false, name_en: "General ledger", secret, tiers: "listEntries=T0,postEntry=T1" });
    } finally {
      await testPool().query("delete from ai.connector where code = $1", [code]);
    }
  });

  it("D268 saving a REST connector enabled reaches the API instead of an MCP handshake", async () => {
    const { importApiConnector, saveConnector, ConnectorRejected } = await import("@/features/connectors/service");
    signedInAs = ownerId;
    const code = `tmp-api-${Date.now().toString(36)}`;
    await importApiConnector({
      code,
      document: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Ledger", version: "1.0" },
        servers: [{ url: "https://ledger.example.com/v1" }],
        paths: { "/entries": { get: { operationId: "listEntries", responses: {} } } },
      }),
      serverUrl: "",
      authType: "None",
      defaultTier: "T1",
      enabled: false,
    });
    const save = async () => {
      const { rows } = await testPool().query<{ version: number }>("select version from ai.connector where code = $1", [code]);
      return saveConnector({
        code, nameEn: "Ledger", nameAr: "Ledger", transport: "OpenApi", url: "https://ledger.example.com/v1", command: "",
        authType: "None", defaultTier: "T1", enabled: true, tools: [{ name: "listEntries", tier: "T0", description: "" }], version: rows[0].version,
      });
    };
    try {
      const reached: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        reached.push(String(url));
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      await save();
      expect(reached).toEqual(["https://ledger.example.com/v1"]);

      globalThis.fetch = (async () => {
        throw new Error("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND ledger.example.com") });
      }) as typeof fetch;
      await expect(save()).rejects.toBeInstanceOf(ConnectorRejected);
    } finally {
      await testPool().query("delete from ai.connector where code = $1", [code]);
    }
  });

  it("UC-54.2-08 refuses every connector change to someone who may not make one", async () => {
    const { removeConnector, refreshConnectorTools } = await import("@/features/connectors/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    await expect(removeConnector(connectorCode)).rejects.toBeInstanceOf(NotPermitted);
    await expect(refreshConnectorTools(connectorCode)).rejects.toBeInstanceOf(NotPermitted);
  });

  it("S-54 lists every stored connector and the catalogue entries not yet installed", async () => {
    const { loadConnectors } = await import("@/features/connectors/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;

    const stored = await testPool().query<{ code: string }>("select code from ai.connector order by code");
    const browsable = await testPool().query<{ id: string }>(
      `select e.id from ai.connector_catalog_entry e
       where not exists (select 1 from ai.connector c where c.catalog_entry_id = e.id)`,
    );

    const { connectors, catalogue } = await loadConnectors();
    expect(connectors.map((connector) => connector.n)).toEqual(stored.rows.map((row) => row.code));
    expect(catalogue.map((entry) => entry.id).sort()).toEqual(browsable.rows.map((row) => row.id).sort());

    // A Member holds no connectors:read, so even the list is refused.
    signedInAs = memberId;
    await expect(loadConnectors()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-54.2-03 an admin sets one tool's tier, and a Member may not", async () => {
    const { setToolTier } = await import("@/features/connectors/service");
    const { NotPermitted } = await import("@/lib/session");
    const before = await testPool().query<{
      id: string;
      name: string;
      tier: "T0" | "T1" | "T2" | "T3";
      updated_at: Date;
      updated_by: string | null;
    }>(
      `select t.id, t.name, t.tier, t.updated_at, t.updated_by
       from ai.connector_tool t join ai.connector c on c.id = t.connector_id
       where c.code = $1 order by t.name limit 1`,
      [connectorCode],
    );
    const tool = before.rows[0];
    const raised = tool.tier === "T2" ? "T1" : "T2";
    const tierNow = async () =>
      (await testPool().query<{ tier: string }>("select tier from ai.connector_tool where id = $1", [tool.id])).rows[0].tier;

    try {
      signedInAs = ownerId;
      await setToolTier({ connectorCode, toolName: tool.name, tier: raised });
      expect(await tierNow()).toBe(raised);

      signedInAs = memberId;
      await expect(setToolTier({ connectorCode, toolName: tool.name, tier: tool.tier })).rejects.toBeInstanceOf(
        NotPermitted,
      );
      expect(await tierNow()).toBe(raised);
    } finally {
      await testPool().query("update ai.connector_tool set tier = $2, updated_at = $3, updated_by = $4 where id = $1", [
        tool.id,
        tool.tier,
        tool.updated_at,
        tool.updated_by,
      ]);
    }
  });

  it("UC-54.1-09 lists the operations an API connector registered, to a reader only", async () => {
    const { importApiConnector, apiOperations } = await import("@/features/connectors/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = `tmp-ops-${Date.now().toString(36)}`;

    try {
      await importApiConnector({
        code,
        document: JSON.stringify({
          openapi: "3.0.3",
          info: { title: "Ledger", version: "1.0" },
          servers: [{ url: "https://ledger.example.com/v1" }],
          paths: {
            "/entries/{id}": { get: { operationId: "readEntry", summary: "Read", responses: {} } },
            "/entries": { post: { operationId: "postEntry", summary: "Post", responses: {} } },
          },
        }),
        serverUrl: "",
        authType: "None",
        defaultTier: "T1",
        enabled: false,
      });

      const operations = await apiOperations(code);
      expect(operations.map(({ name, method, path, readOnly }) => ({ name, method, path, readOnly }))).toEqual([
        { name: "postEntry", method: "post", path: "/entries", readOnly: false },
        { name: "readEntry", method: "get", path: "/entries/{id}", readOnly: true },
      ]);

      // An MCP connector registered tools, not operations.
      expect(await apiOperations(connectorCode)).toEqual([]);

      signedInAs = memberId;
      await expect(apiOperations(code)).rejects.toBeInstanceOf(NotPermitted);
    } finally {
      await testPool().query("delete from ai.connector where code = $1", [code]);
    }
  });
  it("D296 an administrator connects an OAuth MCP server through the SDK's flow, and its token is refreshed when it lapses", async () => {
    const { beginOAuthConnect, finishOAuthConnect, ConnectorRejected } = await import("@/features/connectors/service");
    const { finishConnect, requestAuth } = await import("@/features/connectors/credential-auth");
    const { readCredential } = await import("@/features/connectors/credential");
    const { decrypt } = await import("@/lib/crypto");
    const { writeCredential, readConnector } = await import("@/features/connectors/repository");
    signedInAs = ownerId;
    const code = `tmp-oauth-${Date.now().toString(36)}`;
    await testPool().query(
      `insert into ai.connector (id, code, name_en, name_ar, transport, server_url, auth_type, is_enabled)
       values (gen_random_uuid(), $1, 'OAuth', 'OAuth', 'StreamableHttp', 'https://mcp.oauth.test/mcp', 'OAuth', false)`,
      [code],
    );

    // A fake authorization server, reached as the SDK reaches one: RFC 9728, RFC 8414, RFC 7591, the token endpoint.
    const grants: URLSearchParams[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://mcp.oauth.test/.well-known/oauth-protected-resource")) {
        return json({ resource: "https://mcp.oauth.test/mcp", authorization_servers: ["https://auth.oauth.test"] });
      }
      if (url.startsWith("https://auth.oauth.test/.well-known/oauth-authorization-server")) {
        return json({
          issuer: "https://auth.oauth.test",
          authorization_endpoint: "https://auth.oauth.test/authorize",
          token_endpoint: "https://auth.oauth.test/token",
          registration_endpoint: "https://auth.oauth.test/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (url === "https://auth.oauth.test/register") return json({ client_id: "registered-client", redirect_uris: ["https://awp.test/cb"] });
      if (url === "https://auth.oauth.test/token") {
        const grant = new URLSearchParams(String(init?.body));
        grants.push(grant);
        return grant.get("grant_type") === "refresh_token"
          ? json({ access_token: "at-2", refresh_token: "rt-2", token_type: "Bearer", expires_in: 3600 })
          : json({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", expires_in: 3600 });
      }
      if (url.endsWith("/connectors")) return json({});
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const address = new URL(await beginOAuthConnect(code));
      expect(address.origin + address.pathname).toBe("https://auth.oauth.test/authorize");
      expect(address.searchParams.get("client_id")).toBe("registered-client");
      expect(address.searchParams.get("code_challenge_method")).toBe("S256");
      const state = address.searchParams.get("state")!;
      expect(state.startsWith(`${code}.`)).toBe(true);

      // The sign-in is bound to the person who started it, and to its own state.
      const connector = await readConnector(code);
      const target = { ...connector!, serverUrl: connector!.serverUrl! };
      await expect(finishConnect(target, state, "code-1", memberId)).rejects.toThrow("not one you started");
      await expect(finishOAuthConnect(`${code}.not-the-state`, "code-1")).rejects.toBeInstanceOf(ConnectorRejected);

      await finishOAuthConnect(state, "code-1");
      expect(grants.at(-1)?.get("grant_type")).toBe("authorization_code");
      expect(grants.at(-1)?.get("code_verifier")).toBeTruthy();
      const stored = await readConnector(code);
      expect(stored!.secretRef!.toString("utf8")).not.toContain("at-1");
      expect((await requestAuth({ ...stored!, serverUrl: stored!.serverUrl! })).headers).toEqual({ authorization: "Bearer at-1" });

      // A lapsed token is refreshed through the SDK and the rotated refresh token kept.
      const credential = readCredential("OAuth", decrypt(stored!.secretRef!))!;
      await writeCredential(code, { ...credential, oauth: { ...credential.oauth, expiresAt: 0 } } as typeof credential);
      const lapsed = await readConnector(code);
      expect((await requestAuth({ ...lapsed!, serverUrl: lapsed!.serverUrl! })).headers).toEqual({ authorization: "Bearer at-2" });
      expect(grants.at(-1)?.get("refresh_token")).toBe("rt-1");
      const rotated = readCredential("OAuth", decrypt((await readConnector(code))!.secretRef!));
      expect(rotated?.type === "OAuth" && rotated.oauth?.tokens?.refresh_token).toBe("rt-2");
    } finally {
      await testPool().query("delete from ai.connector where code = $1", [code]);
    }
  });
});
