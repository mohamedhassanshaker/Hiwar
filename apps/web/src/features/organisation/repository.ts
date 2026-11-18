import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db, dbRo, schema as s, type Database } from "@/db/client";
import { outer } from "@/db/outer";
import { containsTerm } from "@/db/search";
import { queueInvitationNotice } from "@/db/queries/mail";
import { encrypt } from "@/lib/crypto";
import { UAE_PASS_PROVIDER } from "@/lib/emirates-id";
import { INVITATION_DAYS, invitationTokenHash, newInvitationToken } from "@/lib/invitation";
import { assertWritten } from "@/lib/concurrency";
import type { Agent, Person, Project } from "@/types/directory";
import type { OrgNode, OrgUnitEvent, OrgUnitRow, RoleRow } from "./types";

/** An id no row has, so "visible: none" selects nothing rather than everything. */
const NO_PROJECT = "00000000-0000-0000-0000-000000000000";

/**
 * The only module in `organisation` that touches Drizzle. Everything it returns is already
 * in the shape a screen renders, so no component ever sees a table row.
 */

/** The current budget period is the one that contains today. */
const currentPeriod = sql`(
  select bp.estimated_spend_aed
  from gov.budget_period bp
  join gov.agent_budget ab on ab.id = bp.budget_id
  where ab.agent_id = ${s.agent.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc
  limit 1
)`;

const currentRuns = sql`(
  select bp.runs
  from gov.budget_period bp
  join gov.agent_budget ab on ab.id = bp.budget_id
  where ab.agent_id = ${s.agent.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc
  limit 1
)`;

/** The model an agent runs on is the first step of its active version's primary route. */
const primaryModel = sql<string>`(
  select rs.model_name
  from ai.route_step rs
  where rs.route_id = ${s.agentVersion.primaryRouteId}
  order by rs.sort_order
  limit 1
)`;

/**
 * Every agent for the directory, by code, with its active version, primary model, and the runs
 * and estimated spend of its current budget period. While the platform is paused every agent
 * but a draft reads Paused.
 */
export async function listAgents(): Promise<Agent[]> {
  const rows = await dbRo()
    .select({
      id: s.agent.code,
      ini: s.agent.initials,
      name: s.agent.nameEn,
      nameAr: s.agent.nameAr,
      unit: s.orgUnit.nameEn,
      unitAr: s.orgUnit.nameAr,
      versionNumber: s.agentVersion.versionNumber,
      model: primaryModel,
      status: s.agent.status,
      profile: s.agentVersion.executionProfile,
      runs: sql<number>`coalesce(${currentRuns}, 0)::int`,
      cost: sql<number>`coalesce(${currentPeriod}, 0)::float8`,
      isSystem: s.agent.isSystem,
    })
    .from(s.agent)
    .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.agent.orgUnitId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .orderBy(asc(s.agent.code));

  // `UC-78.1-02`: while the platform is paused, every agent reads Paused. Derived rather
  // than written into each row, because a resume would then have to put back a status
  // nothing recorded — and a stored copy of one platform-wide fact is a second place for
  // it to disagree.
  const [state] = await dbRo().select({ paused: s.systemState.agentsPaused }).from(s.systemState).limit(1);
  const paused = state?.paused ?? false;

  return rows.map((row) => ({
    id: row.id,
    ini: row.ini,
    name: row.name,
    nameAr: row.nameAr,
    unit: row.unit ?? "",
    unitAr: row.unitAr ?? "",
    ver: `v${row.versionNumber}`,
    model: row.model ?? "",
    // A draft agent is not running in the first place, so a pause does not relabel it.
    status: paused && row.status !== "Draft" ? "Paused" : (row.status as Agent["status"]),
    profile: row.profile,
    runs: row.runs,
    cost: row.cost,
    isSystem: row.isSystem,
  }));
}

/** The active people for the directory, in the order they were added, with their org unit's name. */
export async function listPeople(): Promise<(Person & { unit: string; signInMethod: string; status: string })[]> {
  const rows = await dbRo()
    .select({
      id: s.person.id,
      email: s.person.email,
      name: s.person.nameEn,
      nameAr: s.person.nameAr,
      ini: s.person.initials,
      photo: s.person.photoRef,
      role: s.person.jobTitleEn,
      roleAr: s.person.jobTitleAr,
      unit: s.orgUnit.nameEn,
      signInMethod: s.person.signInMethod,
      status: s.person.status,
    })
    .from(s.person)
    .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.person.orgUnitId))
    .where(eq(s.person.status, "Active"))
    .orderBy(asc(s.person.createdAt), asc(s.person.email));

  return rows.map((row) => ({
    id: row.id,
    ini: row.ini,
    photo: row.photo,
    name: row.name,
    nameAr: row.nameAr,
    role: row.role ?? "",
    roleAr: row.roleAr ?? "",
    email: row.email,
    unit: row.unit ?? "",
    signInMethod: row.signInMethod,
    status: row.status,
  }));
}

