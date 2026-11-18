import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `UC-41.2-03`, NFR-09: a role assigned in one org unit applies only there.
 *
 * Each identity is created here with one role scoped to one unit, so the cases do not depend
 * on how the demo people are set up: a WorkLead in Procurement, an AgentDesigner in IT, an
 * Approver in Finance and a Publisher in Finance. A change outside the scope is refused and
 * writes nothing; the same change inside it goes through. Records that belong to no unit (a
 * skill, a request type) need an organisation-wide grant.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("a role scoped to an org unit applies only within it", () => {
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  let ownerId = "";
  let adminId = "";
  let fatimaId = "";
  let khalidId = "";
  let leadId = "";
  let designerId = "";
  let approverId = "";
  let publisherId = "";
  const units: Record<string, string> = {};
  const people: string[] = [];
  const projects: string[] = [];
  const agents: string[] = [];
  const skills: string[] = [];
  const requestTypes: string[] = [];
  const runs: string[] = [];

  /** A person holding one role in one org unit. */
  const scoped = async (role: string, unit: string, label: string) => {
    const person = await testPool().query<{ id: string }>(
      `insert into core.person (email, name_en, name_ar, initials, status, org_unit_id)
       values ($1, $2, 'شخص', 'SC', 'Active', $3) returning id`,
      [`scope-${label.toLowerCase()}-${stamp}-${Math.random().toString(36).slice(2, 6)}@tahseel.ae`, `Scope ${label}`, units[unit]],
    );
    await testPool().query(
      `insert into core.role_assignment (person_id, role_id, scope_type, scope_id)
       select $1, id, 'OrgUnit', $3 from core.role where code = $2`,
      [person.rows[0].id, role, units[unit]],
    );
    people.push(person.rows[0].id);
    return person.rows[0].id;
  };

  const personId = async (email: string) =>
    (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;

  beforeAll(async () => {
    for (const row of (await testPool().query<{ id: string; name_en: string }>("select id, name_en from core.org_unit")).rows) {
      units[row.name_en] = row.id;
    }
    ownerId = await personId("mariam@tahseel.ae");
    adminId = await personId("noura@tahseel.ae");
    fatimaId = await personId("fatima@tahseel.ae");
    khalidId = await personId("khalid@tahseel.ae");
    leadId = await scoped("WorkLead", "Procurement", "Lead");
    designerId = await scoped("AgentDesigner", "IT", "Designer");
    approverId = await scoped("Approver", "Finance", "Approver");
    publisherId = await scoped("Publisher", "Finance", "Publisher");
  });

  afterAll(async () => {
    if (runs.length) {
      const approvals = "(select id from ai.approval where run_id = any($1))";
      await testPool().query(`delete from ai.inbox_item where source_id in ${approvals}`, [runs]);
      await testPool().query("delete from ai.approval where run_id = any($1)", [runs]);
      await testPool().query("delete from ai.run where id = any($1)", [runs]);
    }
    if (projects.length) {
      const ids = "(select id from work.project where key = any($1))";
      await testPool().query(`delete from work.project_member where project_id in ${ids}`, [projects]);
      await testPool().query("delete from work.project where key = any($1)", [projects]);
    }
    if (agents.length) {
      await testPool().query("update ai.agent set active_version_id = null where code = any($1)", [agents]);
      await testPool().query("delete from ai.agent_version where agent_id in (select id from ai.agent where code = any($1))", [agents]);
      await testPool().query("delete from ai.agent where code = any($1)", [agents]);
    }
    if (skills.length) {
      const ids = "(select id from ai.skill where skill_name = any($1))";
      await testPool().query(`delete from ai.skill_version where skill_id in ${ids}`, [skills]);
      await testPool().query("delete from ai.skill where skill_name = any($1)", [skills]);
    }
    if (requestTypes.length) {
      const ids = "(select id from work.request_type where code = any($1))";
      await testPool().query(`update work.request_type set current_published_version_id = null where id in ${ids}`, [requestTypes]);
      await testPool().query(`delete from work.request_type_version where request_type_id in ${ids}`, [requestTypes]);
      await testPool().query("delete from work.request_type where code = any($1)", [requestTypes]);
    }
    for (const table of ["ai.inbox_item", "gov.mail_notification", "core.notification_preference", "core.role_assignment"]) {
      await testPool().query(`delete from ${table} where person_id = any($1)`, [people]);
    }
    await testPool().query("delete from core.person where id = any($1)", [people]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const newProject = (key: string, orgUnit: string, owner: string) => ({
    key,
    nameEn: `Scope ${key}`,
    nameAr: "نطاق",
    orgUnit,
    ownerPersonId: owner,
    sensitivity: "Internal" as const,
    status: "InProgress" as const,
    requireReviewerNotAuthor: false,
  });

  const projectRow = async (key: string) =>
    (
      await testPool().query<{ name_en: string; status: string; version: number; members: number }>(
        `select p.name_en, p.status, p.version, (select count(*) from work.project_member m where m.project_id = p.id)::int as members
           from work.project p where p.key = $1`,
        [key],
      )
    ).rows[0];

  it("UC-41.2-03 a WorkLead in Procurement creates and changes projects only in Procurement", async () => {
    const service = await import("@/features/projects/service");
    const { NotPermitted } = await import("@/lib/session");

    // A Customer Service project of somebody else's, which the WorkLead is not a member of.
    const foreign = `SF${stamp}`;
    projects.push(foreign);
    signedInAs = ownerId;
    await service.createProject(newProject(foreign, "Customer Service", ownerId));

    signedInAs = leadId;
    const elsewhere = `SX${stamp}`;
    projects.push(elsewhere);
    await expect(service.createProject(newProject(elsewhere, "Customer Service", leadId))).rejects.toBeInstanceOf(NotPermitted);
    expect(await projectRow(elsewhere)).toBeUndefined();

    const before = await projectRow(foreign);
    await expect(service.renameProject({ key: foreign, nameEn: "Taken over", nameAr: "استيلاء" })).rejects.toBeInstanceOf(NotPermitted);
    await expect(
      service.updatePolicy({
        key: foreign,
        sensitivity: "Restricted",
        status: "InProgress",
        requireReviewerNotAuthor: true,
        allowedConnectors: [],
        allowedAgents: [],
        approvalRules: [],
      }),
    ).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.addMember({ key: foreign, principal: leadId, isAgent: false, projectRole: "Owner" })).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.deleteProject(foreign)).rejects.toBeInstanceOf(NotPermitted);
    expect(await projectRow(foreign)).toEqual(before);
    // The list's detail is the projects the person may read, as the list itself is.
    expect(Object.keys((await service.loadProjects()).details)).not.toContain(foreign);

    // Inside the scope, the same changes go through.
    const own = `SP${stamp}`;
    projects.push(own);
    await service.createProject(newProject(own, "Procurement", leadId));
    await service.renameProject({ key: own, nameEn: "Scope renamed", nameAr: "نطاق" });
    await service.addMember({ key: own, principal: fatimaId, isAgent: false, projectRole: "Member" });
    expect(await projectRow(own)).toMatchObject({ name_en: "Scope renamed", members: 2 });
    expect(Object.keys((await service.loadProjects()).details)).toContain(own);
    await service.deleteProject(own);
    expect(await projectRow(own)).toBeUndefined();
  });

  it("UC-41.2-03 an AgentDesigner in IT creates and configures agents only in IT", async () => {
    const service = await import("@/features/agents/service");
    const { NotPermitted } = await import("@/lib/session");
    const agentRow = async (code: string) =>
      (
        await testPool().query<{ trust: string; versions: number; lock: number }>(
          `select av.trust, (select count(*) from ai.agent_version v where v.agent_id = a.id)::int as versions, av.version as lock
             from ai.agent a left join ai.agent_version av on av.id = a.active_version_id where a.code = $1`,
          [code],
        )
      ).rows[0];
    const create = (code: string, unit: string) =>
      service.createAgent({ code, nameEn: "Scope agent", nameAr: "وكيل", orgUnitId: units[unit], profile: "Task", trust: "Standard", routeAlias: "reasoning-default" });

    signedInAs = designerId;
    const elsewhere = `scope-fin-${stamp}`.toLowerCase();
    agents.push(elsewhere);
    await expect(create(elsewhere, "Finance")).rejects.toBeInstanceOf(NotPermitted);
    expect(await agentRow(elsewhere)).toBeUndefined();

    // `exp` is a Finance agent.
    const before = await agentRow("exp");
    await expect(service.saveDraft({ code: "exp", instructions: "Do what the designer says." })).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.setTrust({ code: "exp", trust: "Restricted", version: before.lock })).rejects.toBeInstanceOf(NotPermitted);
    expect(await agentRow("exp")).toEqual(before);

    const own = `scope-it-${stamp}`.toLowerCase();
    agents.push(own);
    await create(own, "IT");
    await service.saveDraft({ code: own, instructions: "Triage IT tickets." });
    const lock = (await agentRow(own)).lock;
    await service.setTrust({ code: own, trust: "Restricted", version: lock });
    expect(await agentRow(own)).toMatchObject({ trust: "Restricted" });
  });

  it("D330 a skill is written only with an organisation-wide skills:write", async () => {
    const service = await import("@/features/skills/service");
    const { NotPermitted } = await import("@/lib/session");
    const skill = `scope-skill-${stamp}`.toLowerCase();
    skills.push(skill);
    const input = {
      skillName: skill,
      titleEn: "Scope skill",
      titleAr: "مهارة",
      descriptionEn: "Used by the scope tests.",
      descriptionAr: "للاختبار.",
      sourceType: "Uploaded" as const,
      versionLabel: "1.0.0",
      tags: [],
    };
    const exists = async () => (await testPool().query("select 1 from ai.skill where skill_name = $1", [skill])).rowCount === 1;

    signedInAs = designerId;
    await expect(service.createSkill(input)).rejects.toBeInstanceOf(NotPermitted);
    expect(await exists()).toBe(false);

    signedInAs = ownerId;
    await service.createSkill(input);

    signedInAs = designerId;
    await expect(service.publishSkill(skill)).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.deleteSkill(skill)).rejects.toBeInstanceOf(NotPermitted);
    expect(await exists()).toBe(true);

    signedInAs = ownerId;
    await service.publishSkill(skill);
    await service.deleteSkill(skill);
    expect(await exists()).toBe(false);
  });

  it("D330 a request type is written only with an organisation-wide request_types:write", async () => {
    const service = await import("@/features/requests/service");
    const { NotPermitted } = await import("@/lib/session");
    const code = `SC${stamp}`;
    requestTypes.push(code);
    const input = { code, nameEn: "Scope type", nameAr: "نوع", categoryEn: "Finance", decomposition: "None" as const };
    const versions = async () =>
      (
        await testPool().query<{ count: number }>(
          "select count(*)::int as count from work.request_type_version v join work.request_type t on t.id = v.request_type_id where t.code = $1",
          [code],
        )
      ).rows[0]?.count ?? 0;

    signedInAs = publisherId;
    await expect(service.createRequestType(input)).rejects.toBeInstanceOf(NotPermitted);
    expect(await versions()).toBe(0);

    signedInAs = ownerId;
    await service.createRequestType(input);
    const before = await versions();

    signedInAs = publisherId;
    await expect(
      service.addAttribute({ code, key: "scope_note", labelEn: "Note", labelAr: "ملاحظة", dataType: "Text", required: false, stepName: null }),
    ).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null })).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.publishRequestType({ code })).rejects.toBeInstanceOf(NotPermitted);
    await expect(service.deleteRequestType(code)).rejects.toBeInstanceOf(NotPermitted);
    expect(await versions()).toBe(before);
    const attributes = await testPool().query(
      `select 1 from work.attribute_definition a join work.request_type_version v on v.id = a.request_type_version_id
         join work.request_type t on t.id = v.request_type_id where t.code = $1`,
      [code],
    );
    expect(attributes.rowCount).toBe(0);

    signedInAs = ownerId;
    await service.addAttribute({ code, key: "scope_note", labelEn: "Note", labelAr: "ملاحظة", dataType: "Text", required: false, stepName: null });
    await service.deleteRequestType(code);
    expect(await versions()).toBe(0);
  });

  it("an approval goes to the approvers whose scope covers its project, or to the organisation-wide ones", async () => {
    const { requestApproval } = await import("@/features/agents/run-service");
    const request = await testPool().query<{ id: string }>(
      "select r.id from work.request r join work.project p on p.id = r.project_id where p.key = 'CS' limit 1",
    );
    /** A run of the owner's about `contextId` (a request), raising one approval. */
    const raise = async (contextId: string | null) => {
      const run = await testPool().query<{ id: string }>(
        `insert into ai.run (key, agent_id, agent_version_id, trigger, context_type, context_id, status, created_by, updated_by)
         select 'RUN-S' || floor(random() * 1e9)::text, a.id, a.active_version_id, 'Manual', 'Request', $2, 'Running', $1, $1
           from ai.agent a where a.code = 'sup'
         returning id`,
        [ownerId, contextId],
      );
      runs.push(run.rows[0].id);
      signedInAs = ownerId;
      const approval = await requestApproval({
        run_id: run.rows[0].id,
        tool_name: "payments.release",
        call_id: `call-${contextId ?? "none"}`,
        arguments: { amount: 1200, currency: "AED" },
        tier: "T2",
        reason: "Over the auto-approve limit",
        context_type: "Request",
        context_id: contextId ?? "",
      });
      return (await testPool().query<{ person_id: string }>("select person_id from ai.inbox_item where source_id = $1", [approval.id])).rows.map(
        (row) => row.person_id,
      );
    };

    // Customer Service: the organisation-wide administrator, and Khalid, a member of CS whose
    // own grant is in Procurement. Not Fatima or the test Approver (Finance), nor the test
    // WorkLead (Procurement, not a member), nor the requester.
    const inProject = await raise(request.rows[0].id);
    expect(inProject).toEqual(expect.arrayContaining([adminId, khalidId]));
    for (const outside of [fatimaId, approverId, leadId, ownerId]) expect(inProject).not.toContain(outside);

    // No project: the organisation-wide holders only.
    const noProject = await raise(null);
    expect(noProject).toContain(adminId);
    for (const scopedOnly of [fatimaId, khalidId, approverId, leadId, ownerId]) expect(noProject).not.toContain(scopedOnly);
  });
});
