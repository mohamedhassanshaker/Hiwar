import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-50 Agents: creating one, and what the list has to be able to say about it.
 *
 * A new agent's first version is left unpublished. That is what "draft" means here —
 * `ai.agent` has no Draft status and inventing one would put the same fact in two places,
 * so an agent whose active version has never been published is the draft.
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

describe.skipIf(!hasDatabase)("creating an agent", () => {
  let ownerId = "";
  let memberId = "";
  /** Everything these cases create, removed afterwards so the seed is what it was. */
  const invented: string[] = [];

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

  afterEach(async () => {
    if (invented.length) {
      await testPool().query(
        "update ai.agent set active_version_id = null where code = any($1)",
        [invented],
      );
      await testPool().query(
        "delete from ai.agent_version where agent_id in (select id from ai.agent where code = any($1))",
        [invented],
      );
      await testPool().query("delete from ai.agent where code = any($1)", [invented]);
      invented.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-50.2-01 creates an agent whose first version is a draft", async () => {
    const { createAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const code = `test-agent-${Date.now()}`;
    invented.push(code);

    const created = await createAgent({
      code,
      nameEn: "Test Reviewer",
      nameAr: "مراجع اختباري",
      orgUnitId: null,
      profile: "Task",
      trust: "Standard",
      routeAlias: "small-fast",
    });
    expect(created).toBe(code);

    const row = await testPool().query<{
      status: string;
      is_system: boolean;
      initials: string;
      version_number: number;
      published_at: string | null;
      trust: string;
      is_active: boolean;
      version_active: boolean;
    }>(
      `select a.status, a.is_system, a.initials, v.version_number, v.published_at, v.trust,
              (a.active_version_id = v.id) as is_active, v.is_active as version_active
       from ai.agent a join ai.agent_version v on v.agent_id = a.id
       where a.code = $1`,
      [code],
    );

    expect(row.rows[0]).toMatchObject({
      status: "Idle",
      is_system: false,
      version_number: 1,
      trust: "Standard",
      is_active: true,
      // UC-51.4-05: the Versions tab reads the version's own flag, so v1 is Active and offers no Roll back.
      version_active: true,
    });
    // A draft: never published, and the active version all the same, because that is the
    // one a designer is editing.
    expect(row.rows[0].published_at).toBeNull();
    expect(row.rows[0].initials).toBe("TR");
  });

  it("UC-50.2-01 records who created it", async () => {
    const { createAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const code = `test-audit-${Date.now()}`;
    invented.push(code);
    await createAgent({
      code,
      nameEn: "Audited Agent",
      nameAr: "وكيل مُدقق",
      orgUnitId: null,
      profile: "Task",
      trust: "Standard",
      routeAlias: "small-fast",
    });

    const entry = await testPool().query<{ action: string; object_label: string; outcome: string }>(
      "select action, object_label, outcome from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "agents:write", object_label: code, outcome: "Allowed" });
  });

  it("UC-50.2-02 refuses a duplicate code", async () => {
    const { createAgent, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const existing = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code limit 1",
    );

    await expect(
      createAgent({
        code: existing.rows[0].code,
        nameEn: "Clash",
        nameAr: "تعارض",
        orgUnitId: null,
        profile: "Task",
        trust: "Standard",
        routeAlias: "small-fast",
      }),
    ).rejects.toBeInstanceOf(AgentRejected);
  });

  it("UC-50.2-02 refuses a missing name or a code that is not one", async () => {
    const { createAgentInput } = await import("@/features/agents/schema");
    const valid = {
      code: "ok-code",
      nameEn: "A",
      nameAr: "ا",
      orgUnitId: null,
      profile: "Task",
      trust: "Standard",
      routeAlias: "small-fast",
    };
    expect(() => createAgentInput.parse(valid)).not.toThrow();
    expect(() => createAgentInput.parse({ ...valid, nameEn: "  " })).toThrow();
    expect(() => createAgentInput.parse({ ...valid, code: "has spaces" })).toThrow();
  });

  it("UC-50.2-04 will not accept System as the trust of a new agent", async () => {
    const { createAgentInput } = await import("@/features/agents/schema");
    const base = {
      code: "ok-code",
      nameEn: "A",
      nameAr: "ا",
      orgUnitId: null,
      profile: "Task",
      routeAlias: "small-fast",
    };
    // System is not assignable to any agent (UC-50.2-04), so creating one with it is refused.
    expect(() => createAgentInput.parse({ ...base, trust: "System" })).toThrow();
    expect(() => createAgentInput.parse({ ...base, trust: "Elevated" })).not.toThrow();
  });

  it("UC-50.2-02 refuses a model route that does not exist", async () => {
    const { createAgent, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await expect(
      createAgent({
        code: `test-route-${Date.now()}`,
        nameEn: "No Route",
        nameAr: "بلا مسار",
        orgUnitId: null,
        profile: "Task",
        trust: "Standard",
        routeAlias: "no-such-route",
      }),
    ).rejects.toBeInstanceOf(AgentRejected);
  });

  it("refuses a model route that is not a chat route, and takes a chat route", async () => {
    const { createAgent, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    // A Decision route answers only at the decisions endpoint, so a run on it fails at the gateway.
    const decision = `zz-decision-${Date.now()}`;
    await testPool().query("insert into ai.route (alias, kind) values ($1, 'Decision')", [decision]);
    try {
      const refused = `test-decision-${Date.now()}`;
      invented.push(refused);
      const base = { nameEn: "Decider", nameAr: "مقرر", orgUnitId: null, profile: "Task", trust: "Standard" };
      await expect(createAgent({ ...base, code: refused, routeAlias: decision })).rejects.toBeInstanceOf(AgentRejected);
      const stored = await testPool().query("select 1 from ai.agent where code = $1", [refused]);
      expect(stored.rowCount).toBe(0);

      const accepted = `test-chat-${Date.now()}`;
      invented.push(accepted);
      await expect(createAgent({ ...base, code: accepted, routeAlias: "small-fast" })).resolves.toBe(accepted);
    } finally {
      await testPool().query("delete from ai.route where alias = $1", [decision]);
    }
  });

  it("UC-50.2-03 refuses to create an agent for someone without agents:write", async () => {
    const { createAgent } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    await expect(
      createAgent({
        code: `test-denied-${Date.now()}`,
        nameEn: "Denied",
        nameAr: "مرفوض",
        orgUnitId: null,
        profile: "Task",
        trust: "Standard",
        routeAlias: "small-fast",
      }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-50.1-01 carries everything the card shows, including the cost", async () => {
    const { loadDirectory } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const { agents } = await loadDirectory();
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.name).toBeTruthy();
      expect(agent.unit).toBeDefined();
      expect(agent.ver).toMatch(/^v\d+$/);
      expect(agent.model).toBeDefined();
      expect(agent.profile).toBeTruthy();
      expect(agent.status).toBeTruthy();
      expect(typeof agent.runs).toBe("number");
      expect(typeof agent.cost).toBe("number");
    }
  });

  it("UC-50.2-05 says why an agent is in error", async () => {
    const { loadAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const errored = await testPool().query<{ code: string }>(
      "select code from ai.agent where status = 'Error' limit 1",
    );
    if (errored.rowCount === 0) return; // no agent is in error in the seed

    const detail = await loadAgent(errored.rows[0].code);
    // The status alone is not a reason: the card shows this on hover so someone can act on
    // it without opening the run viewer.
    expect(detail?.lastFailure).toBeTruthy();
  });
});
