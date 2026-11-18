import { and, eq, isNull, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { invitationTokenHash } from "@/lib/invitation";

/**
 * The reads behind `src/lib/session.ts`: the signed-in person, their permission grants and
 * the org units their own unit sits under. Every SQL statement that is not a feature's
 * lives under `src/db/`, so a repository and this folder stay the only places that touch
 * the Drizzle client.
 */

export type PersonRow = {
  id: string;
  email: string;
  nameEn: string;
  nameAr: string;
  initials: string;
  orgUnitId: string | null;
  status: string;
};

export type GrantRow = {
  permission: string;
  effect: string;
  scopeType: string;
  scopeId: string | null;
};

/** The person behind a session, or undefined when the row is gone. */
export async function selectPerson(personId: string): Promise<PersonRow | undefined> {
  const [person] = await dbRo()
    .select({
      id: s.person.id,
      email: s.person.email,
      nameEn: s.person.nameEn,
      nameAr: s.person.nameAr,
      initials: s.person.initials,
      orgUnitId: s.person.orgUnitId,
      status: s.person.status,
    })
    .from(s.person)
    .where(eq(s.person.id, personId))
    .limit(1);
  return person;
}

/**
 * D248: accepts an invitation for the person signing in. The token must be theirs, open and
 * unexpired; the invitation is spent and the person made Active in one transaction, and
 * nothing changes when any condition fails.
 */
export async function acceptInvitation(personId: string, token: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const spent = await tx
      .update(s.personInvitation)
      .set({ acceptedAt: sql`now()`, tokenCipher: null, updatedAt: sql`now()`, updatedBy: personId })
      .where(
        and(
          eq(s.personInvitation.tokenHash, invitationTokenHash(token)),
          eq(s.personInvitation.personId, personId),
          isNull(s.personInvitation.acceptedAt),
          isNull(s.personInvitation.revokedAt),
          sql`${s.personInvitation.expiresAt} > now()`,
        ),
      )
      .returning({ id: s.personInvitation.id });
    if (spent.length === 0) return false;
    const activated = await tx
      .update(s.person)
      .set({ status: "Active", updatedAt: sql`now()`, updatedBy: personId })
      .where(and(eq(s.person.id, personId), eq(s.person.status, "Invited")))
      .returning({ id: s.person.id });
    if (activated.length === 0) tx.rollback();
    return true;
  }).catch((problem: unknown) => {
    if (problem instanceof Error && problem.name === "TransactionRollbackError") return false;
    throw problem;
  });
}

/**
 * The person with this exact email, read from the replica, whatever their status; the sign-in
 * refusal of `UC-05.1-03` reads the status.
 */
export async function selectPersonByEmail(email: string): Promise<PersonRow | undefined> {
  const [person] = await dbRo()
    .select({
      id: s.person.id,
      email: s.person.email,
      nameEn: s.person.nameEn,
      nameAr: s.person.nameAr,
      initials: s.person.initials,
      orgUnitId: s.person.orgUnitId,
      status: s.person.status,
    })
    .from(s.person)
    .where(eq(s.person.email, email))
    .limit(1);
  return person;
}

/** Every permission a person's role assignments grant or deny, with the scope of each. */
export async function selectGrants(personId: string): Promise<GrantRow[]> {
  return dbRo()
    .select({
      permission: s.permission.code,
      effect: s.rolePermission.effect,
      scopeType: s.roleAssignment.scopeType,
      scopeId: s.roleAssignment.scopeId,
    })
    .from(s.roleAssignment)
    .innerJoin(s.rolePermission, eq(s.rolePermission.roleId, s.roleAssignment.roleId))
    .innerJoin(s.permission, eq(s.permission.id, s.rolePermission.permissionId))
    .where(eq(s.roleAssignment.personId, personId));
}

/** The org units a unit sits under, outermost first. */
export async function selectOrgUnitPath(orgUnitId: string): Promise<string[]> {
  const { rows } = await dbRo().execute<{ id: string }>(sql`
    with recursive up as (
      select id, parent_org_unit_id from core.org_unit where id = ${orgUnitId}
      union all
      select parent.id, parent.parent_org_unit_id
      from core.org_unit parent join up on parent.id = up.parent_org_unit_id
    )
    select id from up
  `);
  return rows.map((row) => row.id).reverse();
}

/** Resolves a principal code — a person id or an agent code — to its row id and type. */
export async function selectPrincipalByCode(code: string): Promise<{ type: string; id: string } | null> {
  const [agent] = await dbRo().select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
  if (agent) return { type: "Agent", id: agent.id };
  const [person] = await dbRo().select({ id: s.person.id }).from(s.person).where(eq(s.person.id, code)).limit(1);
  return person ? { type: "Person", id: person.id } : null;
}

/**
 * The projects an org-unit-scoped or project-scoped person reaches: the ones they are a
 * member of, and the ones whose org unit is one of `orgUnitIds` or sits beneath it.
 */
export async function selectProjectIdsInScope(personId: string, orgUnitIds: string[]): Promise<string[]> {
  const { rows } = await dbRo().execute<{ id: string }>(sql`
    with recursive below as (
      select id from core.org_unit where id = any(${sql.param(orgUnitIds)}::uuid[])
      union all
      select child.id from core.org_unit child join below on child.parent_org_unit_id = below.id
    )
    select p.id
    from work.project p
    where p.org_unit_id in (select id from below)
       or exists (
         select 1 from work.project_member m
         where m.project_id = p.id and m.principal_type = 'Person' and m.principal_id = ${personId}
       )
  `);
  return rows.map((row) => row.id);
}

/** Every project id, for the organisation-wide case with an explicit project-level deny. */
export async function selectAllProjectIds(): Promise<string[]> {
  const rows = await dbRo().select({ id: s.project.id }).from(s.project);
  return rows.map((row) => row.id);
}