/**
 * `UC-20.1-04` and `COM-07`: the projects this person may see.
 *
 * `null` means every project, which is what an organisation-wide grant gives. A list is
 * what a scoped grant gives, and a project absent from it is absent from every picker and
 * every list in the console, because they all read this one directory.
 */
export async function listProjects(visibleIds: string[] | null): Promise<Project[]> {
  const rows = await dbRo()
    .select({
      k: s.project.key,
      n: s.project.nameEn,
      nAr: s.project.nameAr,
      st: s.project.status,
      own: s.project.ownerPersonId,
      unit: s.orgUnit.nameEn,
      sens: s.project.sensitivity,
      items: sql<number>`(select count(*) from work.work_item wi where wi.project_id = ${outer(s.project.id)})::int`,
      done: sql<number>`(select count(*) from work.work_item wi where wi.project_id = ${outer(s.project.id)} and wi.status = 'Done')::int`,
    })
    .from(s.project)
    .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.project.orgUnitId))
    .where(visibleIds === null ? undefined : inArray(s.project.id, visibleIds.length > 0 ? visibleIds : [NO_PROJECT]))
    .orderBy(asc(s.project.key));

  return rows.map((row) => ({
    k: row.k,
    n: row.n,
    nAr: row.nAr,
    // The project list shows the prototype's words, so `InProgress` reads as `In Progress`.
    st: row.st === "InProgress" ? "In Progress" : row.st,
    own: row.own ?? "",
    unit: row.unit ?? "",
    sens: row.sens,
    items: row.items,
    prog: row.items === 0 ? 0 : Math.round((row.done / row.items) * 100),
  }));
}

/** Every org unit, root units first then by name, with how many people, agents and projects each holds. */
export async function listOrgUnits(): Promise<OrgUnitRow[]> {
  const rows = await dbRo()
    .select({
      id: s.orgUnit.id,
      code: s.orgUnit.code,
      nameEn: s.orgUnit.nameEn,
      nameAr: s.orgUnit.nameAr,
      parentId: s.orgUnit.parentOrgUnitId,
      lead: s.orgUnit.leadPersonId,
      version: s.orgUnit.version,
      people: sql<number>`(select count(*) from core.person p where p.org_unit_id = ${outer(s.orgUnit.id)})::int`,
      agents: sql<number>`(select count(*) from ai.agent a where a.org_unit_id = ${outer(s.orgUnit.id)})::int`,
      projects: sql<number>`(select count(*) from work.project pr where pr.org_unit_id = ${outer(s.orgUnit.id)})::int`,
    })
    .from(s.orgUnit)
    .orderBy(asc(sql`case when ${s.orgUnit.parentOrgUnitId} is null then 0 else 1 end`), asc(s.orgUnit.nameEn));

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    isRoot: row.parentId === null,
    parentId: row.parentId,
    lead: row.lead ?? "",
    version: row.version,
    people: row.people,
    agents: row.agents,
    projects: row.projects,
  }));
}

/**
 * What has happened to one org unit, newest first.
 *
 * The audit log is the only history the platform keeps, and a unit is named there by its
 * code.
 */
export async function orgUnitHistory(code: string): Promise<OrgUnitEvent[]> {
  const rows = await dbRo()
    .select({
      at: s.auditEntry.at,
      action: s.auditEntry.action,
      actorLabel: s.auditEntry.actorLabel,
    })
    .from(s.auditEntry)
    .where(and(eq(s.auditEntry.objectType, "OrgUnit"), eq(s.auditEntry.objectLabel, code)))
    .orderBy(desc(s.auditEntry.at))
    .limit(50);

  return rows.map((row) => ({ at: row.at.toISOString(), action: row.action, actorLabel: row.actorLabel }));
}

/** The units a new one may be parented to, for the New org unit modal. */
export async function orgUnitOptions(): Promise<{ id: string; nameEn: string; nameAr: string; code: string }[]> {
  return dbRo()
    .select({ id: s.orgUnit.id, nameEn: s.orgUnit.nameEn, nameAr: s.orgUnit.nameAr, code: s.orgUnit.code })
    .from(s.orgUnit)
    .orderBy(asc(s.orgUnit.nameEn));
}

/** `UC-42.1-02`: insert a unit. The code is unique by index, which `UC-42.1-03` relies on. */
export async function insertOrgUnit(values: {
  code: string;
  nameEn: string;
  nameAr: string;
  parentOrgUnitId: string | null;
  leadPersonId: string | null;
  personId: string;
}): Promise<string> {
  const [row] = await db()
    .insert(s.orgUnit)
    .values({
      code: values.code,
      nameEn: values.nameEn,
      nameAr: values.nameAr,
      parentOrgUnitId: values.parentOrgUnitId,
      leadPersonId: values.leadPersonId,
      createdBy: values.personId,
      updatedBy: values.personId,
    })
    .returning({ id: s.orgUnit.id });
  return row.id;
}

