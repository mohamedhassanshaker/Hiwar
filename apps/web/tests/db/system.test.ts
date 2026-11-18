import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-78 System: the switch that stops every agent on the platform.
 *
 * `UC-78.1-02` asks for two things, and only one of them was there. The flag was written,
 * but nothing read it: every agent kept reading Idle or Running while the platform was
 * paused. That it is derived rather than copied onto each agent is the half worth testing —
 * a resume has to put back a status nothing recorded otherwise.
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

describe.skipIf(!hasDatabase)("system", () => {
  let ownerId = "";
  let memberId = "";

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
    // Every other suite reads the agent list, so the platform is left running.
    await testPool().query("update gov.system_state set agents_paused = false, paused_by = null, paused_at = null");
  });

  afterAll(async () => {
    // These cases pause the platform; leaving it paused would change what every other
    // suite sees.
    await testPool().query("update gov.system_state set agents_paused = false");
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-78.1-02 pausing the platform makes every agent read Paused", async () => {
    const { pauseAgents } = await import("@/features/governance/service");
    const { listAgents } = await import("@/features/organisation/repository");
    signedInAs = ownerId;

    const before = await listAgents();
    expect(before.length).toBeGreaterThan(0);
    // The scenario is only meaningful while something is not already paused.
    expect(before.some((agent) => agent.status !== "Paused")).toBe(true);

    await pauseAgents(true);

    const during = await listAgents();
    // A draft agent was never running, so a pause does not relabel it.
    for (const agent of during) {
      if (before.find((earlier) => earlier.id === agent.id)?.status === "Draft") {
        expect(agent.status).toBe("Draft");
      } else {
        expect(agent.status).toBe("Paused");
      }
    }
  });

  it("UC-78.1-03 resuming puts every agent back to the status it had", async () => {
    const { pauseAgents } = await import("@/features/governance/service");
    const { listAgents } = await import("@/features/organisation/repository");
    signedInAs = ownerId;

    // Started from a running platform explicitly, rather than relying on what the last
    // case left behind.
    await pauseAgents(false);
    const before = await listAgents();

    await pauseAgents(true);
    await pauseAgents(false);
    const after = await listAgents();

    // Nothing was written onto the agents, so there is nothing to restore incorrectly.
    expect(after.map((agent) => [agent.id, agent.status])).toEqual(
      before.map((agent) => [agent.id, agent.status]),
    );
  });

  it("UC-78.1-03 a run Queued before the pause is still Queued after the resume, and a Running one is Running", async () => {
    const { pauseAgents } = await import("@/features/governance/service");
    signedInAs = ownerId;
    await pauseAgents(false);

    const agent = await testPool().query<{ id: string; versionId: string }>(
      "select id, active_version_id as \"versionId\" from ai.agent where active_version_id is not null limit 1",
    );
    const stamp = Date.now();
    const runs = { Queued: crypto.randomUUID(), Running: crypto.randomUUID() };
    for (const [status, id] of Object.entries(runs)) {
      await testPool().query(
        `insert into ai.run (id, key, agent_id, agent_version_id, trigger, context_type, status, created_by, updated_by)
         values ($1, $2, $3, $4, 'Manual', 'Console', $5, $6, $6)`,
        [id, `RUN-PAUSE-${status}-${stamp}`, agent.rows[0].id, agent.rows[0].versionId, status, ownerId],
      );
    }
    const statuses = async () =>
      Object.fromEntries(
        (
          await testPool().query<{ id: string; status: string }>("select id, status from ai.run where id = any($1)", [
            Object.values(runs),
          ])
        ).rows.map((row) => [row.id, row.status]),
      );

    try {
      await pauseAgents(true);
      await pauseAgents(false);

      expect(await statuses()).toEqual({ [runs.Queued]: "Queued", [runs.Running]: "Running" });
    } finally {
      await testPool().query("delete from ai.run where id = any($1)", [Object.values(runs)]);
    }
  });

  it("UC-78.1-02 records who paused the platform and when", async () => {
    const { pauseAgents } = await import("@/features/governance/service");
    signedInAs = ownerId;

    await pauseAgents(true);

    const row = await testPool().query<{ agents_paused: boolean; paused_by: string; paused_at: Date }>(
      "select agents_paused, paused_by, paused_at from gov.system_state limit 1",
    );
    expect(row.rows[0].agents_paused).toBe(true);
    expect(row.rows[0].paused_by).toBe(ownerId);
    expect(row.rows[0].paused_at).not.toBeNull();
  });

  it("UC-78.1-05 refuses the System screen to someone who may not see it", async () => {
    const { loadSystem } = await import("@/features/governance/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    await expect(loadSystem()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-78.1-05 refuses the pause itself to a member, not only the screen", async () => {
    const { pauseAgents } = await import("@/features/governance/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    // Hiding the control is not the control: the action is what has to refuse.
    await expect(pauseAgents(true)).rejects.toBeInstanceOf(NotPermitted);

    const row = await testPool().query<{ agents_paused: boolean }>(
      "select agents_paused from gov.system_state limit 1",
    );
    expect(row.rows[0].agents_paused).toBe(false);
  });
});
