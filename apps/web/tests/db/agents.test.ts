import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-50 and S-51, decided on the server: what an agent's detail carries, who may change its
 * trust, and what rolling a version back does.
 *
 * The screen already renders all of this. What was never checked is the half that a screen
 * cannot enforce — that `System` is not an assignable trust, that a system agent's trust is not
 * editable through an ordinary screen, and that a rollback leaves exactly one active version.
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

describe.skipIf(!hasDatabase)("agents", () => {
  let ownerId = "";
  /** An ordinary agent, and the system agent, as the seed creates them. */
  let agentCode = "";
  let systemAgentCode = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;

    const ordinary = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code limit 1",
    );
    agentCode = ordinary.rows[0].code;

    // Ordered, so a seed with more than one system agent still picks the same one every day.
    const system = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = true order by code limit 1",
    );
    systemAgentCode = system.rows[0]?.code ?? "";
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-51.1-01 carries the configuration and the last-30-days figures the Overview shows", async () => {
    const { loadAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const agent = await loadAgent(agentCode);
    expect(agent).not.toBeNull();

    // Specification 7.4.2 names each of these on the Configuration card.
    expect(agent!.profile).toBeTruthy();
    expect(agent!.model).toBeTruthy();
    expect(agent!.trust).toBeTruthy();
    expect(typeof agent!.memoryEnabled).toBe("boolean");

    // And these four on "Last 30 days".
    expect(agent!.stats.runs).toBeGreaterThanOrEqual(0);
    expect(agent!.stats.successRatePct).toBeGreaterThanOrEqual(0);
    expect(agent!.stats.successRatePct).toBeLessThanOrEqual(100);
    expect(agent!.stats.cost).toBeGreaterThanOrEqual(0);
  });

  it("UC-50.2-04 does not accept System as a trust level", async () => {
    const { setTrustInput, ASSIGNABLE_AGENT_TRUSTS } = await import("@/features/agents/schema");
    const { AGENT_TRUSTS } = await import("@/db/schema/enums");

    // Every other level stays assignable: this reserves one, it does not restrict the rest.
    expect(ASSIGNABLE_AGENT_TRUSTS).toEqual(AGENT_TRUSTS.filter((trust) => trust !== "System"));

    expect(() => setTrustInput.parse({ code: agentCode, trust: "System", version: 1 })).toThrow();
    expect(() => setTrustInput.parse({ code: agentCode, trust: "Restricted", version: 1 })).not.toThrow();
  });

  it("UC-51.1-04 changes an agent's trust and records who did it", async () => {
    const { setTrust } = await import("@/features/agents/service");
    signedInAs = ownerId;

    // The optimistic-concurrency version is the active agent_version's, not the agent row's:
    // trust is a property of the version, so that is the row a concurrent write would race.
    const before = await testPool().query<{ trust: string; version: number }>(
      `select v.trust, v.version from ai.agent a
       join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
      [agentCode],
    );
    const wanted = before.rows[0].trust === "Restricted" ? "Standard" : "Restricted";

    await setTrust({ code: agentCode, trust: wanted, version: before.rows[0].version });

    const after = await testPool().query<{ trust: string }>(
      `select v.trust from ai.agent a join ai.agent_version v on v.id = a.active_version_id
       where a.code = $1`,
      [agentCode],
    );
    expect(after.rows[0].trust).toBe(wanted);

    const entry = await testPool().query<{ action: string; outcome: string; object_label: string }>(
      "select action, outcome, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "agents:write", outcome: "Allowed", object_label: agentCode });
  });

  it("UC-50.2-04 refuses to change a system agent's trust at all", async () => {
    if (!systemAgentCode) return; // the seed carries no system agent; nothing to assert
    const { setTrust, AgentNotEditable } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const { rows } = await testPool().query<{ version: number; trust: string }>(
      `select v.version, v.trust from ai.agent a join ai.agent_version v on v.id = a.active_version_id
       where a.code = $1`,
      [systemAgentCode],
    );

    await expect(
      setTrust({ code: systemAgentCode, trust: "Trusted", version: rows[0].version }),
    ).rejects.toBeInstanceOf(AgentNotEditable);

    // Refused means unchanged, not partly changed.
    const after = await testPool().query<{ trust: string }>(
      `select v.trust from ai.agent a join ai.agent_version v on v.id = a.active_version_id
       where a.code = $1`,
      [systemAgentCode],
    );
    expect(after.rows[0]?.trust).toBe(rows[0].trust);
  });

  it("UC-51.4-04 rolling back makes that version the only active one, and audits it", async () => {
    const { activateVersion, loadAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const agent = await loadAgent(agentCode);
    const older = agent!.versions.find((version) => !version.isActive);
    if (!older) return; // one version only; nothing to roll back to

    await activateVersion({ code: agentCode, versionNumber: Number(older.v.replace(/\D/g, "")) });

    // Integrity rule 6: exactly one version per agent is active.
    const active = await testPool().query<{ count: string }>(
      `select count(*) as count from ai.agent_version v
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.id = a.active_version_id`,
      [agentCode],
    );
    expect(Number(active.rows[0].count)).toBe(1);

    const entry = await testPool().query<{ action: string; outcome: string }>(
      "select action, outcome from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "agents:publish", outcome: "Allowed" });
  });

  it("D38 gives every agent version an explicit platform-tool grant, not an implied one", async () => {
    // Migration 0034 wrote today's effective grant onto every version that predates the
    // table, and the seed writes it for a fresh install. A version with no rows is an
    // agent that silently reaches nothing the moment it is published, so this is the
    // check that the backfill covered the install rather than only the newest rows.
    const ungranted = await testPool().query<{ id: string }>(
      `select v.id from ai.agent_version v
        where not exists (select 1 from ai.agent_platform_tool t where t.agent_version_id = v.id)`,
    );
    expect(ungranted.rows).toEqual([]);
  });

  it("D38 grants nothing to an agent whose grant is empty", async () => {
    const { grantedToolNames, DEFAULT_TOOL_GRANT } = await import("@/features/agents/run-payload");

    // Fail closed. Before the grant was stored this returned the default list whatever
    // the agent was configured with, so "revoke a tool" was not expressible at all.
    expect(grantedToolNames({ platformTools: [], connectorTools: [] })).toEqual([]);
    expect(grantedToolNames({ platformTools: DEFAULT_TOOL_GRANT, connectorTools: ["erp/claims.read"] })).toEqual([
      ...DEFAULT_TOOL_GRANT,
      "erp/claims.read",
    ]);
    // D80: the built-ins the harness answers itself are in the same grant as the rest.
    expect(DEFAULT_TOOL_GRANT).toEqual(expect.arrayContaining(["delegate_to_agent", "write_handoff"]));
  });

  it("D38 creates a new agent with the default grant, and revokes one tool from it", async () => {
    const { createAgent, deleteAgent, setPlatformTool } = await import("@/features/agents/service");
    const { DEFAULT_TOOL_GRANT } = await import("@/features/agents/run-payload");
    signedInAs = ownerId;

    const route = await testPool().query<{ alias: string }>("select alias from ai.route where kind = 'Standard' limit 1");
    const code = `zz-grant-${Date.now().toString(36)}`;
    await createAgent({
      code,
      nameEn: "Grant me",
      nameAr: "امنحني",
      orgUnitId: null,
      profile: "Triage",
      trust: "Standard",
      routeAlias: route.rows[0].alias,
    });

    const granted = async () =>
      (
        await testPool().query<{ tool_name: string }>(
          `select t.tool_name from ai.agent_platform_tool t
             join ai.agent a on a.active_version_id = t.agent_version_id
            where a.code = $1 order by t.tool_name`,
          [code],
        )
      ).rows.map((row) => row.tool_name);

    expect(await granted()).toEqual([...DEFAULT_TOOL_GRANT].sort());

    await setPlatformTool({ code, tool: "page_read", enabled: false });
    expect(await granted()).not.toContain("page_read");
    // Revoking one leaves the rest alone: this is a grant, not a replacement.
    expect(await granted()).toContain("my_attention");

    await deleteAgent(code);
  });

  it("#20b lists only the tools a stored grant can actually reach", async () => {
    // What the configuration screen offers. The plumbing must be absent: it lives on the
    // harness token (D33). The setup tools left the catalogue with the Setup Director (D371),
    // so a grant cannot name one either.
    const { loadToolConfiguration } = await import("@/features/agents/tool-configuration-service");
    const { HARNESS_BUILTIN_TOOLS, HARNESS_PLUMBING_TOOLS } = await import(
      "@/features/agents/run-payload"
    );
    const { PLATFORM_TOOLS } = await import("@/mcp/tools");
    signedInAs = ownerId;

    const configuration = await loadToolConfiguration(agentCode);
    expect(configuration).not.toBeNull();
    const offered = configuration!.catalogue.map((tool) => tool.name);

    for (const plumbing of HARNESS_PLUMBING_TOOLS) expect(offered).not.toContain(plumbing);
    expect(offered.filter((name) => name.startsWith("setup_"))).toEqual([]);
    // D80: the built-ins the harness answers itself are in the same list, not a second one.
    for (const builtin of HARNESS_BUILTIN_TOOLS) expect(offered).toContain(builtin);

    // The tier the T2 warning reads is the catalogue's own, not a copy.
    for (const tool of configuration!.catalogue) {
      const entry = PLATFORM_TOOLS.find((candidate) => candidate.name === tool.name);
      expect(tool.tier).toBe(entry ? entry.tier : null);
    }
  });

  it("#20b reads the grant and the skills' declared tools the warning compares", async () => {
    const { loadToolConfiguration } = await import("@/features/agents/tool-configuration-service");
    signedInAs = ownerId;

    const configuration = await loadToolConfiguration(agentCode);
    const stored = await testPool().query<{ tool_name: string }>(
      `select t.tool_name from ai.agent_platform_tool t
         join ai.agent a on a.active_version_id = t.agent_version_id
        where a.code = $1 order by t.tool_name`,
      [agentCode],
    );
    expect(configuration!.granted).toEqual(stored.rows.map((row) => row.tool_name));

    // The warning has nothing to say unless the declarations arrive with the grant.
    const declared = await testPool().query<{ count: string }>(
      `select count(*) as count from ai.agent_skill asg
         join ai.agent a on a.active_version_id = asg.agent_version_id
        where a.code = $1`,
      [agentCode],
    );
    expect(configuration!.skills).toHaveLength(Number(declared.rows[0].count));
    for (const skill of configuration!.skills) expect(Array.isArray(skill.declaredTools)).toBe(true);
  });

  it("deletes an agent that has never run, and cascades its own configuration with it", async () => {
    const { createAgent, deleteAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const route = await testPool().query<{ alias: string }>("select alias from ai.route where kind = 'Standard' limit 1");
    const code = `zz-delete-${Date.now().toString(36)}`;
    await createAgent({
      code,
      nameEn: "Delete me",
      nameAr: "احذفني",
      orgUnitId: null,
      profile: "Triage",
      trust: "Standard",
      routeAlias: route.rows[0].alias,
    });

    await deleteAgent(code);

    const row = await testPool().query("select 1 from ai.agent where code = $1", [code]);
    expect(row.rows).toHaveLength(0);

    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "agents:delete", object_label: code });
  });

  it("refuses to delete an agent that has run, naming what is still using it", async () => {
    const { AgentRejected, deleteAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const used = await testPool().query<{ code: string }>(
      "select a.code from ai.agent a where exists (select 1 from ai.run r where r.agent_id = a.id) order by a.code limit 1",
    );
    if (!used.rows[0]) return; // the seed changed and nothing has a run; nothing to prove here

    await expect(deleteAgent(used.rows[0].code)).rejects.toBeInstanceOf(AgentRejected);

    // Refused means still there, not partly removed.
    const row = await testPool().query("select 1 from ai.agent where code = $1", [used.rows[0].code]);
    expect(row.rows).toHaveLength(1);
  });
});

describe.skipIf(!hasDatabase)("the built-in Platform Assistant", () => {
  let ownerId = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
  });

  it("D65 refuses to be deleted, in the server and not only in the UI", async () => {
    // The AI Assistant panel always runs this agent, so deleting it would take a
    // product surface with it. A hidden button is not a control.
    const { deleteAgent } = await import("@/features/agents/service");
    const { AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await expect(deleteAgent("pa")).rejects.toBeInstanceOf(AgentRejected);

    const still = await testPool().query("select 1 from ai.agent where code = 'pa'");
    expect(still.rowCount).toBe(1);
  });

  it("D65 keeps everything about it configurable: only its existence is fixed", async () => {
    const { resetBuiltinToDefaults } = await import("@/features/agents/service");
    const { BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    signedInAs = ownerId;

    // Somebody customises it, the way the configuration screen will.
    const draft = await testPool().query<{ id: string }>(
      `select av.id from ai.agent_version av
         join ai.agent a on a.id = av.agent_id
        where a.code = 'pa' and av.published_at is null
        order by av.version_number desc limit 1`,
    );
    if (draft.rowCount === 0) return; // no draft to work against in this fixture
    const versionId = draft.rows[0].id;
    await testPool().query("update ai.agent_version set instructions = $1 where id = $2", [
      "Something a person wrote.",
      versionId,
    ]);
    await testPool().query(
      "delete from ai.agent_platform_tool where agent_version_id = $1 and tool_name = $2",
      [versionId, "page_read"],
    );

    await resetBuiltinToDefaults("pa");

    const after = await testPool().query<{ instructions: string }>(
      "select instructions from ai.agent_version where id = $1",
      [versionId],
    );
    expect(after.rows[0].instructions).toBe(BUILTIN_DEFAULTS.instructions);

    // The grant is replaced, not merged: a reset that only added rows would leave
    // behind everything granted since, which is not a reset.
    const grant = await testPool().query<{ tool_name: string }>(
      "select tool_name from ai.agent_platform_tool where agent_version_id = $1 order by tool_name",
      [versionId],
    );
    expect(grant.rows.map((row) => row.tool_name).sort()).toEqual([...BUILTIN_DEFAULTS.tools].sort());
  });

  it("D65 an ordinary agent has no platform defaults to restore", async () => {
    const { resetBuiltinToDefaults, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;
    // The platform never had an opinion about an agent a person wrote.
    await expect(resetBuiltinToDefaults("exp")).rejects.toBeInstanceOf(AgentRejected);
  });
  it("UC-51.1-05 sets an agent's run budget on its active version and records who did it", async () => {
    const agentCode = await ordinaryAgentCode();
    const { setRunBudget } = await import("@/features/agents/service");
    signedInAs = ownerId;
    // The active version's own lock, which is what the configuration screen holds.
    const read = () =>
      testPool().query<{ version: number; soft: string | null; hard: string | null }>(
        `select v.version, v.run_budget_soft_aed as soft, v.run_budget_hard_aed as hard
           from ai.agent a join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
        [agentCode],
      );
    const { version, soft, hard } = (await read()).rows[0];

    const lock = await setRunBudget({ code: agentCode, soft: 2, hard: 4, version });

    const after = (await read()).rows[0];
    expect(after.version).toBe(lock);
    expect(lock).toBeGreaterThan(version);
    expect(Number(after.soft)).toBe(2);
    expect(Number(after.hard)).toBe(4);
    const entry = await testPool().query<{ detail: { soft: number; hard: number } }>(
      "select detail_json as detail from audit.audit_entry where action = 'agents:run_budget' and object_label = $1 order by at desc, id desc limit 1",
      [agentCode],
    );
    expect(entry.rows[0].detail).toEqual({ soft: 2, hard: 4 });

    await setRunBudget({
      code: agentCode,
      soft: soft === null ? null : Number(soft),
      hard: hard === null ? null : Number(hard),
      version: lock,
    });
  });

  it("UC-51.1-04 UC-51.1-05 trust and the run budget saved together each take the lock the last one left, and a stale lock is refused", async () => {
    const agentCode = await ordinaryAgentCode();
    const { setRunBudget, setTrust } = await import("@/features/agents/service");
    signedInAs = ownerId;
    const read = () =>
      testPool().query<{ version: number; trust: string; soft: string | null; hard: string | null }>(
        `select v.version, v.trust, v.run_budget_soft_aed as soft, v.run_budget_hard_aed as hard
           from ai.agent a join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
        [agentCode],
      );
    const before = (await read()).rows[0];
    const other = before.trust === "Elevated" ? "Standard" : "Elevated";

    const afterTrust = await setTrust({ code: agentCode, trust: other, version: before.version });
    // The lock the dialog opened with is spent by its own first write.
    await expect(setRunBudget({ code: agentCode, soft: 1, hard: 3, version: before.version })).rejects.toThrow();
    const afterBudget = await setRunBudget({ code: agentCode, soft: 1, hard: 3, version: afterTrust });
    const saved = (await read()).rows[0];
    expect(saved.trust).toBe(other);
    expect([Number(saved.soft), Number(saved.hard)]).toEqual([1, 3]);

    const restored = await setTrust({ code: agentCode, trust: before.trust, version: afterBudget });
    await setRunBudget({
      code: agentCode,
      soft: before.soft === null ? null : Number(before.soft),
      hard: before.hard === null ? null : Number(before.hard),
      version: restored,
    });
  });

  it("UC-51.1-05 refuses a run budget change to someone without agents:write", async () => {
    const agentCode = await ordinaryAgentCode();
    const { setRunBudget } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");
    signedInAs = member.rows[0].id;
    await expect(setRunBudget({ code: agentCode, soft: 1, hard: 2, version: 1 })).rejects.toBeInstanceOf(NotPermitted);
  });

  it("offers the New Agent form the org units and the chat route aliases only", async () => {
    const { loadAgentChoices } = await import("@/features/agents/service");
    signedInAs = ownerId;
    // An agent runs on chat completions; an Embedding, Voice or Decision route is not offered.
    // The New Agent and Configuration pickers list exactly these, and New Agent defaults to the first.
    const decision = `zz-decision-${Date.now()}`;
    await testPool().query("insert into ai.route (alias, kind) values ($1, 'Decision')", [decision]);
    try {
      const choices = await loadAgentChoices();
      const aliases = await testPool().query<{ alias: string }>(
        "select alias from ai.route where kind in ('Standard', 'Typesafe')",
      );
      expect(choices.units.length).toBeGreaterThan(0);
      expect(choices.routes).not.toContain(decision);
      expect([...choices.routes].sort()).toEqual(aliases.rows.map((row) => row.alias).sort());
    } finally {
      await testPool().query("delete from ai.route where alias = $1", [decision]);
    }
  });
});

/** The first ordinary agent the seed creates, as the cases above name it. */
async function ordinaryAgentCode(): Promise<string> {
  const row = await testPool().query<{ code: string }>("select code from ai.agent where is_system = false order by code limit 1");
  return row.rows[0].code;
}