/** One org unit as a patch reads it, with the version the patch has to name back. */
export async function readOrgUnit(orgUnitId: string): Promise<{
  code: string;
  nameEn: string;
  nameAr: string;
  parentOrgUnitId: string | null;
  leadPersonId: string | null;
  version: number;
} | null> {
  const [row] = await dbRo()
    .select({
      code: s.orgUnit.code,
      nameEn: s.orgUnit.nameEn,
      nameAr: s.orgUnit.nameAr,
      parentOrgUnitId: s.orgUnit.parentOrgUnitId,
      leadPersonId: s.orgUnit.leadPersonId,
      version: s.orgUnit.version,
    })
    .from(s.orgUnit)
    .where(eq(s.orgUnit.id, orgUnitId))
    .limit(1);
  return row ?? null;
}

/** Every unit and the one above it, which is what a re-parent has to walk for a cycle. */
export async function orgUnitParents(): Promise<{ id: string; parentOrgUnitId: string | null }[]> {
  return dbRo().select({ id: s.orgUnit.id, parentOrgUnitId: s.orgUnit.parentOrgUnitId }).from(s.orgUnit);
}

/**
 * Applies one patch to an org unit, all of it or none.
 *
 * `COM-10`: the version the caller read is in the `WHERE`, so two admins editing the same
 * unit do not silently lose one of the edits; `awp_version_bump` moves the version on.
 *
 * @returns false when no row matched the version, which the caller reports as a stale read.
 */
export async function updateOrgUnit(
  orgUnitId: string,
  expectedVersion: number,
  patch: {
    nameEn?: string;
    nameAr?: string;
    parentOrgUnitId?: string | null;
    leadPersonId?: string | null;
  },
  personId: string,
): Promise<boolean> {
  const rows = await db()
    .update(s.orgUnit)
    .set({
      ...(patch.nameEn === undefined ? {} : { nameEn: patch.nameEn }),
      ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
      ...(patch.parentOrgUnitId === undefined ? {} : { parentOrgUnitId: patch.parentOrgUnitId }),
      ...(patch.leadPersonId === undefined ? {} : { leadPersonId: patch.leadPersonId }),
      updatedAt: new Date(),
      updatedBy: personId,
    })
    .where(and(eq(s.orgUnit.id, orgUnitId), eq(s.orgUnit.version, expectedVersion)))
    .returning({ id: s.orgUnit.id });
  return rows.length > 0;
}

/** What still points at a unit, which `UC-42.1-04` refuses to orphan. */
export async function orgUnitContents(orgUnitId: string): Promise<{ people: number; agents: number; projects: number; children: number }> {
  const [row] = await dbRo()
    .select({
      people: sql<number>`(select count(*) from core.person p where p.org_unit_id = ${orgUnitId})::int`,
      agents: sql<number>`(select count(*) from ai.agent a where a.org_unit_id = ${orgUnitId})::int`,
      projects: sql<number>`(select count(*) from work.project pr where pr.org_unit_id = ${orgUnitId})::int`,
      children: sql<number>`(select count(*) from core.org_unit u where u.parent_org_unit_id = ${orgUnitId})::int`,
    })
    .from(s.orgUnit)
    .where(eq(s.orgUnit.id, orgUnitId))
    .limit(1);
  return row ?? { people: 0, agents: 0, projects: 0, children: 0 };
}

/** Removes an empty unit. The caller has already checked it is empty. */
export async function deleteOrgUnit(orgUnitId: string): Promise<void> {
  await db().delete(s.orgUnit).where(eq(s.orgUnit.id, orgUnitId));
}

/** Every role by name, with its assignment count and whether any assignment is organisation-wide. */
export async function listRoles(): Promise<RoleRow[]> {
  const rows = await dbRo()
    .select({
      code: s.role.code,
      nameEn: s.role.nameEn,
      nameAr: s.role.nameAr,
      members: sql<number>`(select count(*) from core.role_assignment ra where ra.role_id = ${outer(s.role.id)})::int`,
      organisationWide: sql<boolean>`exists (
        select 1 from core.role_assignment ra
        where ra.role_id = ${s.role.id} and ra.scope_type = 'Organisation'
      )`,
    })
    .from(s.role)
    .orderBy(asc(s.role.nameEn));

  return rows.map((row) => ({
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    members: row.members,
    organisationWide: row.organisationWide,
  }));
}

