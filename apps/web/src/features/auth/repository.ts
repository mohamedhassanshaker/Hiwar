import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db, schema as s } from "@/db/client";
import { UAE_PASS_PROVIDER } from "@/lib/emirates-id";
import type { SignInPerson } from "./types";

/**
 * D387: the reads and writes of signing in — passwords, reset links and UAE PASS links. All on
 * the primary: a password just changed or a link just made has to be what the next request sees.
 */


const PERSON_FIELDS = {
  id: s.person.id,
  email: s.person.email,
  nameEn: s.person.nameEn,
  nameAr: s.person.nameAr,
  status: s.person.status,
  emiratesId: s.person.emiratesId,
};

/** The person with this email, ignoring case, and their password hash when they have one. */
export async function personWithPassword(email: string): Promise<(SignInPerson & { passwordHash: string | null }) | null> {
  const [row] = await db()
    .select({ ...PERSON_FIELDS, passwordHash: s.personCredential.passwordHash })
    .from(s.person)
    .leftJoin(s.personCredential, eq(s.personCredential.personId, s.person.id))
    .where(sql`lower(${s.person.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/** The person by id, or null. */
export async function personById(personId: string): Promise<SignInPerson | null> {
  const [row] = await db().select(PERSON_FIELDS).from(s.person).where(eq(s.person.id, personId)).limit(1);
  return row ?? null;
}

/** The person an invitation is for, by the hash of its token, or null. */
export async function personIdByInvitation(tokenHash: string): Promise<string | null> {
  const [row] = await db()
    .select({ personId: s.personInvitation.personId })
    .from(s.personInvitation)
    .where(eq(s.personInvitation.tokenHash, tokenHash))
    .limit(1);
  return row?.personId ?? null;
}

/** Sets the person's password hash, replacing any earlier one. */
export async function savePassword(personId: string, passwordHash: string): Promise<void> {
  await db()
    .insert(s.personCredential)
    .values({ personId, passwordHash })
    .onConflictDoUpdate({ target: s.personCredential.personId, set: { passwordHash, changedAt: sql`now()` } });
}

/** Records how the person signed in last, which People shows. */
export async function recordSignInMethod(personId: string, method: string): Promise<void> {
  await db().update(s.person).set({ signInMethod: method }).where(eq(s.person.id, personId));
}

/** A new reset link for the person by its token's hash; every earlier unused link of theirs stops working. */
export async function insertPasswordReset(personId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(s.passwordReset).where(and(eq(s.passwordReset.personId, personId), isNull(s.passwordReset.usedAt)));
    await tx.insert(s.passwordReset).values({ personId, tokenHash, expiresAt });
  });
}

/** The person an open reset link is for, or null when the link is unknown, used or expired. */
export async function openPasswordReset(tokenHash: string): Promise<SignInPerson | null> {
  const [row] = await db()
    .select(PERSON_FIELDS)
    .from(s.passwordReset)
    .innerJoin(s.person, eq(s.person.id, s.passwordReset.personId))
    .where(and(eq(s.passwordReset.tokenHash, tokenHash), isNull(s.passwordReset.usedAt), gt(s.passwordReset.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

/** Marks an open reset link used and returns its person, or null when it was not open; a link is spent once. */
export async function spendPasswordReset(tokenHash: string): Promise<string | null> {
  const [row] = await db()
    .update(s.passwordReset)
    .set({ usedAt: sql`now()` })
    .where(and(eq(s.passwordReset.tokenHash, tokenHash), isNull(s.passwordReset.usedAt), gt(s.passwordReset.expiresAt, sql`now()`)))
    .returning({ personId: s.passwordReset.personId });
  return row?.personId ?? null;
}

/** The person a UAE PASS account (its `uuid`) is linked to, or null. */
export async function personByUaePass(uuid: string): Promise<SignInPerson | null> {
  const [row] = await db()
    .select(PERSON_FIELDS)
    .from(s.authAccount)
    .innerJoin(s.person, eq(s.person.id, s.authAccount.personId))
    .where(and(eq(s.authAccount.provider, UAE_PASS_PROVIDER), eq(s.authAccount.providerAccountId, uuid)))
    .limit(1);
  return row ?? null;
}

/** The person holding this Emirates ID, or null. */
export async function personByEmiratesId(emiratesId: string): Promise<SignInPerson | null> {
  const [row] = await db().select(PERSON_FIELDS).from(s.person).where(eq(s.person.emiratesId, emiratesId)).limit(1);
  return row ?? null;
}

/** The UAE PASS account linked to the person, or null. */
export async function uaePassOf(personId: string): Promise<string | null> {
  const [row] = await db()
    .select({ uuid: s.authAccount.providerAccountId })
    .from(s.authAccount)
    .where(and(eq(s.authAccount.provider, UAE_PASS_PROVIDER), eq(s.authAccount.personId, personId)))
    .limit(1);
  return row?.uuid ?? null;
}

/**
 * Links a UAE PASS account to the person and, when they have none yet, records the Emirates ID
 * UAE PASS returned, which then cannot be changed in People (D387).
 */
export async function linkUaePass(personId: string, uuid: string, emiratesId: string | null): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(s.authAccount).values({ personId, type: "oauth", provider: UAE_PASS_PROVIDER, providerAccountId: uuid });
    if (emiratesId) {
      await tx.update(s.person).set({ emiratesId }).where(and(eq(s.person.id, personId), isNull(s.person.emiratesId)));
    }
  });
}

/** D393: what a registration stores. `passwordHash` is null for a UAE PASS registration, which has none. */
export type Registrant = {
  email: string;
  nameEn: string;
  nameAr: string;
  initials: string;
  orgUnitId: string;
  passwordHash: string | null;
  uaePass: { uuid: string; idn: string | null } | null;
};

/** D393: the organizations a registrant chooses between, by name. */
export async function registrationUnits(): Promise<{ id: string; nameEn: string; nameAr: string }[]> {
  return db().select({ id: s.orgUnit.id, nameEn: s.orgUnit.nameEn, nameAr: s.orgUnit.nameAr }).from(s.orgUnit).orderBy(asc(s.orgUnit.nameEn));
}

/** Whether an org unit with this id exists. */
export async function orgUnitExists(orgUnitId: string): Promise<boolean> {
  const [row] = await db().select({ id: s.orgUnit.id }).from(s.orgUnit).where(eq(s.orgUnit.id, orgUnitId)).limit(1);
  return Boolean(row);
}

/**
 * D393: stores a registration as a Pending person, with their password and, for UAE PASS, the
 * linked account and Emirates ID. Returns null when the address is already on the platform.
 */
export async function insertRegistrant(values: Registrant): Promise<string | null> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(s.person)
      .values({
        email: values.email,
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        initials: values.initials,
        orgUnitId: values.orgUnitId,
        status: "Pending",
        signInMethod: values.uaePass ? "UAE PASS" : "Password",
        emiratesId: values.uaePass?.idn ?? null,
      })
      .onConflictDoNothing({ target: s.person.email })
      .returning({ id: s.person.id });
    if (!row) return null;
    if (values.passwordHash) await tx.insert(s.personCredential).values({ personId: row.id, passwordHash: values.passwordHash });
    if (values.uaePass) {
      await tx.insert(s.authAccount).values({ personId: row.id, type: "oauth", provider: UAE_PASS_PROVIDER, providerAccountId: values.uaePass.uuid });
    }
    return row.id;
  });
}

/**
 * D393: the Active people who hold `registrations:approve` across the organisation and have no
 * Deny of it anywhere: the people a new registration is told to.
 */
export async function approverIds(): Promise<string[]> {
  const grants = await db()
    .select({ personId: s.roleAssignment.personId, effect: s.rolePermission.effect, scopeType: s.roleAssignment.scopeType })
    .from(s.roleAssignment)
    .innerJoin(s.rolePermission, eq(s.rolePermission.roleId, s.roleAssignment.roleId))
    .innerJoin(s.permission, eq(s.permission.id, s.rolePermission.permissionId))
    .innerJoin(s.person, eq(s.person.id, s.roleAssignment.personId))
    .where(and(eq(s.permission.code, "registrations:approve"), eq(s.person.status, "Active")));
  const held = Map.groupBy(grants, (grant) => grant.personId);
  return [...held]
    .filter(([, rows]) => !rows.some((row) => row.effect === "Deny") && rows.some((row) => row.effect === "Allow" && row.scopeType === "Organisation"))
    .map(([personId]) => personId);
}

/** D393: puts a waiting registration in each approver's Inbox, once. */
export async function notifyApprovers(registrantId: string, approvers: string[]): Promise<void> {
  if (approvers.length === 0) return;
  await db()
    .insert(s.inboxItem)
    .values(approvers.map((personId) => ({ personId, kind: "Review", sourceType: "Person", sourceId: registrantId, status: "Open", createdBy: registrantId, updatedBy: registrantId })))
    .onConflictDoNothing();
}

/** Closes every approver's Inbox item for this registration, and returns whose they were. */
export async function resolveRegistrationItems(registrantId: string): Promise<string[]> {
  const rows = await db()
    .update(s.inboxItem)
    .set({ status: "Resolved", resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.inboxItem.sourceType, "Person"), eq(s.inboxItem.sourceId, registrantId), eq(s.inboxItem.status, "Open")))
    .returning({ personId: s.inboxItem.personId });
  return rows.map((row) => row.personId);
}

/** D393: a Pending registration by id, or null when the person is unknown or no longer Pending. */
export async function pendingRegistrant(personId: string): Promise<SignInPerson | null> {
  const [row] = await db().select(PERSON_FIELDS).from(s.person).where(and(eq(s.person.id, personId), eq(s.person.status, "Pending"))).limit(1);
  return row ?? null;
}

/**
 * D393: makes a Pending person Active with a role across the organisation, in `orgUnitId` or, for
 * null, the organization they registered in; false when they were not Pending.
 */
export async function activateRegistrant(personId: string, roleId: string, orgUnitId: string | null, approvedBy: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .update(s.person)
      .set({ status: "Active", orgUnitId: orgUnitId ?? sql`${s.person.orgUnitId}`, updatedAt: sql`now()`, updatedBy: approvedBy })
      .where(and(eq(s.person.id, personId), eq(s.person.status, "Pending")))
      .returning({ id: s.person.id });
    if (!row) return false;
    await tx.insert(s.roleAssignment).values({ personId, roleId, scopeType: "Organisation", createdBy: approvedBy });
    return true;
  });
}

/** D393: removes a Pending registration with what is only theirs; false when they were not Pending. */
export async function deleteRegistrant(personId: string): Promise<boolean> {
  const removed = await db()
    .delete(s.person)
    .where(and(eq(s.person.id, personId), eq(s.person.status, "Pending")))
    .returning({ id: s.person.id });
  return removed.length > 0;
}

/** A role's id by its code, or null. */
export async function roleIdByCode(code: string): Promise<string | null> {
  const [row] = await db().select({ id: s.role.id }).from(s.role).where(eq(s.role.code, code)).limit(1);
  return row?.id ?? null;
}

/** The email addresses of these people. */
export async function emailsOf(personIds: string[]): Promise<string[]> {
  if (personIds.length === 0) return [];
  const rows = await db().select({ email: s.person.email }).from(s.person).where(inArray(s.person.id, personIds));
  return rows.map((row) => row.email);
}
