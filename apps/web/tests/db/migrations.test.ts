import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { closeTestPool, failureOf, hasDatabase, inRolledBackTransaction, seedFixture } from "./harness";

/**
 * What the later migrations change in rows and constraints, and the constraints no service
 * reaches.
 *
 * A data backfill acts only on rows present when it runs, and a fresh CI database has none
 * until the seed runs, so applying a migration proves its DDL and nothing about its UPDATEs.
 * Each backfill here is the migration file's own SQL, applied to rows set up for it inside a
 * transaction that is rolled back.
 */

const migrationsDir = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

/** The statements of one migration, as `db:migrate` splits them. */
function statementsOf(prefix: string): string[] {
  const file = readdirSync(migrationsDir).find((name) => name.startsWith(prefix) && name.endsWith(".sql"));
  if (!file) throw new Error(`no migration ${prefix}`);
  return readFileSync(`${migrationsDir}/${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

/** The one statement of a migration that contains `marker`. */
function statementOf(prefix: string, marker: string): string {
  const found = statementsOf(prefix).filter((statement) => statement.includes(marker));
  if (found.length !== 1) throw new Error(`${prefix}: ${found.length} statements contain ${marker}`);
  return found[0];
}

/** A SQL string literal's value, `''` unescaped. */
function literalAfter(statement: string, before: string): string {
  const start = statement.indexOf(before);
  if (start < 0) throw new Error(`no ${before}`);
  const match = /^'((?:[^']|'')*)'/.exec(statement.slice(start + before.length));
  if (!match) throw new Error(`no literal after ${before}`);
  return match[1].replaceAll("''", "'");
}

async function insertAgent(
  client: PoolClient,
  code: string,
  values: { isBuiltin?: boolean; defaultVersion?: number | null; nameEn?: string } = {},
): Promise<string> {
  const row = await client.query<{ id: string }>(
    `insert into ai.agent (code, name_en, name_ar, initials, is_builtin, default_version)
     values ($1, $2, 'وكيل', 'TA', $3, $4) returning id`,
    [code, values.nameEn ?? `Agent ${code}`, values.isBuiltin ?? false, values.defaultVersion ?? null],
  );
  return row.rows[0].id;
}

async function insertVersion(
  client: PoolClient,
  agentId: string,
  number: number,
  values: { instructions: string; active: boolean; published: boolean },
): Promise<string> {
  const row = await client.query<{ id: string }>(
    `insert into ai.agent_version (agent_id, version_number, instructions, is_active, published_at)
     values ($1, $2, $3, $4, case when $5::boolean then now() end) returning id`,
    [agentId, number, values.instructions, values.active, values.published],
  );
  return row.rows[0].id;
}

const instructionsOf = async (client: PoolClient, versionId: string) =>
  (await client.query<{ instructions: string }>("select instructions from ai.agent_version where id = $1", [versionId]))
    .rows[0].instructions;

describe.skipIf(!hasDatabase)("migration backfills", () => {
  afterAll(closeTestPool);

  it("0039 D99 gives a built-in agent with no default version the first one, and leaves every other agent as it was", async () => {
    await inRolledBackTransaction(async (client) => {
      const unset = await insertAgent(client, "m39a", { isBuiltin: true, defaultVersion: null });
      const later = await insertAgent(client, "m39b", { isBuiltin: true, defaultVersion: 2 });
      const ordinary = await insertAgent(client, "m39c", { isBuiltin: false, defaultVersion: null });

      for (const statement of statementsOf("0039_")) await client.query(statement);

      const rows = await client.query<{ id: string; default_version: number | null }>(
        "select id, default_version from ai.agent where id = any($1)",
        [[unset, later, ordinary]],
      );
      const versionOf = new Map(rows.rows.map((row) => [row.id, row.default_version]));
      expect(versionOf.get(unset)).toBe(1);
      // A built-in already on a later generation is not moved back.
      expect(versionOf.get(later)).toBe(2);
      // Only a built-in agent has defaults to track.
      expect(versionOf.get(ordinary)).toBeNull();
    });
  });

  it("0041 D133 moves the built-in Assistant's seeded text onto the new defaults, and leaves a customised text alone", async () => {
    const update = statementOf("0041_", 'SET "instructions"');
    const seededText = literalAfter(update, 'v."instructions" = ');
    const newText = literalAfter(update, 'SET "instructions" = ');
    expect(seededText).not.toBe(newText);

    await inRolledBackTransaction(async (client) => {
      const seeded = await insertAgent(client, "m41a", { isBuiltin: true, defaultVersion: 1 });
      const history = await insertVersion(client, seeded, 1, { instructions: seededText, active: false, published: true });
      const running = await insertVersion(client, seeded, 2, { instructions: seededText, active: true, published: true });
      const draft = await insertVersion(client, seeded, 3, { instructions: seededText, active: false, published: false });

      const customised = await insertAgent(client, "m41b", { isBuiltin: true, defaultVersion: 1 });
      const ownText = `${seededText} Always answer in a table.`;
      const customisedRunning = await insertVersion(client, customised, 1, { instructions: ownText, active: true, published: true });

      // A built-in already on the second generation of the defaults is past this backfill.
      const upgraded = await insertAgent(client, "m41c", { isBuiltin: true, defaultVersion: 2 });
      const upgradedRunning = await insertVersion(client, upgraded, 1, { instructions: seededText, active: true, published: true });

      // An ordinary agent holding the same words is somebody's own agent, not the Assistant.
      const ordinary = await insertAgent(client, "m41d", { isBuiltin: false, defaultVersion: null });
      const ordinaryRunning = await insertVersion(client, ordinary, 1, { instructions: seededText, active: true, published: true });

      await client.query(update);

      expect(await instructionsOf(client, running)).toBe(newText);
      expect(await instructionsOf(client, draft)).toBe(newText);
      // A published version that is no longer running is history, and history is not rewritten.
      expect(await instructionsOf(client, history)).toBe(seededText);
      expect(await instructionsOf(client, customisedRunning)).toBe(ownText);
      expect(await instructionsOf(client, upgradedRunning)).toBe(seededText);
      expect(await instructionsOf(client, ordinaryRunning)).toBe(seededText);
    });
  });

  it("0045 D195 moves the built-in Assistant's version 2 text to the version 3 defaults, and leaves a customised text alone", async () => {
    const { BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    const update = statementOf("0045_", 'SET "instructions"');
    const versionTwo = literalAfter(update, 'v."instructions" = ');
    // The migration writes exactly what a fresh seed and a reset write; version 4 (D228)
    // kept the version 3 text.
    expect(literalAfter(update, 'SET "instructions" = ')).toBe(BUILTIN_DEFAULTS.instructions);

    await inRolledBackTransaction(async (client) => {
      const shipped = await insertAgent(client, "m45a", { isBuiltin: true, defaultVersion: 2 });
      const running = await insertVersion(client, shipped, 1, { instructions: versionTwo, active: true, published: true });
      const draft = await insertVersion(client, shipped, 2, { instructions: versionTwo, active: false, published: false });
      const customised = await insertAgent(client, "m45b", { isBuiltin: true, defaultVersion: 2 });
      const ownText = `${versionTwo} Always answer in a table.`;
      const customisedRunning = await insertVersion(client, customised, 1, { instructions: ownText, active: true, published: true });

      await client.query(update);
      await client.query(statementOf("0045_", `SET "default_version" = 3`));

      expect(await instructionsOf(client, running)).toBe(BUILTIN_DEFAULTS.instructions);
      expect(await instructionsOf(client, draft)).toBe(BUILTIN_DEFAULTS.instructions);
      expect(await instructionsOf(client, customisedRunning)).toBe(ownText);
      const versions = await client.query<{ default_version: number }>(
        "select default_version from ai.agent where id = any($1)",
        [[shipped, customised]],
      );
      expect(versions.rows.map((row) => row.default_version)).toEqual([3, 3]);
    });
  });

  it("0052 D228 gives a version 3 Assistant the platform-operations skill and moves it to version 4", async () => {
    const { BUILTIN_DEFAULT_VERSION, BUILTIN_DEFAULTS } = await import("@/features/agents/builtin");
    expect(BUILTIN_DEFAULT_VERSION).toBe(4);
    expect(BUILTIN_DEFAULTS.skills).toContain("platform-operations");

    await inRolledBackTransaction(async (client) => {
      const shipped = await insertAgent(client, "m52a", { isBuiltin: true, defaultVersion: 3 });
      const running = await insertVersion(client, shipped, 1, { instructions: "x", active: true, published: true });
      const draft = await insertVersion(client, shipped, 2, { instructions: "x", active: false, published: false });
      const old = await insertVersion(client, shipped, 0, { instructions: "x", active: false, published: true });

      await client.query(statementOf("0052_", 'INSERT INTO "ai"."agent_skill"'));
      await client.query(statementOf("0052_", 'SET "default_version" = 4'));

      const carried = await client.query<{ id: string }>(
        `select s.agent_version_id as id from ai.agent_skill s join ai.skill_version sv on sv.id = s.skill_version_id
         join ai.skill k on k.id = sv.skill_id where k.skill_name = 'platform-operations' and s.agent_version_id = any($1)`,
        [[running, draft, old]],
      );
      // The running version and the draft; a superseded version keeps what it ran with.
      expect(carried.rows.map((row) => row.id).sort()).toEqual([running, draft].sort());
      const version = await client.query<{ default_version: number }>("select default_version from ai.agent where id = $1", [shipped]);
      expect(version.rows[0].default_version).toBe(4);

      // The Platform connector is there, whether the seed or the migration put it there.
      await client.query(statementOf("0052_", 'INSERT INTO "ai"."connector"'));
      const platform = await client.query<{ server_url: string; is_enabled: boolean }>("select server_url, is_enabled from ai.connector where code = 'platform'");
      expect(platform.rows[0]).toEqual({ server_url: "internal://platform", is_enabled: true });
    });
  });

  it("0046 D199 adds the organisation's memory scope where an install has none, and leaves one that exists", async () => {
    const insert = statementOf("0046_", 'INSERT INTO "ai"."memory_scope"');
    const organisationScopes = async (client: PoolClient) =>
      (await client.query<{ path: string }>("select path from ai.memory_scope where kind = 'Organisation' and person_id is null")).rows;

    await inRolledBackTransaction(async (client) => {
      await client.query("delete from ai.memory where scope_id in (select id from ai.memory_scope where kind = 'Organisation')");
      await client.query("update ai.memory_scope set parent_scope_id = null where parent_scope_id in (select id from ai.memory_scope where kind = 'Organisation')");
      await client.query("delete from ai.agent_memory_access where memory_scope_id in (select id from ai.memory_scope where kind = 'Organisation')");
      await client.query("delete from ai.memory_scope where kind = 'Organisation'");
      await client.query(insert);
      expect(await organisationScopes(client)).toEqual([{ path: "org" }]);
      // Run again, it adds nothing.
      await client.query(insert);
      expect(await organisationScopes(client)).toEqual([{ path: "org" }]);
    });
  });

  it("0068 D318 puts a step's values on the latest action taken at that step, and on no other entry", async () => {
    await inRolledBackTransaction(async (client) => {
      const { personId, projectId } = await seedFixture(client);
      const type = await client.query<{ id: string }>("insert into work.request_type (code, name_en, name_ar) values ('MIG68', 'Mig', 'Mig') returning id");
      const version = await client.query<{ id: string }>(
        "insert into work.request_type_version (request_type_id, version_number) values ($1, 1) returning id",
        [type.rows[0].id],
      );
      const steps = await client.query<{ id: string }>(
        `insert into work.transition_step (request_type_version_id, sort_order, name_en, name_ar)
         values ($1, 1, 'A', 'A'), ($1, 2, 'B', 'B'), ($1, 3, 'C', 'C') returning id`,
        [version.rows[0].id],
      );
      const [a, b, c] = steps.rows.map((row) => row.id);
      await client.query(
        `insert into work.attribute_definition (request_type_version_id, key, label_en, label_ar, data_type, step_id)
         values ($1, 'title_note', 'T', 'T', 'Text', null), ($1, 'cost', 'C', 'C', 'Text', $2), ($1, 'risk', 'R', 'R', 'Text', $2), ($1, 'plan', 'P', 'P', 'Text', $3)`,
        [version.rows[0].id, b, c],
      );
      const request = await client.query<{ id: string }>(
        `insert into work.request (key, project_id, request_type_version_id, title_en, title_ar, requester_id, current_step_id, attributes)
         values ('MIG68-1', $1, $2, 'Mig', 'Mig', $3, $4, '{"title_note":"x","cost":"1850","risk":"Low"}') returning id`,
        [projectId, version.rows[0].id, personId, c],
      );
      // Submitted at A; acted at A; taken and acted at B, which sends it back to A; acted at A and at B again.
      // Hours ago, so the rows land in the event table's current partitions.
      const events: [string, number, string | null][] = [
        ["Submitted", 0, null],
        ["ActionTaken", 1, b],
        ["Assigned", 2, b],
        ["ActionTaken", 3, a],
        ["ActionTaken", 4, b],
        ["ActionTaken", 5, c],
      ];
      for (const [eventType, hour, to] of events) {
        const at = new Date(Date.now() - (6 - hour) * 3_600_000);
        await client.query(
          "insert into work.request_event (request_id, at, actor_type, actor_id, event_type, to_step_id) values ($1, $2, 'Person', $3, $4, $5)",
          [request.rows[0].id, at, personId, eventType, to],
        );
      }
      const given = async () =>
        (
          await client.query<{ at: Date; attributes: Record<string, string> | null }>(
            "select at, attributes from work.request_event where request_id = $1 order by at",
            [request.rows[0].id],
          )
        ).rows.map((row) => row.attributes);

      for (const statement of statementsOf("0068_")) await client.query(statement);
      // Only the latest action at B gets B's values; the form's value and the first visit's entry stay out.
      expect(await given()).toEqual([null, null, null, null, null, { cost: "1850", risk: "Low" }]);
      for (const statement of statementsOf("0068_")) await client.query(statement);
      expect(await given()).toEqual([null, null, null, null, null, { cost: "1850", risk: "Low" }]);
    });
  });

  it("0041 D99 renames the built-in Page Assistant and moves every built-in on the first defaults to the second", async () => {
    await inRolledBackTransaction(async (client) => {
      const builtin = await insertAgent(client, "m41e", { isBuiltin: true, defaultVersion: 1, nameEn: "Page Assistant" });
      const ordinary = await insertAgent(client, "m41f", { isBuiltin: false, nameEn: "Page Assistant" });

      await client.query(statementOf("0041_", `SET "name_en" = 'Platform Assistant'`));
      await client.query(statementOf("0041_", `SET "default_version" = 2`));

      const rows = await client.query<{ id: string; name_en: string; name_ar: string; default_version: number | null }>(
        "select id, name_en, name_ar, default_version from ai.agent where id = any($1)",
        [[builtin, ordinary]],
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      expect(byId.get(builtin)).toMatchObject({ name_en: "Platform Assistant", name_ar: "مساعد المنصة", default_version: 2 });
      // A user-defined agent that happens to carry the old name keeps it.
      expect(byId.get(ordinary)).toMatchObject({ name_en: "Page Assistant", default_version: null });
    });
  });

  it("0041 D134 gives a room with agents and no lead its earliest-joined agent as lead, and leaves a room that has one alone", async () => {
    const backfill = statementOf("0041_", `UPDATE "work"."room_participant"`);

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const first = await insertAgent(client, "m41g");
      const second = await insertAgent(client, "m41h");
      const third = await insertAgent(client, "m41i");

      const room = async (key: string) =>
        (
          await client.query<{ id: string }>(
            `insert into work.discussion_room (key, project_id, title_en, title_ar, turn_taking)
             values ($1, $2, 'Backfill', 'تعبئة', 'Autonomous') returning id`,
            [key, fixture.projectId],
          )
        ).rows[0].id;
      const join = (roomId: string, type: string, principal: string, role: string, joinedAt: string) =>
        client.query(
          `insert into work.room_participant (room_id, principal_type, principal_id, room_role, joined_at)
           values ($1, $2, $3, $4, $5)`,
          [roomId, type, principal, role, joinedAt],
        );

      // No lead: the person joined first, but only an agent can lead.
      const leaderless = await room("RM-M41A");
      await join(leaderless, "Person", fixture.personId, "Owner", "2026-01-01T08:00:00Z");
      await join(leaderless, "Agent", second, "MemberAgent", "2026-01-01T10:00:00Z");
      await join(leaderless, "Agent", first, "MemberAgent", "2026-01-01T09:00:00Z");

      // A lead already: the earlier-joined member agent does not take over.
      const led = await room("RM-M41B");
      await join(led, "Agent", first, "MemberAgent", "2026-01-01T09:00:00Z");
      await join(led, "Agent", third, "LeadAgent", "2026-01-01T11:00:00Z");

      // Two agents that joined at the same moment: the order is still decided, by id.
      const tied = await room("RM-M41C");
      await join(tied, "Agent", second, "MemberAgent", "2026-01-01T09:00:00Z");
      await join(tied, "Agent", third, "MemberAgent", "2026-01-01T09:00:00Z");

      // People only: no agent, so nobody leads.
      const people = await room("RM-M41D");
      await join(people, "Person", fixture.personId, "Owner", "2026-01-01T08:00:00Z");

      await client.query(backfill);

      const roles = await client.query<{ room_id: string; principal_id: string; room_role: string }>(
        "select room_id, principal_id, room_role from work.room_participant where room_id = any($1)",
        [[leaderless, led, tied, people]],
      );
      const roleOf = (roomId: string, principal: string) =>
        roles.rows.find((row) => row.room_id === roomId && row.principal_id === principal)?.room_role;
      const leadsIn = (roomId: string) =>
        roles.rows.filter((row) => row.room_id === roomId && row.room_role === "LeadAgent").map((row) => row.principal_id);

      expect(leadsIn(leaderless)).toEqual([first]);
      expect(roleOf(leaderless, second)).toBe("MemberAgent");
      expect(roleOf(leaderless, fixture.personId)).toBe("Owner");

      expect(leadsIn(led)).toEqual([third]);
      expect(roleOf(led, first)).toBe("MemberAgent");

      expect(leadsIn(tied)).toEqual([[second, third].sort()[0]]);
      expect(leadsIn(people)).toEqual([]);
    });
  });
});

describe.skipIf(!hasDatabase)("constraints no service reaches", () => {
  afterAll(closeTestPool);

  const audit = (client: PoolClient, actorType: string) =>
    failureOf(
      client,
      `insert into audit.audit_entry (actor_type, actor_label, action, object_type, outcome)
       values ($1, 'migration test', 'test.actor', 'Test', 'Allowed')`,
      [actorType],
    );

  it("0062 D289 moves every room onto Mention only or Autonomous, and the constraint then refuses the old policies", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      // The rooms as they stood before 0062, under the constraint they were written under.
      await client.query(`ALTER TABLE "work"."discussion_room" DROP CONSTRAINT "discussion_room_turn_taking_check"`);
      const before: Record<string, string> = {};
      for (const [key, policy] of [["RM-M62A", "LeadAgent"], ["RM-M62B", "RoundRobin"], ["RM-M62C", "Moderated"], ["RM-M62D", "MentionOnly"], ["RM-M62E", "Autonomous"]]) {
        await client.query(
          `insert into work.discussion_room (key, project_id, title_en, title_ar, turn_taking) values ($1, $2, 'Policy', 'سياسة', $3)`,
          [key, fixture.projectId, policy],
        );
        before[key] = policy;
      }

      // The constraint is already off here, so its DROP is the one statement not repeated.
      for (const statement of statementsOf("0062_").filter((one) => !one.includes("DROP CONSTRAINT"))) await client.query(statement);

      const after = await client.query<{ key: string; turn_taking: string }>(
        "select key, turn_taking from work.discussion_room where key = any($1) order by key",
        [Object.keys(before)],
      );
      expect(Object.fromEntries(after.rows.map((row) => [row.key, row.turn_taking]))).toEqual({
        "RM-M62A": "Autonomous",
        "RM-M62B": "Autonomous",
        "RM-M62C": "MentionOnly",
        "RM-M62D": "MentionOnly",
        "RM-M62E": "Autonomous",
      });
      expect(
        await failureOf(client, `update work.discussion_room set turn_taking = 'LeadAgent' where key = 'RM-M62A'`),
      ).toMatch(/discussion_room_turn_taking_check/);
    });
  });

  it("0063 D290 gives an install with the seeded OpenRouter connection the agent-choice Decision route, once", async () => {
    await inRolledBackTransaction(async (client) => {
      // As the install stood before 0063: no Decision route and no decision model.
      await client.query("delete from ai.route where alias = 'agent-choice'");
      await client.query("delete from ai.connection_allowed_model where model_name = 'cloudflare/clef-flash'");
      const before = await client.query("select 1 from ai.provider_connection where id = '2810cdfa-17de-5bff-8298-fda97a5bb13c'");
      expect(before.rowCount).toBe(1);

      for (let run = 0; run < 2; run++) for (const statement of statementsOf("0063_")) await client.query(statement);

      const route = await client.query<{ kind: string; model_name: string; model_kind: string }>(
        `select r.kind, rs.model_name, am.kind as model_kind from ai.route r
           join ai.route_step rs on rs.route_id = r.id
           join ai.connection_allowed_model am on am.connection_id = rs.connection_id and am.model_name = rs.model_name
          where r.alias = 'agent-choice'`,
      );
      expect(route.rows).toEqual([{ kind: "Decision", model_name: "cloudflare/clef-flash", model_kind: "Decision" }]);
    });
  });

  it("0029 audit_entry_actor_check records an external contact as the actor, and refuses an actor type nobody defined", async () => {
    await inRolledBackTransaction(async (client) => {
      expect(await audit(client, "ExternalContact")).toBeNull();
      expect(await audit(client, "Visitor")).toContain("audit_entry_actor_check");
    });
  });

  it("0037 D101 run_status_check stores a Blocked run, and refuses a status that is not one of the outcomes", async () => {
    await inRolledBackTransaction(async (client) => {
      const agent = await insertAgent(client, "m37a");
      const version = await insertVersion(client, agent, 1, { instructions: "", active: true, published: true });
      const run = (key: string, status: string) =>
        failureOf(
          client,
          `insert into ai.run (key, agent_id, agent_version_id, context_type, trigger, status)
           values ($1, $2, $3, 'Console', 'Manual', $4)`,
          [key, agent, version, status],
        );

      expect(await run("RUN-M37A", "Blocked")).toBeNull();
      // The suspension reasons are not statuses: a waiting run already has the row saying why.
      expect(await run("RUN-M37B", "SuspendedApproval")).toContain("run_status_check");
    });
  });

  it("rule 3 approval_decision_independence refuses a decision by a person row that stands for an agent", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const agentPerson = await client.query<{ id: string }>(
        `insert into core.person (email, name_en, name_ar, initials, status)
         values ('agent-as-person@tahseel.test', 'Agent person', 'وكيل', 'AP', 'Active') returning id`,
      );
      await client.query(
        `insert into ai.agent (id, code, name_en, name_ar, initials) values ($1, 'm-agent-approver', 'Approver agent', 'وكيل', 'AA')`,
        [agentPerson.rows[0].id],
      );
      const approval = await client.query<{ id: string }>(
        `insert into ai.approval (key, requested_by_type, action) values ('APR-M0001', 'Agent', 'publish') returning id`,
      );
      const decide = (approver: string) =>
        failureOf(
          client,
          `insert into ai.approval_decision (approval_id, approver_person_id, decision) values ($1, $2, 'Approved')`,
          [approval.rows[0].id, approver],
        );

      expect(await decide(agentPerson.rows[0].id)).toContain("an agent may not approve");
      expect(await decide(fixture.personId)).toBeNull();
    });
  });

  it("agent_version_budget_check refuses a soft run budget above the hard one, and accepts an equal or absent one", async () => {
    await inRolledBackTransaction(async (client) => {
      const agent = await insertAgent(client, "m-budget");
      const version = (number: number, soft: number | null, hard: number | null) =>
        failureOf(
          client,
          `insert into ai.agent_version (agent_id, version_number, run_budget_soft_aed, run_budget_hard_aed)
           values ($1, $2, $3, $4)`,
          [agent, number, soft, hard],
        );

      expect(await version(1, 6, 5)).toContain("agent_version_budget_check");
      expect(await version(2, 5, 5)).toBeNull();
      // D73 seeds both at 0, which means no limit.
      expect(await version(3, 0, 0)).toBeNull();
      expect(await version(4, 6, null)).toBeNull();
    });
  });

  it("channel_type_key keeps one channel per type", async () => {
    await inRolledBackTransaction(async (client) => {
      const allowed = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(oid) as definition from pg_constraint
         where conrelid = 'ai.channel'::regclass and conname = 'channel_type_check'`,
      );
      const types = [...allowed.rows[0].definition.matchAll(/'([A-Za-z]+)'::text/g)].map((match) => match[1]);
      const taken = new Set((await client.query<{ type: string }>("select type from ai.channel")).rows.map((row) => row.type));
      const free = types.find((type) => !taken.has(type));
      expect(free, "a channel type with no channel yet").toBeDefined();

      expect(await failureOf(client, "insert into ai.channel (type) values ($1)", [free])).toBeNull();
      expect(await failureOf(client, "insert into ai.channel (type) values ($1)", [free])).toContain("channel_type_key");
    });
  });

  it("organisation_singleton and system_state_singleton refuse a second row and keep the one there is writable", async () => {
    await inRolledBackTransaction(async (client) => {
      expect(
        await failureOf(client, "insert into core.organisation (name_en, name_ar) values ('Second organisation', 'منظمة ثانية')"),
      ).toContain("organisation_singleton");
      expect(await failureOf(client, "update core.organisation set name_en = name_en")).toBeNull();

      expect(await failureOf(client, "insert into gov.system_state default values")).toContain("system_state_singleton");
      expect(await failureOf(client, "update gov.system_state set version = version")).toBeNull();
    });
  });
  it("0065 D301 deleting a step deletes the rules that route to it, whatever order the rows are visited in", async () => {
    await inRolledBackTransaction(async (client) => {
      const fk = await client.query<{ action: string }>(
        `select confdeltype as action from pg_constraint where conname = 'routing_rule_to_step_id_transition_step_id_fk'`,
      );
      expect(fk.rows[0].action).toBe("c");
      // A version whose rules point both ways deletes whole.
      const type = await client.query<{ id: string }>(
        "insert into work.request_type (code, name_en, name_ar) values ('MIG65', 'Mig', 'Mig') returning id",
      );
      const version = await client.query<{ id: string }>(
        "insert into work.request_type_version (request_type_id, version_number) values ($1, 1) returning id",
        [type.rows[0].id],
      );
      const steps = await client.query<{ id: string }>(
        `insert into work.transition_step (request_type_version_id, sort_order, name_en, name_ar)
         values ($1, 1, 'A', 'A'), ($1, 2, 'B', 'B') returning id`,
        [version.rows[0].id],
      );
      const [a, b] = steps.rows.map((row) => row.id);
      await client.query(
        "insert into work.routing_rule (from_step_id, sort_order, kind, action_name, to_step_id) values ($1, 1, 'Action', 'Go', $2), ($2, 1, 'Action', 'Back', $1)",
        [a, b],
      );
      expect(await failureOf(client, "delete from work.transition_step where id = $1", [b])).toBeNull();
      const left = await client.query<{ count: number }>("select count(*)::int as count from work.routing_rule where from_step_id = $1", [a]);
      expect(left.rows[0].count).toBe(0);
    });
  });

  it("0075 D375 retires the Setup Director: who reported to it moves up, and its flags and permissions go", async () => {
    await inRolledBackTransaction(async (client) => {
      const { personId } = await seedFixture(client);
      const director = await insertAgent(client, "dir");
      await client.query("update ai.agent set is_system = true, reports_to_type = 'Person', reports_to_id = $2 where id = $1", [director, personId]);
      const reporting = await insertAgent(client, "MIG75");
      await client.query("update ai.agent set reports_to_type = 'Agent', reports_to_id = $2 where id = $1", [reporting, director]);
      await client.query(
        `insert into gov.feature_flag (key, name_en, name_ar, "group") values ('setup-director', 'Setup Director', 'مدير الإعداد', 'Platform')`,
      );
      const role = await client.query<{ id: string }>("insert into core.role (code, name_en, name_ar) values ('MIG75', 'Role', 'دور') returning id");
      const permission = await client.query<{ id: string }>(
        "insert into core.permission (code, description_en, description_ar) values ('setup:apply', 'Apply', 'تطبيق') returning id",
      );
      await client.query("insert into core.role_permission (role_id, permission_id, effect) values ($1, $2, 'Allow')", [
        role.rows[0].id,
        permission.rows[0].id,
      ]);

      for (const marker of ['FROM "ai"."agent" AS d', `"status" = 'Retired'`, 'DELETE FROM "gov"."feature_flag"', 'DELETE FROM "core"."permission"']) {
        await client.query(statementOf("0075_", marker));
      }

      const agents = await client.query<{ code: string; status: string; is_system: boolean; reports_to_type: string; reports_to_id: string }>(
        "select code, status, is_system, reports_to_type, reports_to_id from ai.agent where code in ('dir', 'MIG75') order by code collate \"C\"",
      );
      expect(agents.rows).toEqual([
        { code: "MIG75", status: "Idle", is_system: false, reports_to_type: "Person", reports_to_id: personId },
        { code: "dir", status: "Retired", is_system: false, reports_to_type: "Person", reports_to_id: personId },
      ]);
      const flags = await client.query("select 1 from gov.feature_flag where key = 'setup-director'");
      expect(flags.rowCount).toBe(0);
      const grants = await client.query("select 1 from core.role_permission where role_id = $1", [role.rows[0].id]);
      expect(grants.rowCount).toBe(0);
    });
  });
});