/** The org chart: people and agents in one hierarchy, as S-40 draws it. */
export async function listOrgNodes(): Promise<OrgNode[]> {
  const [people, agents] = await Promise.all([
    dbRo()
      .select({
        id: s.person.id,
        parentId: s.person.reportsToId,
        parentType: s.person.reportsToType,
        unit: s.orgUnit.nameEn,
        subEn: s.person.jobTitleEn,
        subAr: s.person.jobTitleAr,
      })
      .from(s.person)
      .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.person.orgUnitId))
      .orderBy(asc(s.person.createdAt)),
    dbRo()
      .select({
        id: s.agent.code,
        parentPersonId: s.agent.reportsToId,
        parentType: s.agent.reportsToType,
        unit: s.orgUnit.nameEn,
        versionNumber: s.agentVersion.versionNumber,
        isSystem: s.agent.isSystem,
      })
      .from(s.agent)
      .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.agent.orgUnitId))
      .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
      .orderBy(asc(s.agent.createdAt)),
  ]);

  const agentIdByUuid = new Map<string, string>();
  const agentRows = await dbRo().select({ id: s.agent.id, code: s.agent.code }).from(s.agent);
  for (const row of agentRows) agentIdByUuid.set(row.id, row.code);

  const peopleNodes: OrgNode[] = people.map((row) => ({
    id: row.id,
    sub: [row.subEn ?? "", row.subAr ?? ""],
    unit: row.unit ?? "",
    // A person may report to an agent, which the chart identifies by code, not by its row id.
    parent: row.parentId
      ? row.parentType === "Agent"
        ? (agentIdByUuid.get(row.parentId) ?? null)
        : row.parentId
      : null,
  }));

  const agentNodes: OrgNode[] = agents.map((row) => ({
    id: row.id,
    sub: row.isSystem
      ? ["Platform · System trust", "المنصة · ثقة النظام"]
      : [`v${row.versionNumber}`, `v${row.versionNumber}`],
    unit: row.unit ?? "",
    parent: row.parentPersonId
      ? row.parentType === "Agent"
        ? (agentIdByUuid.get(row.parentPersonId) ?? null)
        : row.parentPersonId
      : null,
  }));

  return [...peopleNodes, ...agentNodes];
}

/** The passkeys and sessions My profile → Security lists (S-04). */
export async function listSecurity(personId: string) {
  const [passkeys, sessions] = await Promise.all([
    dbRo()
      .select({ id: s.passkey.id, label: s.passkey.label, lastUsedAt: s.passkey.lastUsedAt, createdAt: s.passkey.createdAt })
      .from(s.passkey)
      .where(eq(s.passkey.personId, personId))
      .orderBy(asc(s.passkey.createdAt)),
    dbRo()
      .select({
        token: s.authSession.sessionToken,
        userAgent: s.authSession.userAgent,
        ipAddress: s.authSession.ipAddress,
        lastSeenAt: s.authSession.lastSeenAt,
        expires: s.authSession.expires,
      })
      .from(s.authSession)
      .where(and(eq(s.authSession.personId, personId), sql`${s.authSession.expires} > now()`))
      .orderBy(asc(s.authSession.createdAt)),
  ]);
  return { passkeys, sessions };
}

/** The signed-in person's own record, for My profile. */
export async function readPerson(personId: string) {
  const [row] = await dbRo()
    .select({
      mobile: s.person.mobile,
      preferredLanguage: s.person.preferredLanguage,
      photoRef: s.person.photoRef,
      version: s.person.version,
    })
    .from(s.person)
    .where(eq(s.person.id, personId))
    .limit(1);
  return row ?? null;
}

/**
 * `UC-04.1-01` and `COM-10`: the write names the version it read, so a second person who
 * saved in between leaves no rows to update and `assertWritten` turns that into the
 * stale-write message.
 */
export async function updatePerson(
  personId: string,
  values: { nameEn: string; nameAr: string; mobile: string | null; preferredLanguage: string },
  version: number,
): Promise<void> {
  const rows = await db()
    .update(s.person)
    .set({ ...values, initials: initialsOf(values.nameEn) })
    .where(and(eq(s.person.id, personId), eq(s.person.version, version)))
    .returning({ id: s.person.id });
  assertWritten(rows, "Person");
}

/** `UC-04.1-03`: the photo lives in `core.person.photo_ref` until plan item 8 moves it. */
export async function updatePersonPhoto(personId: string, photo: string, version: number): Promise<void> {
  const rows = await db()
    .update(s.person)
    .set({ photoRef: photo })
    .where(and(eq(s.person.id, personId), eq(s.person.version, version)))
    .returning({ id: s.person.id });
  assertWritten(rows, "Person");
}

