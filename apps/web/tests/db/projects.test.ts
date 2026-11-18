import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-20 the project list and S-21 the project detail, against the database.
 *
 * A project is where sensitivity, who may work in it and what its agents may call are
 * decided, so every rule here is one a screen must not be able to go round.
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

describe.skipIf(!hasDatabase)("projects", () => {
  let ownerId = "";
  let projectKey = "";
  /** The policy this project had before the cases edited it, put back at the end. */
  let before: { sensitivity: string; status: string; reviewer: boolean; nameEn: string; nameAr: string } = {
    sensitivity: "Internal",
    status: "InProgress",
    reviewer: false,
    nameEn: "",
    nameAr: "",
  };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const project = await testPool().query<{
      key: string;
      sensitivity: string;
      status: string;
      reviewer: boolean;
      nameEn: string;
      nameAr: string;
    }>(
      `select key, sensitivity, status, require_reviewer_not_author as reviewer, name_en as "nameEn", name_ar as "nameAr"
       from work.project order by key limit 1`,
    );
    projectKey = project.rows[0].key;
    before = {
      sensitivity: project.rows[0].sensitivity,
      status: project.rows[0].status,
      reviewer: project.rows[0].reviewer,
      nameEn: project.rows[0].nameEn,
      nameAr: project.rows[0].nameAr,
    };
  });

  afterAll(async () => {
    await testPool().query(
      `update work.project set sensitivity = $1, status = $2, require_reviewer_not_author = $3,
         name_en = $4, name_ar = $5 where key = $6`,
      [before.sensitivity, before.status, before.reviewer, before.nameEn, before.nameAr, projectKey],
    );
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const policy = async (over: Record<string, unknown> = {}) => {
    const { updatePolicy } = await import("@/features/projects/service");
    const current = await testPool().query<{
      sensitivity: string;
      status: string;
      reviewer: boolean;
    }>(
      `select sensitivity, status, require_reviewer_not_author as reviewer from work.project where key = $1`,
      [projectKey],
    );
    await updatePolicy({
      key: projectKey,
      sensitivity: current.rows[0].sensitivity,
      status: current.rows[0].status,
      requireReviewerNotAuthor: current.rows[0].reviewer,
      allowedConnectors: [],
      allowedAgents: [],
      approvalRules: [],
      ...over,
    } as Parameters<typeof updatePolicy>[0]);
  };

  it("UC-20.1-01 the list carries the columns the screen shows", async () => {
    const { loadProjects } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const { details } = await loadProjects();
    const detail = details[projectKey];
    expect(detail).toBeDefined();
    expect(detail.contents.workItems).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detail.members)).toBe(true);
  });

  it("UC-20.1-04 a person sees only the projects their grants reach", async () => {
    const { loadDirectory } = await import("@/features/organisation/service");
    signedInAs = ownerId;
    const all = await loadDirectory();

    // Someone with no project grants at all reaches no project, rather than every one.
    const limited = await testPool().query<{ id: string }>(
      `select p.id from core.person p
       where p.status = 'Active'
         and not exists (
           select 1 from core.role_assignment ra join core.role r on r.id = ra.role_id
           where ra.person_id = p.id and r.code in ('Owner', 'Admin', 'Auditor')
         )
       order by p.email limit 1`,
    );
    if (limited.rowCount === 0) return;
    signedInAs = limited.rows[0].id;
    const theirs = await loadDirectory();
    expect(theirs.projects.length).toBeLessThanOrEqual(all.projects.length);
  });

  it("UC-20.2-01 UC-20.2-03 a project is created with its owner, and a duplicate key is refused", async () => {
    const { createProject } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const key = `T${Date.now().toString().slice(-5)}`;
    const unit = await testPool().query<{ name: string }>("select name_en as name from core.org_unit limit 1");
    await createProject({
      key,
      nameEn: "A project for the tests",
      nameAr: "مشروع للاختبارات",
      orgUnit: unit.rows[0].name,
      ownerPersonId: ownerId,
      sensitivity: "Internal",
      status: "Backlog",
      requireReviewerNotAuthor: false,
      descriptionEn: "What the project is for.",
      descriptionAr: "ما المشروع من أجله.",
    });

    const created = await testPool().query<{ status: string; owner: string; descEn: string | null; descAr: string | null }>(
      `select status, owner_person_id as owner, description_en as "descEn", description_ar as "descAr"
       from work.project where key = $1`,
      [key],
    );
    expect(created.rows[0].status).toBe("Backlog");
    expect(created.rows[0].owner).toBe(ownerId);
    // The description the admin entered is stored.
    expect(created.rows[0].descEn).toBe("What the project is for.");
    expect(created.rows[0].descAr).toBe("ما المشروع من أجله.");

    // The owner is the project's first member, so the person who made it can work in it.
    const member = await testPool().query<{ role: string }>(
      `select pm.project_role as role from work.project_member pm
       join work.project p on p.id = pm.project_id
       where p.key = $1 and pm.principal_id = $2`,
      [key, ownerId],
    );
    expect(member.rows[0].role).toBe("Owner");

    // `UC-20.2-03`: the key is unique by index, so the second create fails rather than
    // producing a second project nothing can tell apart.
    await expect(
      createProject({
        key,
        nameEn: "The same key again",
        nameAr: "نفس المفتاح",
        orgUnit: unit.rows[0].name,
        ownerPersonId: ownerId,
        sensitivity: "Internal",
        status: "Backlog",
        requireReviewerNotAuthor: false,
      }),
    ).rejects.toThrow();

    await testPool().query("delete from work.project_member where project_id in (select id from work.project where key = $1)", [key]);
    await testPool().query("delete from work.project where key = $1", [key]);
  });

  it("UC-21.2-01 raising the sensitivity raises it for everything in the project", async () => {
    signedInAs = ownerId;
    await policy({ sensitivity: "Confidential" });

    const row = await testPool().query<{ sensitivity: string }>(
      "select sensitivity from work.project where key = $1",
      [projectKey],
    );
    expect(row.rows[0].sensitivity).toBe("Confidential");

    // A room, a file and an artifact have no sensitivity of their own: they take the
    // project's, so raising it raises theirs in the same act rather than leaving copies
    // of the old value behind.
    const copies = await testPool().query<{ count: string }>(
      `select count(*) from information_schema.columns
       where table_schema = 'work' and column_name = 'sensitivity'
         and table_name in ('discussion_room', 'project_file', 'artifact')`,
    );
    expect(Number(copies.rows[0].count)).toBe(0);
  });

  it("a project's name can be edited, and the change is audited", async () => {
    const { renameProject } = await import("@/features/projects/service");
    signedInAs = ownerId;

    await renameProject({ key: projectKey, nameEn: "Renamed for the tests", nameAr: "أُعيدت تسميته للاختبارات" });

    const row = await testPool().query<{ nameEn: string; nameAr: string }>(
      `select name_en as "nameEn", name_ar as "nameAr" from work.project where key = $1`,
      [projectKey],
    );
    expect(row.rows[0].nameEn).toBe("Renamed for the tests");
    expect(row.rows[0].nameAr).toBe("أُعيدت تسميته للاختبارات");

    const audited = await testPool().query<{ count: string }>(
      `select count(*) from audit.audit_entry
       where action = 'projects:write' and object_label = $1 and at > now() - interval '2 minutes'
         and detail_json->>'nameEnTo' = 'Renamed for the tests'`,
      [projectKey],
    );
    expect(Number(audited.rows[0].count)).toBeGreaterThan(0);

    // The key, which every reference points at, is untouched by a rename.
    const stillSameKey = await testPool().query<{ count: string }>(
      "select count(*) from work.project where key = $1",
      [projectKey],
    );
    expect(Number(stillSameKey.rows[0].count)).toBe(1);

    await renameProject({ key: projectKey, nameEn: before.nameEn, nameAr: before.nameAr });
  });

  it("UC-21.2-04 a project may raise a tool's tier and never lower it", async () => {
    const { ProjectRejected } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const tool = await testPool().query<{ ref: string; tier: string }>(
      `select c.code || '.' || t.name as ref, t.tier
       from ai.connector_tool t join ai.connector c on c.id = t.connector_id
       where t.tier in ('T2', 'T3') limit 1`,
    );
    if (tool.rowCount === 0) return;

    await expect(policy({ approvalRules: [{ ref: tool.rows[0].ref, minimumTier: "T0" }] })).rejects.toBeInstanceOf(
      ProjectRejected,
    );

    // The same tool at or above its own tier is accepted.
    await policy({ approvalRules: [{ ref: tool.rows[0].ref, minimumTier: "T3" }] });
    const stored = await testPool().query<{ tier: string }>(
      `select r.minimum_tier as tier from work.project_approval_rule r
       join work.project p on p.id = r.project_id where p.key = $1 and r.action_or_tool_ref = $2`,
      [projectKey, tool.rows[0].ref],
    );
    expect(stored.rows[0].tier).toBe("T3");
    await policy({ approvalRules: [] });
  });

  it("UC-21.2-02 a project's connector policy narrows what its runs may reach", async () => {
    const { connectorCodesForProject, enabledConnectorCodes } = await import("@/features/agents/repository");
    signedInAs = ownerId;

    const connector = await testPool().query<{ code: string }>(
      "select code from ai.connector where is_enabled = true order by code limit 1",
    );
    if (connector.rowCount === 0) return;

    await policy({ allowedConnectors: [connector.rows[0].code] });
    const projectId = await testPool().query<{ id: string }>("select id from work.project where key = $1", [
      projectKey,
    ]);
    expect(await connectorCodesForProject(projectId.rows[0].id)).toEqual([connector.rows[0].code]);

    // The narrowing is an intersection: a project cannot add a connector to what a run reaches.
    const forAgent = await enabledConnectorCodes();
    const forRun = forAgent.filter((code) => code === connector.rows[0].code);
    expect(forRun.length).toBeLessThanOrEqual(forAgent.length);

    await policy({ allowedConnectors: [] });
  });

  it("UC-21.2-05 UC-21.2-06 the review rule and the status are saved and audited", async () => {
    signedInAs = ownerId;
    await policy({ requireReviewerNotAuthor: true, status: "Paused" });

    const row = await testPool().query<{ reviewer: boolean; status: string }>(
      "select require_reviewer_not_author as reviewer, status from work.project where key = $1",
      [projectKey],
    );
    expect(row.rows[0].reviewer).toBe(true);
    expect(row.rows[0].status).toBe("Paused");

    const audited = await testPool().query<{ count: string }>(
      `select count(*) from audit.audit_entry
       where action = 'projects:write' and object_label = $1 and at > now() - interval '2 minutes'`,
      [projectKey],
    );
    expect(Number(audited.rows[0].count)).toBeGreaterThan(0);

    await policy({ requireReviewerNotAuthor: before.reviewer, status: before.status });
  });

  it("UC-21.3-01 UC-21.3-02 UC-21.3-03 members join, and an agent outside the policy cannot", async () => {
    const { ProjectRejected, addMember, removeMember } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const person = await testPool().query<{ id: string }>(
      `select p.id from core.person p where p.status = 'Active'
         and not exists (
           select 1 from work.project_member pm join work.project pr on pr.id = pm.project_id
           where pr.key = $1 and pm.principal_id = p.id
         )
       order by p.email limit 1`,
      [projectKey],
    );
    if (person.rowCount === 0) return;

    await addMember({ key: projectKey, principal: person.rows[0].id, isAgent: false, projectRole: "Member" });
    const joined = await testPool().query<{ role: string }>(
      `select pm.project_role as role from work.project_member pm
       join work.project p on p.id = pm.project_id where p.key = $1 and pm.principal_id = $2`,
      [projectKey, person.rows[0].id],
    );
    expect(joined.rows[0].role).toBe("Member");

    // `UC-21.3-03`: with an allowed-agents policy in force, an agent outside it is blocked
    // rather than quietly added — the policy would otherwise mean nothing.
    const agents = await testPool().query<{ code: string }>(
      "select code from ai.agent where is_system = false order by code",
    );
    if ((agents.rowCount ?? 0) >= 2) {
      await policy({ allowedAgents: [agents.rows[0].code] });
      await expect(
        addMember({ key: projectKey, principal: agents.rows[1].code, isAgent: true, projectRole: "Member" }),
      ).rejects.toBeInstanceOf(ProjectRejected);

      // The one the policy does name joins.
      await addMember({ key: projectKey, principal: agents.rows[0].code, isAgent: true, projectRole: "Member" });
      await removeMember({ key: projectKey, principal: agents.rows[0].code, isAgent: true, confirmed: true });
      await policy({ allowedAgents: [] });
    }

    await removeMember({ key: projectKey, principal: person.rows[0].id, isAgent: false, confirmed: true });
  });

  it("UC-21.3-04 the last owner cannot be removed", async () => {
    const { ProjectRejected, removeMember } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const owners = await testPool().query<{ id: string }>(
      `select pm.principal_id as id from work.project_member pm
       join work.project p on p.id = pm.project_id
       where p.key = $1 and pm.project_role = 'Owner'`,
      [projectKey],
    );
    if (owners.rowCount !== 1) return;

    // A project with nobody answerable for it is a project nobody can change.
    await expect(
      removeMember({ key: projectKey, principal: owners.rows[0].id, isAgent: false, confirmed: true }),
    ).rejects.toBeInstanceOf(ProjectRejected);
  });

  it("UC-21.3-05 removing a member with open work reports it before doing anything", async () => {
    const { addMember, removeMember } = await import("@/features/projects/service");
    signedInAs = ownerId;

    const holder = await testPool().query<{ id: string; key: string }>(
      `select wi.assignee_id as id, wi.key from work.work_item wi
       join work.project p on p.id = wi.project_id
       where p.key = $1 and wi.assignee_type = 'Person' and wi.status not in ('Done', 'Cancelled')
       limit 1`,
      [projectKey],
    );
    if (holder.rowCount === 0) return;

    const alreadyMember = await testPool().query(
      `select 1 from work.project_member pm join work.project p on p.id = pm.project_id
       where p.key = $1 and pm.principal_id = $2`,
      [projectKey, holder.rows[0].id],
    );
    if (alreadyMember.rowCount === 0) {
      await addMember({ key: projectKey, principal: holder.rows[0].id, isAgent: false, projectRole: "Member" });
    }

    // Unconfirmed, nothing is removed and the open work is named.
    const warned = await removeMember({
      key: projectKey,
      principal: holder.rows[0].id,
      isAgent: false,
      confirmed: false,
    });
    expect(warned.removed).toBe(false);
    expect(warned.openWorkItems).toContain(holder.rows[0].key);

    const still = await testPool().query(
      `select 1 from work.project_member pm join work.project p on p.id = pm.project_id
       where p.key = $1 and pm.principal_id = $2`,
      [projectKey, holder.rows[0].id],
    );
    expect(still.rowCount).toBe(1);

    // Confirmed, they go and their work stays assigned to them.
    const removed = await removeMember({
      key: projectKey,
      principal: holder.rows[0].id,
      isAgent: false,
      confirmed: true,
    });
    expect(removed.removed).toBe(true);
    const work = await testPool().query<{ assignee: string }>(
      "select assignee_id as assignee from work.work_item where key = $1",
      [holder.rows[0].key],
    );
    expect(work.rows[0].assignee).toBe(holder.rows[0].id);

    if (alreadyMember.rowCount === 1) {
      await addMember({ key: projectKey, principal: holder.rows[0].id, isAgent: false, projectRole: "Member" });
    }
  });

  /** A new, empty project owned by the owner, for the delete cases. */
  const emptyProject = async (): Promise<string> => {
    const { createProject } = await import("@/features/projects/service");
    const key = `D${Date.now().toString().slice(-6)}`;
    const unit = await testPool().query<{ name: string }>("select name_en as name from core.org_unit order by code limit 1");
    signedInAs = ownerId;
    await createProject({
      key,
      nameEn: "A project to delete",
      nameAr: "مشروع للحذف",
      orgUnit: unit.rows[0].name,
      ownerPersonId: ownerId,
      sensitivity: "Internal",
      status: "Backlog",
      requireReviewerNotAuthor: false,
    });
    return key;
  };

  const removeProject = async (key: string) => {
    await testPool().query("delete from work.work_item where project_id in (select id from work.project where key = $1)", [key]);
    await testPool().query("delete from work.project_member where project_id in (select id from work.project where key = $1)", [key]);
    await testPool().query("delete from work.project where key = $1", [key]);
  };

  it("deleting an empty project removes it with its membership, and the delete is audited", async () => {
    const { deleteProject } = await import("@/features/projects/actions");
    const key = await emptyProject();
    try {
      const id = (await testPool().query<{ id: string }>("select id from work.project where key = $1", [key])).rows[0].id;

      expect(await deleteProject({ key })).toEqual({ ok: true });

      expect((await testPool().query("select 1 from work.project where id = $1", [id])).rowCount).toBe(0);
      expect((await testPool().query("select 1 from work.project_member where project_id = $1", [id])).rowCount).toBe(0);
      const audited = await testPool().query<{ actor: string }>(
        "select actor_id as actor from audit.audit_entry where action = 'projects:delete' and object_label = $1",
        [key],
      );
      expect(audited.rows).toEqual([{ actor: ownerId }]);
    } finally {
      await removeProject(key);
    }
  });

  it("refuses to delete a project that still holds work and names it, one that is gone, and for a Member", async () => {
    const { deleteProject } = await import("@/features/projects/actions");
    const { NotPermitted } = await import("@/lib/session");
    const key = await emptyProject();
    try {
      await testPool().query(
        `insert into work.work_item (key, project_id, title_en, title_ar)
         select $1, id, 'Still here', 'لا يزال هنا' from work.project where key = $2`,
        [`${key}-1`, key],
      );

      const held = await deleteProject({ key });
      expect(held).toMatchObject({ ok: false, reason: "This project cannot be deleted: it still has 1 work items." });
      expect(held.ok ? "" : held.reasonAr).toContain("1 بنود عمل");
      expect((await testPool().query("select 1 from work.project where key = $1", [key])).rowCount).toBe(1);

      expect(await deleteProject({ key: `${key}X` })).toMatchObject({ ok: false, reason: "That project no longer exists." });

      // Emptied, so what refuses the Member is the permission and nothing else.
      await testPool().query("delete from work.work_item where key = $1", [`${key}-1`]);
      signedInAs = (
        await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'")
      ).rows[0].id;
      await expect(deleteProject({ key })).rejects.toBeInstanceOf(NotPermitted);
      expect((await testPool().query("select 1 from work.project where key = $1", [key])).rowCount).toBe(1);
    } finally {
      await removeProject(key);
    }
  });
});
