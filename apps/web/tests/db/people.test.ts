import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-41 People & roles, decided on the server: who may be invited, what suspending someone
 * does, and what an edit to a role may not take away.
 *
 * These rules cannot live on the screen. Partial success for an invitation batch, the
 * refusal to empty the Platform Owner role, and the locked core permission are all
 * properties of the stored grants, and a second admin in another tab is exactly the case a
 * form check would miss.
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

describe.skipIf(!hasDatabase)("people and roles", () => {
  let ownerId = "";
  let memberId = "";

  /** Everything these cases invite, removed afterwards so the seed is what it was. */
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
      await testPool().query("delete from core.person where email = any($1)", [invented]);
      invented.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-41.1-01 invites people into a role and lists them as Invited", async () => {
    const { invitePeople } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const email = `new.joiner.${Date.now()}@tahseel.ae`;
    invented.push(email);

    const outcomes = await invitePeople({ emails: [email], roleCode: "Member", orgUnitId: null });
    // D248: the test platform has no mail server, so the invitation is not emailed, and says so.
    expect(outcomes).toEqual([{ email, invited: true, noEmail: "the platform mail server is not configured" }]);

    const row = await testPool().query<{ status: string; role: string }>(
      `select p.status, r.code as role from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id
       where p.email = $1`,
      [email],
    );
    expect(row.rows[0]).toMatchObject({ status: "Invited", role: "Member" });
  });

  it("UC-41.1-02 flags the bad addresses and still invites the rest", async () => {
    const { invitePeople } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const good = `good.${Date.now()}@tahseel.ae`;
    invented.push(good);

    const outcomes = await invitePeople({
      emails: ["not-an-address", "mariam@tahseel.ae", good],
      roleCode: "Member",
      orgUnitId: null,
    });

    expect(outcomes.find((outcome) => outcome.email === "not-an-address")).toMatchObject({ invited: false });
    expect(outcomes.find((outcome) => outcome.email === "mariam@tahseel.ae")).toMatchObject({ invited: false });
    // The point of the scenario: one bad address does not cost the good ones.
    expect(outcomes.find((outcome) => outcome.email === good)).toMatchObject({ invited: true });

    const stored = await testPool().query("select 1 from core.person where email = $1", [good]);
    expect(stored.rowCount).toBe(1);
  });

  it("UC-41.1-02 treats the same address twice within one batch as a duplicate", async () => {
    const { invitePeople } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const email = `twice.${Date.now()}@tahseel.ae`;
    invented.push(email);

    const outcomes = await invitePeople({ emails: [email, email], roleCode: "Member", orgUnitId: null });
    expect(outcomes.filter((outcome) => outcome.invited)).toHaveLength(1);

    const stored = await testPool().query("select 1 from core.person where email = $1", [email]);
    expect(stored.rowCount).toBe(1);
  });

  it("UC-41.1-03 changes a person's org unit and role, and audits it", async () => {
    const { changePersonPlacement } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ org_unit_id: string | null; role: string; scope_type: string; scope_id: string | null }>(
      `select p.org_unit_id, r.code as role, ra.scope_type, ra.scope_id from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id
       where p.id = $1`,
      [memberId],
    );
    const unit = await testPool().query<{ id: string }>("select id from core.org_unit order by code limit 1");

    await changePersonPlacement({
      personId: memberId,
      roleCode: "Approver",
      orgUnitId: unit.rows[0].id,
      scopeType: "Organisation",
      scopeId: null,
    });

    const after = await testPool().query<{ org_unit_id: string; role: string }>(
      `select p.org_unit_id, r.code as role from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id
       where p.id = $1`,
      [memberId],
    );
    expect(after.rows[0]).toMatchObject({ org_unit_id: unit.rows[0].id, role: "Approver" });

    const entry = await testPool().query<{ action: string; outcome: string }>(
      "select action, outcome from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "permissions:write", outcome: "Allowed" });

    await changePersonPlacement({
      personId: memberId,
      roleCode: before.rows[0].role,
      orgUnitId: before.rows[0].org_unit_id,
      // Put back the scope it had, so suites that rely on the seeded placement do not depend on order.
      scopeType: before.rows[0].scope_type as "Organisation" | "OrgUnit" | "Project",
      scopeId: before.rows[0].scope_id,
    });
  });

  it("UC-41.2-03 scopes an assignment to one org unit", async () => {
    const { changePersonPlacement } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ org_unit_id: string | null; role: string; scope_type: string; scope_id: string | null }>(
      `select p.org_unit_id, r.code as role, ra.scope_type, ra.scope_id from core.person p
       join core.role_assignment ra on ra.person_id = p.id
       join core.role r on r.id = ra.role_id where p.id = $1`,
      [memberId],
    );
    const unit = await testPool().query<{ id: string }>("select id from core.org_unit order by code limit 1");

    await changePersonPlacement({
      personId: memberId,
      roleCode: "Member",
      orgUnitId: before.rows[0].org_unit_id,
      scopeType: "OrgUnit",
      scopeId: unit.rows[0].id,
    });

    const assignment = await testPool().query<{ scope_type: string; scope_id: string }>(
      "select scope_type, scope_id from core.role_assignment where person_id = $1",
      [memberId],
    );
    expect(assignment.rows[0]).toMatchObject({ scope_type: "OrgUnit", scope_id: unit.rows[0].id });

    await changePersonPlacement({
      personId: memberId,
      roleCode: before.rows[0].role,
      orgUnitId: before.rows[0].org_unit_id,
      // Put back the scope it had, so suites that rely on the seeded placement do not depend on order.
      scopeType: before.rows[0].scope_type as "Organisation" | "OrgUnit" | "Project",
      scopeId: before.rows[0].scope_id,
    });
  });

  it("UC-41.1-04 suspending someone ends their sessions and names their open work", async () => {
    const { invitePeople, suspendPerson } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const victim = `suspend.me.${Date.now()}@tahseel.ae`;
    invented.push(victim);
    await invitePeople({ emails: [victim], roleCode: "Member", orgUnitId: null });

    const person = await testPool().query<{ id: string }>("select id from core.person where email = $1", [victim]);
    const personId = person.rows[0].id;

    await testPool().query(
      `insert into core.auth_session (session_token, person_id, expires)
       values ($2, $1, now() + interval '1 day')`,
      [personId, `token-${Date.now()}`],
    );

    const stranded = await suspendPerson(personId);
    expect(Array.isArray(stranded)).toBe(true);

    const after = await testPool().query<{ status: string }>("select status from core.person where id = $1", [
      personId,
    ]);
    expect(after.rows[0].status).toBe("Suspended");

    const sessions = await testPool().query("select 1 from core.auth_session where person_id = $1", [personId]);
    expect(sessions.rowCount).toBe(0);
  });

  it("UC-41.1-05 refuses to suspend the last Platform Owner", async () => {
    const { suspendPerson, PeopleError } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const owners = await testPool().query<{ count: string }>(
      `select count(*) as count from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.person p on p.id = ra.person_id
       where r.code = 'PlatformOwner' and p.status = 'Active'`,
    );
    // The scenario only means anything while the seed has exactly one.
    expect(Number(owners.rows[0].count)).toBe(1);

    await expect(suspendPerson(ownerId)).rejects.toBeInstanceOf(PeopleError);

    const after = await testPool().query<{ status: string }>("select status from core.person where id = $1", [
      ownerId,
    ]);
    expect(after.rows[0].status).toBe("Active");
  });

  it("UC-41.2-02 saves a role's permissions, keeping an explicit deny", async () => {
    const { setRolePermissions, loadRolePermissions } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const before = await loadRolePermissions("Guest");
    const effects: Record<string, "Allow" | "Deny"> = { ...before.effects, "rooms:read": "Deny" };

    await setRolePermissions({ roleCode: "Guest", effects });

    const after = await loadRolePermissions("Guest");
    expect(after.effects["rooms:read"]).toBe("Deny");

    // A deny is stored, not dropped: `evaluate` needs the row to beat a wider allow.
    const row = await testPool().query<{ effect: string }>(
      `select rp.effect from core.role_permission rp
       join core.role r on r.id = rp.role_id
       join core.permission pm on pm.id = rp.permission_id
       where r.code = 'Guest' and pm.code = 'rooms:read'`,
    );
    expect(row.rows[0].effect).toBe("Deny");

    await setRolePermissions({ roleCode: "Guest", effects: before.effects });
  });

  it("UC-41.2-05 will not let a system role lose the permission it exists for", async () => {
    const { setRolePermissions, loadRolePermissions, PeopleError } = await import(
      "@/features/organisation/service"
    );
    signedInAs = ownerId;

    const before = await loadRolePermissions("PlatformOwner");
    expect(before.locked).toBe("permissions:write");

    const without = { ...before.effects };
    delete without["permissions:write"];
    await expect(setRolePermissions({ roleCode: "PlatformOwner", effects: without })).rejects.toBeInstanceOf(
      PeopleError,
    );

    // Denying it is the same removal by another route.
    await expect(
      setRolePermissions({
        roleCode: "PlatformOwner",
        effects: { ...before.effects, "permissions:write": "Deny" },
      }),
    ).rejects.toBeInstanceOf(PeopleError);

    const after = await loadRolePermissions("PlatformOwner");
    expect(after.effects["permissions:write"]).toBe("Allow");
  });

  it("UC-41.2-04 refuses a role edit to someone without permissions:write", async () => {
    const { setRolePermissions } = await import("@/features/organisation/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    await expect(
      setRolePermissions({ roleCode: "Guest", effects: { "projects:read": "Allow" } }),
    ).rejects.toBeInstanceOf(NotPermitted);
  });

  it("D349 people are searched, filtered and paged on the server, one row each", async () => {
    const { invitePeople, loadPeopleAndRoles } = await import("@/features/organisation/service");
    signedInAs = ownerId;
    const marker = `paged${Date.now()}`;
    const emails = ["a", "b", "c"].map((letter) => `${marker}.${letter}@tahseel.ae`);
    invented.push(...emails);
    for (const email of emails) await invitePeople({ emails: [email], roleCode: "Member", orgUnitId: null });
    // A second standing role for the first of them.
    await testPool().query(
      `insert into core.role_assignment (person_id, role_id, scope_type)
       select p.id, r.id, 'Organisation' from core.person p, core.role r where p.email = $1 and r.code = 'Auditor'`,
      [emails[0]],
    );

    const first = await loadPeopleAndRoles({ text: marker, limit: 2 });
    const second = await loadPeopleAndRoles({ text: marker, limit: 2, offset: 2 });
    expect(first.peopleTotal).toBe(3);
    expect(first.people.map((person) => person.email)).toEqual(emails.slice(0, 2));
    expect(second.people.map((person) => person.email)).toEqual([emails[2]]);
    // Two roles, one row naming both.
    const twoRoles = first.people.filter((person) => person.email === emails[0]);
    expect(twoRoles).toHaveLength(1);
    expect(twoRoles[0].roleNameEn.split(", ").sort()).toEqual(["Auditor", "Member"]);
    expect(twoRoles[0].roleCode).toBe("Member");

    expect((await loadPeopleAndRoles({ text: marker, status: "Invited" })).peopleTotal).toBe(3);
    expect((await loadPeopleAndRoles({ text: marker, status: "Active" })).peopleTotal).toBe(0);
    expect((await loadPeopleAndRoles({ text: `${marker}.b` })).people.map((person) => person.email)).toEqual([emails[1]]);
    // The search is literal.
    expect((await loadPeopleAndRoles({ text: `${marker}%` })).peopleTotal).toBe(0);
  });

  it("UC-41.2-01 lists every role with its member count and scope", async () => {
    const { loadPeopleAndRoles } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const { roles } = await loadPeopleAndRoles();
    expect(roles.length).toBeGreaterThanOrEqual(9);
    for (const role of roles) {
      expect(typeof role.members).toBe("number");
      expect(typeof role.organisationWide).toBe("boolean");
    }
  });
});