/** The two letters an avatar falls back to when there is no photo. */
function initialsOf(nameEn: string): string {
  const parts = nameEn.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** A person's notification preference row, or null when they have never saved one. */
export async function readNotificationPreference(personId: string) {
  const [row] = await dbRo()
    .select()
    .from(s.notificationPreference)
    .where(eq(s.notificationPreference.personId, personId))
    .limit(1);
  return row ?? null;
}

/** Insert or replace a person's notification preferences. */
export async function updateNotificationPreference(
  personId: string,
  values: {
    approvals: boolean;
    mentions: boolean;
    slaWarnings: boolean;
    dailyDigest: boolean;
    requestCreatedEmail: boolean;
    requestUpdatedEmail: boolean;
    requestFinishedEmail: boolean;
    workItemFinishedEmail: boolean;
  },
): Promise<void> {
  await db()
    .insert(s.notificationPreference)
    .values({ personId, ...values })
    .onConflictDoUpdate({ target: s.notificationPreference.personId, set: values });
}

/** Delete the person's auth session with this token; nothing when the token is not theirs. */
export async function revokeSession(personId: string, token: string): Promise<void> {
  await db()
    .delete(s.authSession)
    .where(and(eq(s.authSession.personId, personId), eq(s.authSession.sessionToken, token)));
}

/** `UC-04.3-02`: the passkeys My profile → Security registers and removes. */
export async function insertPasskey(values: {
  personId: string;
  label: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}): Promise<void> {
  await db().insert(s.passkey).values(values);
}

/** Delete the person's passkey with this id and return its label, or null when none was theirs. */
export async function deletePasskey(personId: string, passkeyId: string): Promise<string | null> {
  const rows = await db()
    .delete(s.passkey)
    .where(and(eq(s.passkey.personId, personId), eq(s.passkey.id, passkeyId)))
    .returning({ label: s.passkey.label });
  return rows[0]?.label ?? null;
}

/**
 * The principal behind an org chart node id.
 *
 * The chart identifies a person by row id and an agent by its code, because that is what
 * every other screen links by. A write needs the row and its type back.
 */
export async function principalByNodeId(
  nodeId: string,
): Promise<{ kind: "Person" | "Agent"; id: string; label: string } | null> {
  const [personRow] = await dbRo()
    .select({ id: s.person.id, label: s.person.nameEn })
    .from(s.person)
    .where(eq(s.person.id, nodeId))
    .limit(1);
  if (personRow) return { kind: "Person", id: personRow.id, label: personRow.label };

  const [agentRow] = await dbRo()
    .select({ id: s.agent.id, label: s.agent.code })
    .from(s.agent)
    .where(eq(s.agent.code, nodeId))
    .limit(1);
  return agentRow ? { kind: "Agent", id: agentRow.id, label: agentRow.label } : null;
}

/** `UC-40.2-01`: point a person or an agent at a new manager, or at none. */
export async function updateReportsTo(
  subject: { kind: "Person" | "Agent"; id: string },
  manager: { kind: "Person" | "Agent"; id: string } | null,
): Promise<void> {
  const values = { reportsToType: manager?.kind ?? null, reportsToId: manager?.id ?? null };
  if (subject.kind === "Person") {
    await db().update(s.person).set(values).where(eq(s.person.id, subject.id));
    return;
  }
  await db().update(s.agent).set(values).where(eq(s.agent.id, subject.id));
}

/** `UC-41.1-02`: the addresses already on the platform, lower-cased for comparison. */
export async function existingEmails(): Promise<Set<string>> {
  const rows = await dbRo().select({ email: s.person.email }).from(s.person);
  return new Set(rows.map((row) => row.email.toLowerCase()));
}

/** The role behind a code, or null when the catalogue has no such role. */
export async function roleByCode(code: string): Promise<{ id: string; code: string } | null> {
  const [row] = await dbRo()
    .select({ id: s.role.id, code: s.role.code })
    .from(s.role)
    .where(eq(s.role.code, code))
    .limit(1);
  return row ?? null;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * D248: an invitation for one invited person, and the email that carries its link, in the
 * caller's transaction. Returns the email's row and why it will not be sent, if it will not.
 */
async function invite(tx: Tx, personId: string, email: string, invitedBy: string): Promise<{ noticeId: string; reason: string | null }> {
  const { token, hash } = newInvitationToken();
  const [invitation] = await tx
    .insert(s.personInvitation)
    .values({
      personId,
      tokenHash: hash,
      tokenCipher: encrypt(token).toString("base64"),
      expiresAt: sql`now() + make_interval(days => ${INVITATION_DAYS})`,
      createdBy: invitedBy,
      updatedBy: invitedBy,
    })
    .returning({ id: s.personInvitation.id });
  const notice = await queueInvitationNotice(tx, { invitationId: invitation.id, personId, email, actorId: invitedBy });
  return { noticeId: notice.id, reason: notice.reason };
}

/** `UC-41.1-01`: an invited person, with the role they were invited into, and their invitation (D248). */
export async function insertInvitedPerson(values: {
  email: string;
  nameEn: string;
  nameAr: string;
  initials: string;
  orgUnitId: string | null;
  roleId: string;
  invitedBy: string;
  /** D387: the person's Emirates ID, already checked, or null. */
  emiratesId: string | null;
}): Promise<{ personId: string; noticeId: string; reason: string | null }> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(s.person)
      .values({
        email: values.email,
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        initials: values.initials,
        orgUnitId: values.orgUnitId,
        emiratesId: values.emiratesId,
        status: "Invited",
        createdBy: values.invitedBy,
      })
      .returning({ id: s.person.id });
    await tx.insert(s.roleAssignment).values({
      personId: row.id,
      roleId: values.roleId,
      scopeType: "Organisation",
      createdBy: values.invitedBy,
    });
    return { personId: row.id, ...(await invite(tx, row.id, values.email, values.invitedBy)) };
  });
}

