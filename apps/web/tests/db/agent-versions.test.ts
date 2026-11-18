import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-51 the agent detail: editing a version, what a tool may be allowed to do, and what has
 * to be true before a version becomes the one every run uses.
 *
 * Editing writes a draft revision rather than the running version. A run in flight is
 * executing the published one, and changing it underneath would alter what that run is
 * doing halfway through — which is why these cases assert where the write landed, not just
 * that it succeeded.
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

describe.skipIf(!hasDatabase)("agent versions", () => {
  let ownerId = "";
  let memberId = "";
  let agentCode = "";

  /** Drafts these cases create, removed so the seeded agent is what it was. */
  async function removeDrafts() {
    await testPool().query(
      `delete from ai.agent_version v
       using ai.agent a
       where v.agent_id = a.id and a.code = $1 and v.published_at is null
         and (a.active_version_id is null or a.active_version_id <> v.id)`,
      [agentCode],
    );
  }

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;
    const agent = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code limit 1",
    );
    agentCode = agent.rows[0].code;
  });

  afterEach(removeDrafts);

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-51.2-01 an edit saves a draft and leaves the running version alone", async () => {
    const { saveDraft } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ id: string; instructions: string }>(
      `select v.id, v.instructions from ai.agent a
       join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
      [agentCode],
    );

    await saveDraft({ code: agentCode, instructions: "Draft instructions for the test." });

    // The draft carries the change.
    const draft = await testPool().query<{ instructions: string; version_number: number }>(
      `select v.instructions, v.version_number from ai.agent_version v
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null order by v.version_number desc limit 1`,
      [agentCode],
    );
    expect(draft.rows[0].instructions).toBe("Draft instructions for the test.");

    // What is running has not moved.
    const after = await testPool().query<{ instructions: string }>(
      "select instructions from ai.agent_version where id = $1",
      [before.rows[0].id],
    );
    expect(after.rows[0].instructions).toBe(before.rows[0].instructions);
  });

  it("UC-51.2-01 a second edit goes to the same draft rather than making another", async () => {
    const { saveDraft } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await saveDraft({ code: agentCode, instructions: "First." });
    await saveDraft({ code: agentCode, instructions: "Second." });

    const drafts = await testPool().query(
      `select v.id from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null`,
      [agentCode],
    );
    expect(drafts.rowCount).toBe(1);
  });

  it("UC-51.2-01 a new draft starts as a copy of what is running", async () => {
    const { saveDraft } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const active = await testPool().query<{ id: string; trust: string; skills: string }>(
      `select v.id, v.trust, (select count(*) from ai.agent_skill s where s.agent_version_id = v.id) as skills
       from ai.agent a join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
      [agentCode],
    );

    // Touch one field; everything else has to arrive with it.
    await saveDraft({ code: agentCode, memoryEnabled: true });

    const draft = await testPool().query<{ trust: string; skills: string }>(
      `select v.trust, (select count(*) from ai.agent_skill s where s.agent_version_id = v.id) as skills
       from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null order by v.version_number desc limit 1`,
      [agentCode],
    );
    expect(draft.rows[0].trust).toBe(active.rows[0].trust);
    // A draft that published an agent stripped of its skills would be a silent downgrade.
    expect(draft.rows[0].skills).toBe(active.rows[0].skills);
  });

  it("UC-51.1-03 refuses a primary or fallback route that is not a chat route, and saves a chat route", async () => {
    const { saveDraft, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    // A Decision route answers only at the decisions endpoint, so a run on it fails at the gateway.
    const decision = `zz-decision-${Date.now()}`;
    await testPool().query("insert into ai.route (alias, kind) values ($1, 'Decision')", [decision]);
    try {
      await expect(saveDraft({ code: agentCode, primaryRouteAlias: decision })).rejects.toBeInstanceOf(AgentRejected);
      await expect(saveDraft({ code: agentCode, fallbackRouteAlias: decision })).rejects.toBeInstanceOf(AgentRejected);
      const carried = await testPool().query(
        `select 1 from ai.agent_version v join ai.route r on r.id in (v.primary_route_id, v.fallback_route_id)
         where r.alias = $1`,
        [decision],
      );
      expect(carried.rowCount).toBe(0);

      await saveDraft({ code: agentCode, primaryRouteAlias: "small-fast", fallbackRouteAlias: "reasoning-default" });
      const draft = await testPool().query<{ primary: string; fallback: string }>(
        `select p.alias as primary, f.alias as fallback from ai.agent_version v
         join ai.agent a on a.id = v.agent_id
         join ai.route p on p.id = v.primary_route_id join ai.route f on f.id = v.fallback_route_id
         where a.code = $1 and v.published_at is null order by v.version_number desc limit 1`,
        [agentCode],
      );
      expect(draft.rows[0]).toEqual({ primary: "small-fast", fallback: "reasoning-default" });
    } finally {
      await testPool().query("delete from ai.route where alias = $1", [decision]);
    }
  });

  it("UC-51.2-04 refuses Auto for a T2 tool and accepts Approval", async () => {
    const { setToolMode, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const tool = await testPool().query<{ id: string }>(
      "select id from ai.connector_tool where tier in ('T2','T3') limit 1",
    );
    if (tool.rowCount === 0) return; // no high-tier tool in the seed

    // Auto for a T2 tool is an agent acting irreversibly with nobody seeing it first.
    await expect(
      setToolMode({ code: agentCode, connectorToolId: tool.rows[0].id, mode: "Auto" }),
    ).rejects.toBeInstanceOf(AgentRejected);

    await expect(
      setToolMode({ code: agentCode, connectorToolId: tool.rows[0].id, mode: "Approval" }),
    ).resolves.toBeUndefined();
  });

  it("D264 a granted connector tool takes the mode its tier implies, and a granted one keeps its own", async () => {
    const { changeToolGrant, setToolMode } = await import("@/features/agents/service");
    signedInAs = ownerId;
    // Tools the agent does not hold yet, so each one is a new grant.
    const pick = (tiers: string) =>
      testPool().query<{ id: string }>(
        `select t.id from ai.connector_tool t
         where t.tier = any($2::text[]) and t.is_available
           and not exists (select 1 from ai.agent_tool_mode m join ai.agent a on a.code = $1
                           where m.connector_tool_id = t.id and m.agent_version_id = a.active_version_id)
         order by t.id limit 2`,
        [agentCode, tiers.split(",")],
      );
    const reads = (await pick("T0")).rows.map((row) => row.id);
    const [write] = (await pick("T1,T2,T3")).rows.map((row) => row.id);
    expect(reads.length).toBe(2);
    expect(write).toBeDefined();

    // A read somebody already set stricter keeps that mode when the grant is saved again.
    await setToolMode({ code: agentCode, connectorToolId: reads[1], mode: "Approval" });
    await changeToolGrant({ code: agentCode, grantPlatform: [], revokePlatform: [], grantTools: [...reads, write], revokeTools: [] });

    const modes = await testPool().query<{ id: string; mode: string }>(
      `select m.connector_tool_id as id, m.mode from ai.agent_tool_mode m
       join ai.agent_version v on v.id = m.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and m.connector_tool_id = any($2::uuid[])`,
      [agentCode, [...reads, write]],
    );
    const modeOf = new Map(modes.rows.map((row) => [row.id, row.mode]));
    expect(modeOf.get(reads[0])).toBe("Auto");
    expect(modeOf.get(reads[1])).toBe("Approval");
    expect(modeOf.get(write)).toBe("Approval");
  });

  it("UC-51.2-03 a stricter mode than the tier requires is always allowed", async () => {
    const { setToolMode } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const tool = await testPool().query<{ id: string }>(
      "select id from ai.connector_tool where tier in ('T0','T1') limit 1",
    );
    if (tool.rowCount === 0) return;

    // The tier is a ceiling, not a target: a designer may always refuse a tool outright.
    await expect(
      setToolMode({ code: agentCode, connectorToolId: tool.rows[0].id, mode: "Denied" }),
    ).resolves.toBeUndefined();

    const saved = await testPool().query<{ mode: string }>(
      `select m.mode from ai.agent_tool_mode m
       join ai.agent_version v on v.id = m.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and m.connector_tool_id = $2`,
      [agentCode, tool.rows[0].id],
    );
    expect(saved.rows[0].mode).toBe("Denied");
  });

  it("UC-51.3-03 refuses to publish with empty release notes", async () => {
    const { saveDraft, publishVersion, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await saveDraft({ code: agentCode, instructions: "Ready to publish." });
    await expect(publishVersion({ code: agentCode, releaseNotes: "   " })).rejects.toBeInstanceOf(
      AgentRejected,
    );

    // Nothing moved: the draft is still a draft.
    const still = await testPool().query(
      `select 1 from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null`,
      [agentCode],
    );
    expect(still.rowCount).toBe(1);
  });

  it("UC-51.3-04 refuses to publish a version below the evaluation gate", async () => {
    const { saveDraft, publishVersion, AgentRejected } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await saveDraft({ code: agentCode, instructions: "Scored badly." });
    await testPool().query(
      `update ai.agent_version v set eval_score = 41
       from ai.agent a where v.agent_id = a.id and a.code = $1 and v.published_at is null`,
      [agentCode],
    );

    await expect(
      publishVersion({ code: agentCode, releaseNotes: "Tried to ship." }),
    ).rejects.toBeInstanceOf(AgentRejected);
  });

  it("UC-51.3-05 refuses to publish for a designer who is not a publisher", async () => {
    const { publishVersion } = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    // Designing an agent and publishing one are deliberately different rights.
    await expect(
      publishVersion({ code: agentCode, releaseNotes: "Not mine to ship." }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("UC-51.3-02 publishes the draft and makes it the version new runs use", async () => {
    const { saveDraft, publishVersion } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ version_number: number }>(
      `select v.version_number from ai.agent a
       join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
      [agentCode],
    );
    // The next number follows the highest that exists, not the active one: an agent that
    // was rolled back has versions above what it is running, and reusing one of those
    // numbers would give two different configurations the same name.
    const highest = await testPool().query<{ version_number: number }>(
      `select max(v.version_number) as version_number from ai.agent_version v
       join ai.agent a on a.id = v.agent_id where a.code = $1`,
      [agentCode],
    );

    await saveDraft({ code: agentCode, instructions: "The published text." });
    const published = await publishVersion({ code: agentCode, releaseNotes: "Clarified the policy citation." });
    expect(published).toBe(Number(highest.rows[0].version_number) + 1);

    const active = await testPool().query<{
      version_number: number;
      instructions: string;
      release_notes: string;
      published_at: string | null;
    }>(
      `select v.version_number, v.instructions, v.release_notes, v.published_at
       from ai.agent a join ai.agent_version v on v.id = a.active_version_id where a.code = $1`,
      [agentCode],
    );
    expect(active.rows[0]).toMatchObject({
      version_number: published,
      instructions: "The published text.",
      release_notes: "Clarified the policy citation.",
    });
    expect(active.rows[0].published_at).not.toBeNull();

    // Integrity rule 6: exactly one version of an agent is active.
    const activeCount = await testPool().query<{ count: string }>(
      `select count(*) as count from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.is_active = true`,
      [agentCode],
    );
    expect(Number(activeCount.rows[0].count)).toBe(1);

    // Put the agent back on the version the seed published.
    const { activateVersion } = await import("@/features/agents/service");
    await activateVersion({ code: agentCode, versionNumber: before.rows[0].version_number });
    await testPool().query(
      `delete from ai.agent_version v using ai.agent a
       where v.agent_id = a.id and a.code = $1 and v.version_number = $2`,
      [agentCode, published],
    );
  });

  it("UC-51.2-02 adding a skill and taking it away both land on the draft", async () => {
    const { loadAgent, setSkill } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const candidate = await testPool().query<{ id: string }>(
      `select sv.id from ai.skill_version sv
       where sv.id not in (
         select s2.skill_version_id from ai.agent_skill s2
         join ai.agent_version v on v.id = s2.agent_version_id
         join ai.agent a on a.id = v.agent_id where a.code = $1
       ) limit 1`,
      [agentCode],
    );
    if (candidate.rowCount === 0) return; // every skill is already attached

    await setSkill({ code: agentCode, skillVersionId: candidate.rows[0].id, enabled: true });
    const added = await testPool().query(
      `select 1 from ai.agent_skill s join ai.agent_version v on v.id = s.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and s.skill_version_id = $2`,
      [agentCode, candidate.rows[0].id],
    );
    expect(added.rowCount).toBe(1);
    // The Skills tab reads the draft the add landed on, so the skill shows as attached and
    // leaves the picker; read from the active version it would look as though nothing happened.
    const shown = await loadAgent(agentCode);
    expect(shown?.draft).toMatch(/^v\d+$/);
    expect(shown?.skills.map((skill) => skill.id)).toContain(candidate.rows[0].id);
    expect(shown?.skillShelf.map((skill) => skill.id)).not.toContain(candidate.rows[0].id);

    await setSkill({ code: agentCode, skillVersionId: candidate.rows[0].id, enabled: false });
    const removed = await testPool().query(
      `select 1 from ai.agent_skill s join ai.agent_version v on v.id = s.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and s.skill_version_id = $2`,
      [agentCode, candidate.rows[0].id],
    );
    expect(removed.rowCount).toBe(0);
  });

  it("UC-51.2-02 granting a knowledge collection and revoking it both land on the draft", async () => {
    const { setKnowledgeAccess } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const collection = await testPool().query<{ id: string }>("select id from ai.knowledge_collection limit 1");
    if (collection.rowCount === 0) return; // no collection exists to grant

    await setKnowledgeAccess({ code: agentCode, collectionId: collection.rows[0].id, enabled: true });
    const granted = await testPool().query(
      `select 1 from ai.agent_knowledge_access k join ai.agent_version v on v.id = k.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and k.collection_id = $2`,
      [agentCode, collection.rows[0].id],
    );
    expect(granted.rowCount).toBe(1);

    await setKnowledgeAccess({ code: agentCode, collectionId: collection.rows[0].id, enabled: false });
    const revoked = await testPool().query(
      `select 1 from ai.agent_knowledge_access k join ai.agent_version v on v.id = k.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and k.collection_id = $2`,
      [agentCode, collection.rows[0].id],
    );
    expect(revoked.rowCount).toBe(0);
  });

  it("granting a memory scope lands on the draft and reaches the run payload", async () => {
    const { setMemoryAccess } = await import("@/features/agents/service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const unit = await testPool().query<{ id: string }>("select id from core.org_unit limit 1");
    const scope = await testPool().query<{ id: string }>(
      `insert into ai.memory_scope (kind, ref_id, path) values ('BusinessUnit', $1, $2) returning id`,
      [unit.rows[0].id, `test-scope-${Date.now()}`],
    );
    const scopeId = scope.rows[0].id;

    // Without this, `agent_memory_access` had no way to ever be written: the grant a
    // designer makes here is what `runPayloadFor` already reads for every run.
    await setMemoryAccess({ code: agentCode, memoryScopeId: scopeId, access: "ReadWrite" });
    const granted = await testPool().query(
      `select access from ai.agent_memory_access m join ai.agent_version v on v.id = m.agent_version_id
       join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null and m.memory_scope_id = $2`,
      [agentCode, scopeId],
    );
    expect(granted.rows[0]?.access).toBe("ReadWrite");

    const draft = await testPool().query<{ id: string }>(
      `select v.id from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null`,
      [agentCode],
    );
    const payload = await repository.runPayloadFor(draft.rows[0].id, []);
    expect(payload.memory).toContainEqual({ scope: "BusinessUnit", scope_id: unit.rows[0].id, writable: true });

    await setMemoryAccess({ code: agentCode, memoryScopeId: scopeId, access: null });
    const revoked = await testPool().query(
      `select 1 from ai.agent_memory_access where memory_scope_id = $1`,
      [scopeId],
    );
    expect(revoked.rowCount).toBe(0);

    await testPool().query("delete from ai.memory_scope where id = $1", [scopeId]);
  });

  it("UC-51.2-02 a draft skill version pinned to an agent does not reach a run until it is published", async () => {
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;
    const draft = await testPool().query<{ id: string }>(
      `select v.id from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 order by v.published_at desc nulls first limit 1`,
      [agentCode],
    );
    const skill = await testPool().query<{ id: string }>(
      `insert into ai.skill (skill_name, title_en, title_ar) values ($1, 'Draft skill', 'مهارة مسودة') returning id`,
      [`test-draft-${Date.now().toString(36)}`],
    );
    const version = await testPool().query<{ id: string }>(
      `insert into ai.skill_version (skill_id, version_label, status) values ($1, '2.0.0', 'Draft') returning id`,
      [skill.rows[0].id],
    );
    // A clean scan, so publishing is the only thing that changes.
    await testPool().query("insert into ai.skill_scan_result (skill_version_id) values ($1)", [version.rows[0].id]);
    await testPool().query("insert into ai.agent_skill (agent_version_id, skill_version_id) values ($1, $2)", [
      draft.rows[0].id,
      version.rows[0].id,
    ]);
    try {
      const pinned = async () =>
        (await repository.runPayloadFor(draft.rows[0].id, [])).skills.map((one) => (one as { id: string }).id);
      expect(await pinned()).not.toContain(version.rows[0].id);
      await testPool().query("update ai.skill_version set status = 'Published' where id = $1", [version.rows[0].id]);
      expect(await pinned()).toContain(version.rows[0].id);
    } finally {
      await testPool().query("delete from ai.agent_skill where skill_version_id = $1", [version.rows[0].id]);
      await testPool().query("delete from ai.skill where id = $1", [skill.rows[0].id]);
    }
  });

  it("an uploaded skill reaches a run with its package reference only when published and its scan passed", async () => {
    const repository = await import("@/features/agents/repository");
    const { logger } = await import("@/lib/logger");
    const warned = vi.spyOn(logger(), "warn");
    signedInAs = ownerId;
    const draft = await testPool().query<{ id: string }>(
      `select v.id from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 order by v.published_at desc nulls first limit 1`,
      [agentCode],
    );
    const suffix = Date.now().toString(36);
    const cases = [
      { name: `test-clean-${suffix}`, source: "Uploaded", status: "Published", injection: 0 as number | null },
      { name: `test-draft-${suffix}`, source: "Uploaded", status: "Draft", injection: 0 },
      { name: `test-injected-${suffix}`, source: "Uploaded", status: "Published", injection: 1 },
      { name: `test-unscanned-${suffix}`, source: "Git", status: "Published", injection: null },
      { name: `test-bundled-${suffix}`, source: "Bundled", status: "Published", injection: null },
    ];
    const skillIds: string[] = [];
    for (const one of cases) {
      const skill = await testPool().query<{ id: string }>(
        `insert into ai.skill (skill_name, title_en, title_ar, source_type) values ($1, $1, $1, $2) returning id`,
        [one.name, one.source],
      );
      skillIds.push(skill.rows[0].id);
      const version = await testPool().query<{ id: string }>(
        `insert into ai.skill_version (skill_id, version_label, status, package_ref)
         values ($1, '1.0.0', $2, $3) returning id`,
        [skill.rows[0].id, one.status, `skills/${one.name}/1.0.0`],
      );
      if (one.injection !== null) {
        await testPool().query(
          "insert into ai.skill_scan_result (skill_version_id, prompt_injection_patterns) values ($1, $2)",
          [version.rows[0].id, one.injection],
        );
      }
      await testPool().query("insert into ai.agent_skill (agent_version_id, skill_version_id) values ($1, $2)", [
        draft.rows[0].id,
        version.rows[0].id,
      ]);
    }
    try {
      const payload = await repository.runPayloadFor(draft.rows[0].id, []);
      const sent = payload.skills
        .filter((one) => one.name.endsWith(suffix))
        .map((one) => ({ name: one.name, package_ref: one.package_ref }));
      expect(sent.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: `test-bundled-${suffix}`, package_ref: null },
        { name: `test-clean-${suffix}`, package_ref: `skills/test-clean-${suffix}/1.0.0` },
      ]);
      for (const [name, reason] of [
        [`test-draft-${suffix}`, "unpublished"],
        [`test-injected-${suffix}`, "scanFailed"],
        [`test-unscanned-${suffix}`, "unscanned"],
      ]) {
        expect(warned).toHaveBeenCalledWith(expect.objectContaining({ skill: name, reason }), "skill not applied to the run");
      }
    } finally {
      warned.mockRestore();
      await testPool().query(
        "delete from ai.agent_skill where skill_version_id in (select id from ai.skill_version where skill_id = any($1))",
        [skillIds],
      );
      await testPool().query("delete from ai.skill where id = any($1)", [skillIds]);
    }
  });

  it("UC-51.3-06 a playground test says why it could not run", async () => {
    const { testAgent, AgentRejected, RunNotStarted } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    // The model or the agent service being unavailable is shown, not swallowed into an
    // empty answer that reads as the agent having nothing to say.
    await expect(testAgent({ code: agentCode, prompt: "Review claim EXP-4471" })).rejects.toSatisfy(
      (error: unknown) => error instanceof AgentRejected || error instanceof RunNotStarted,
    );

    globalThis.fetch = realFetch;
  });

  it("UC-51.2-05 names the connector a skill needs that the agent has no tool of", async () => {
    const { loadAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    // An agent with a skill that declares connector tools.
    const candidate = await testPool().query<{ code: string }>(
      `select distinct a.code from ai.agent a
       join ai.agent_version v on v.id = a.active_version_id
       join ai.agent_skill s on s.agent_version_id = v.id
       join ai.skill_version sv on sv.id = s.skill_version_id
       where exists (select 1 from unnest(sv.declared_tools) t where t like '%/%') limit 1`,
    );
    if (candidate.rowCount === 0) return; // no agent in the seed is in this position

    const detail = await loadAgent(candidate.rows[0].code);
    const granted = new Set(detail!.tools.map((tool) => tool.ref.split("/")[0]));

    // Whatever is named has to be a connector the agent holds no tool of: this is a warning
    // someone acts on, so a false one costs more than none.
    for (const skill of detail!.skills) {
      for (const connector of skill.missingConnectors) expect(granted.has(connector)).toBe(false);
    }
  });

  it("UC-51.2-05 says nothing when the skill needs only connectors the agent has", async () => {
    const { loadAgent } = await import("@/features/agents/service");
    signedInAs = ownerId;

    const detail = await loadAgent("exp");
    // `exp` is granted ERP tools and its skills declare `erp/...` and knowledge,
    // which is the ordinary case: a warning here would be noise on every agent.
    const erpWarnings = detail!.skills.flatMap((skill) =>
      skill.missingConnectors.filter((connector) => connector === "erp"),
    );
    expect(erpWarnings).toEqual([]);
  });

  it("UC-51.1-06 turning memory off is a draft change like any other", async () => {
    const { saveDraft } = await import("@/features/agents/service");
    signedInAs = ownerId;

    await saveDraft({ code: agentCode, memoryEnabled: false });
    const draft = await testPool().query<{ memory_enabled: boolean }>(
      `select v.memory_enabled from ai.agent_version v join ai.agent a on a.id = v.agent_id
       where a.code = $1 and v.published_at is null order by v.version_number desc limit 1`,
      [agentCode],
    );
    // Existing memory is untouched: this decides what the agent's next runs may call.
    expect(draft.rows[0].memory_enabled).toBe(false);
  });
});
