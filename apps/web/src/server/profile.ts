import { and, desc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { PASSWORD_MIN } from "./accounts";
import { Refused } from "./api";
import { ROLE_LABEL } from "./authz";
import { hashPassword, verifyPassword } from "./password";
import type { SessionContext } from "./session";

/** My profile (PLT-009): the signed-in person's own account, for members and operators alike. */

export const nameInput = z.string().trim().min(1, "Enter your name.").max(120);

export async function updateName(s: SessionContext, name: string): Promise<void> {
  await db.update(schema.users).set({ name: nameInput.parse(name) }).where(eq(schema.users.id, s.user.id));
}

/** Changes the password after checking the current one, and signs out every other session. */
export async function changePassword(s: SessionContext, current: string, next: string): Promise<void> {
  if (!(await verifyPassword(current, s.user.passwordHash))) throw new Refused("The current password is wrong.");
  if (next.length < PASSWORD_MIN) throw new Refused(`Use at least ${PASSWORD_MIN} characters.`);
  await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, s.user.id));
  await signOutOthers(s);
}

export async function signOutOthers(s: SessionContext): Promise<number> {
  const gone = await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, s.user.id), ne(schema.sessions.id, s.sessionId)))
    .returning({ id: schema.sessions.id });
  return gone.length;
}

export async function mySessions(s: SessionContext) {
  const rows = await db
    .select({ id: schema.sessions.id, createdAt: schema.sessions.createdAt, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, s.user.id), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt));
  return rows.map((r) => ({ current: r.id === s.sessionId, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

/** Organizations the person belongs to, for the organization switcher in the top bar. */
export async function myOrganizations(s: SessionContext) {
  const rows = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, status: schema.organizations.status, role: schema.members.role })
    .from(schema.members)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.orgId))
    .where(eq(schema.members.userId, s.user.id))
    .orderBy(schema.organizations.name);
  return rows.map((r) => ({ id: r.id, name: r.name, role: ROLE_LABEL[r.role], current: r.id === s.org?.id, suspended: r.status === "suspended" }));
}

/** Moves the current session to another organization the person is a member of. */
export async function switchOrganization(s: SessionContext, orgId: string): Promise<void> {
  if (s.support) throw new Refused("Support access stays in one organization.");
  const member = await db.query.members.findFirst({ where: and(eq(schema.members.orgId, orgId), eq(schema.members.userId, s.user.id)) });
  if (!member) throw new Refused("You are not a member of that organization.");
  await db.update(schema.sessions).set({ orgId }).where(eq(schema.sessions.id, s.sessionId));
}