/**
 * D248: a new invitation for a person still invited; every earlier one stops working. Null
 * when the person is not (or no longer) invited.
 */
export async function reinvitePerson(personId: string, invitedBy: string): Promise<{ email: string; noticeId: string; reason: string | null } | null> {
  return db().transaction(async (tx) => {
    const [person] = await tx
      .select({ email: s.person.email })
      .from(s.person)
      .where(and(eq(s.person.id, personId), eq(s.person.status, "Invited")))
      .for("update");
    if (!person) return null;
    await tx
      .update(s.personInvitation)
      .set({ revokedAt: sql`now()`, tokenCipher: null, updatedAt: sql`now()`, updatedBy: invitedBy })
      .where(and(eq(s.personInvitation.personId, personId), sql`${s.personInvitation.acceptedAt} is null and ${s.personInvitation.revokedAt} is null`));
    return { email: person.email, ...(await invite(tx, personId, person.email, invitedBy)) };
  });
}

/** D248: what the invitation page shows for a token, read by its hash. */
export async function invitationByToken(token: string): Promise<{
  nameEn: string;
  nameAr: string;
  email: string;
  state: "Open" | "Accepted" | "Expired" | "Withdrawn";
} | null> {
  const [row] = await dbRo()
    .select({
      nameEn: s.person.nameEn,
      nameAr: s.person.nameAr,
      email: s.person.email,
      acceptedAt: s.personInvitation.acceptedAt,
      revokedAt: s.personInvitation.revokedAt,
      expired: sql<boolean>`${s.personInvitation.expiresAt} <= now()`,
      status: s.person.status,
    })
    .from(s.personInvitation)
    .innerJoin(s.person, eq(s.person.id, s.personInvitation.personId))
    .where(eq(s.personInvitation.tokenHash, invitationTokenHash(token)))
    .limit(1);
  if (!row) return null;
  const state = row.acceptedAt ? "Accepted" : row.revokedAt || row.status !== "Invited" ? "Withdrawn" : row.expired ? "Expired" : "Open";
  return { nameEn: row.nameEn, nameAr: row.nameAr, email: row.email, state };
}

/** `UC-41.1-03`: move a person to another org unit, and into another role. */
export async function updatePersonPlacement(values: {
  personId: string;
  orgUnitId: string | null;
  roleId: string;
  scopeType: "Organisation" | "OrgUnit" | "Project";
  scopeId: string | null;
  changedBy: string;
}): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(s.person)
      .set({ orgUnitId: values.orgUnitId })
      .where(eq(s.person.id, values.personId));
    // One standing assignment per person, so the old one goes out as the new one goes in.
    // `UC-41.2-03` scopes it: the same role granted across the organisation, within one org
    // unit, or within one project.
    await tx.delete(s.roleAssignment).where(eq(s.roleAssignment.personId, values.personId));
    await tx.insert(s.roleAssignment).values({
      personId: values.personId,
      roleId: values.roleId,
      scopeType: values.scopeType,
      scopeId: values.scopeId,
      createdBy: values.changedBy,
    });
  });
}

/** `UC-41.1-04`: suspend a person and end every session they hold. */
export async function suspendPersonAndEndSessions(personId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.update(s.person).set({ status: "Suspended" }).where(eq(s.person.id, personId));
    await tx.delete(s.authSession).where(eq(s.authSession.personId, personId));
  });
}

/**
 * D381: delete a person who is Invited or Suspended, with what is only theirs (sessions, role
 * grants and memberships cascade). Returns the table that still refers to them when one does,
 * and deletes nothing then: a row that names them as author, owner or approver stays theirs.
 */
export async function deletePersonIfUnused(personId: string): Promise<{ deleted: boolean; heldBy: string | null }> {
  try {
    const removed = await db()
      .delete(s.person)
      .where(and(eq(s.person.id, personId), inArray(s.person.status, ["Invited", "Suspended"])))
      .returning({ id: s.person.id });
    return { deleted: removed.length > 0, heldBy: null };
  } catch (problem) {
    const heldBy = referencingTable(problem);
    if (heldBy === null) throw problem;
    return { deleted: false, heldBy };
  }
}

/** The table whose foreign key refused a delete (SQLSTATE 23503). */
function referencingTable(problem: unknown): string | null {
  const refused = sqlErrorOf(problem, "23503");
  return refused ? (refused.table ?? "another record") : null;
}

/** The database error carrying this SQLSTATE, found through the driver's wrapping, or null. */
function sqlErrorOf(problem: unknown, code: string): { table?: string } | null {
  const seen = new Set<unknown>();
  let current: unknown = problem;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === code) return current as { table?: string };
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * D387: a person's Emirates ID and whether a UAE PASS account is linked to them, which locks it.
 * Null when there is no such person. Read on its own, never in a list, because it is a national ID.
 */
export async function personEmiratesId(personId: string): Promise<{ emiratesId: string | null; linked: boolean } | null> {
  const [row] = await db()
    .select({
      emiratesId: s.person.emiratesId,
      linked: sql<boolean>`exists (select 1 from core.auth_account aa where aa.person_id = ${outer(s.person.id)} and aa.provider = ${UAE_PASS_PROVIDER})`,
    })
    .from(s.person)
    .where(eq(s.person.id, personId))
    .limit(1);
  return row ?? null;
}

/** D387: whether some person already holds this Emirates ID. */
export async function emiratesIdTaken(emiratesId: string): Promise<boolean> {
  const [row] = await db().select({ id: s.person.id }).from(s.person).where(eq(s.person.emiratesId, emiratesId)).limit(1);
  return Boolean(row);
}

/** D387: sets or clears a person's Emirates ID; "taken" when another person already holds it. */
export async function saveEmiratesId(personId: string, emiratesId: string | null, changedBy: string): Promise<"saved" | "taken"> {
  try {
    await db().update(s.person).set({ emiratesId, updatedAt: sql`now()`, updatedBy: changedBy }).where(eq(s.person.id, personId));
    return "saved";
  } catch (problem) {
    if (sqlErrorOf(problem, "23505")) return "taken";
    throw problem;
  }
}

/** D381: the status a person is in, or null when there is no such person. */
export async function personStatus(personId: string): Promise<string | null> {
  const [row] = await dbRo().select({ status: s.person.status }).from(s.person).where(eq(s.person.id, personId)).limit(1);
  return row?.status ?? null;
}

/**
 * `UC-41.1-04`: the open work still assigned to a person.
 *
 * Needing reassignment is derived, not stored: an item needs a new owner exactly while the
 * person it is assigned to is suspended. `UC-21.3-05` settles that the items themselves do
 * not move — "their items stay assigned until reassigned" — so a column holding the same
 * fact would only be a second place for it to be wrong.
 */
export async function openAssignedWork(personId: string): Promise<{ key: string; title: string }[]> {
  return dbRo()
    .select({ key: s.workItem.key, title: s.workItem.titleEn })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.assigneeType, "Person"),
        eq(s.workItem.assigneeId, personId),
        notInArray(s.workItem.status, ["Done", "Cancelled"]),
      ),
    )
    .orderBy(asc(s.workItem.key));
}

/** How many people hold a role organisation-wide, for the last-owner rule. */
export async function roleHolderCount(roleCode: string): Promise<number> {
  const [row] = await dbRo()
    .select({ count: sql<number>`count(*)::int` })
    .from(s.roleAssignment)
    .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .innerJoin(s.person, eq(s.person.id, s.roleAssignment.personId))
    .where(and(eq(s.role.code, roleCode), eq(s.person.status, "Active")));
  return row?.count ?? 0;
}

/** Whether a person holds a role, used by the last-Platform-Owner rule. */
export async function personHoldsRole(personId: string, roleCode: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ id: s.roleAssignment.id })
    .from(s.roleAssignment)
    .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .where(and(eq(s.roleAssignment.personId, personId), eq(s.role.code, roleCode)))
    .limit(1);
  return row !== undefined;
}

/** `UC-41.2-02`: what a role currently allows and denies, by permission code. */
export async function rolePermissions(roleCode: string): Promise<Record<string, "Allow" | "Deny">> {
  const rows = await dbRo()
    .select({ code: s.permission.code, effect: s.rolePermission.effect })
    .from(s.rolePermission)
    .innerJoin(s.role, eq(s.role.id, s.rolePermission.roleId))
    .innerJoin(s.permission, eq(s.permission.id, s.rolePermission.permissionId))
    .where(eq(s.role.code, roleCode));
  return Object.fromEntries(rows.map((row) => [row.code, row.effect as "Allow" | "Deny"]));
}

/** Whether a role is one of the nine the platform ships with. */
export async function isSystemRole(roleCode: string): Promise<boolean> {
  const [row] = await dbRo()
    .select({ isSystem: s.role.isSystem })
    .from(s.role)
    .where(eq(s.role.code, roleCode))
    .limit(1);
  return row?.isSystem ?? false;
}

/**
 * `UC-41.2-02`: replace a role's permissions with exactly these.
 *
 * Replaced rather than merged, because a permission the admin removed has to disappear from
 * the table: leaving the row behind would keep granting it.
 */
export async function replaceRolePermissions(
  roleCode: string,
  entries: Record<string, "Allow" | "Deny">,
  changedBy: string,
): Promise<void> {
  const [role] = await dbRo().select({ id: s.role.id }).from(s.role).where(eq(s.role.code, roleCode)).limit(1);
  if (!role) return;

  const codes = Object.keys(entries);
  const permissions = codes.length
    ? await dbRo()
        .select({ id: s.permission.id, code: s.permission.code })
        .from(s.permission)
        .where(inArray(s.permission.code, codes))
    : [];

  await db().transaction(async (tx) => {
    await tx.delete(s.rolePermission).where(eq(s.rolePermission.roleId, role.id));
    if (!permissions.length) return;
    await tx.insert(s.rolePermission).values(
      permissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
        effect: entries[permission.code],
        createdBy: changedBy,
      })),
    );
  });
}

/**
 * Everyone, for the People tab (S-41), with the role and scope they hold.
 *
 * Separate from `listPeople`, which answers a different question: that one names principals
 * for the rest of the console and returns only active people, so an administration screen
 * built on it could never show an invitation (`UC-41.1-01`) or the result of a suspension
 * (`UC-41.1-04`) — its Status column could only ever read "Active".
 */
/**
 * Which people `listPeopleForAdministration` returns (D349): name or email containing `text`,
 * one status; `limit` (50 unless given, at most 200) from `offset`.
 */
export type PeopleFilter = { text?: string; status?: string; limit?: number; offset?: number };

/** The WHERE clause of a people filter. */
function peopleWhere(filter: PeopleFilter) {
  const text = filter.text?.trim();
  return and(
    text ? containsTerm(s.person.searchKey, text) : undefined,
    filter.status === undefined ? undefined : eq(s.person.status, filter.status),
  );
}

/** How many people match the filter. */
export async function countPeopleForAdministration(filter: PeopleFilter = {}): Promise<number> {
  const [row] = await dbRo().select({ n: sql<number>`count(*)::int` }).from(s.person).where(peopleWhere(filter));
  return row?.n ?? 0;
}

export async function listPeopleForAdministration(filter: PeopleFilter = {}): Promise<
  {
    id: string;
    email: string;
    name: string;
    nameAr: string;
    ini: string;
    photo: string | null;
    jobTitle: string;
    jobTitleAr: string;
    unit: string;
    unitId: string | null;
    signInMethod: string;
    status: string;
    roleCode: string;
    roleNameEn: string;
    roleNameAr: string;
    scopeType: "Organisation" | "OrgUnit" | "Project";
    scopeId: string | null;
  }[]
> {
  const people = await dbRo()
    .select({
      id: s.person.id,
      email: s.person.email,
      name: s.person.nameEn,
      nameAr: s.person.nameAr,
      ini: s.person.initials,
      photo: s.person.photoRef,
      jobTitle: s.person.jobTitleEn,
      jobTitleAr: s.person.jobTitleAr,
      unit: s.orgUnit.nameEn,
      unitId: s.person.orgUnitId,
      signInMethod: s.person.signInMethod,
      status: s.person.status,
    })
    .from(s.person)
    .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.person.orgUnitId))
    .where(peopleWhere(filter))
    .orderBy(asc(s.person.createdAt), asc(s.person.email))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0);

  // The roles of this page's people only. A person holding several is one row, naming them all,
  // and the first assigned is the one the person dialog edits.
  const assignments = people.length
    ? await dbRo()
        .select({
          personId: s.roleAssignment.personId,
          roleCode: s.role.code,
          roleNameEn: s.role.nameEn,
          roleNameAr: s.role.nameAr,
          scopeType: s.roleAssignment.scopeType,
          scopeId: s.roleAssignment.scopeId,
        })
        .from(s.roleAssignment)
        .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
        .where(inArray(s.roleAssignment.personId, people.map((person) => person.id)))
        .orderBy(asc(s.roleAssignment.createdAt), asc(s.role.code))
    : [];

  return people.map((row) => {
    const held = assignments.filter((assignment) => assignment.personId === row.id);
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      nameAr: row.nameAr,
      ini: row.ini,
      photo: row.photo,
      jobTitle: row.jobTitle ?? "",
      jobTitleAr: row.jobTitleAr ?? "",
      unit: row.unit ?? "",
      unitId: row.unitId,
      signInMethod: row.signInMethod,
      status: row.status,
      roleCode: held[0]?.roleCode ?? "",
      roleNameEn: held.map((assignment) => assignment.roleNameEn).join(", "),
      roleNameAr: held.map((assignment) => assignment.roleNameAr).join("، "),
      scopeType: (held[0]?.scopeType ?? "Organisation") as "Organisation" | "OrgUnit" | "Project",
      scopeId: held[0]?.scopeId ?? null,
    };
  });
}

/** The role catalogue, for the pickers on S-41. */
export async function roleOptions(): Promise<{ code: string; nameEn: string; nameAr: string }[]> {
  return dbRo()
    .select({ code: s.role.code, nameEn: s.role.nameEn, nameAr: s.role.nameAr })
    .from(s.role)
    .orderBy(asc(s.role.nameEn));
}
