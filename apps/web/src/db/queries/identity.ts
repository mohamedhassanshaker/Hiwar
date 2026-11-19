import { and, eq, isNotNull } from "drizzle-orm";

import { dbRo, schema as s } from "@/db/client";
import { PERMISSION_CODES, type PermissionCode } from "@/authz/permissions";

/**
 * The reads behind `src/lib/session.ts`, on Hiwar's identity: a person is a Hiwar user with a
 * platform role (the operator portal is where the AI capabilities live), and the grants come
 * from that role. Hiwar has no org units or projects, so their scopes are always empty.
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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A Platform admin holds every AI permission; a Support operator reads and tests retrieval. */
export function platformGrants(role: string | null): GrantRow[] {
  if (!role) return [];
  const codes: PermissionCode[] =
    role === "platform_admin" ? PERMISSION_CODES : PERMISSION_CODES.filter((code) => code.endsWith(":read") || code === "knowledge:search");
  return codes.map((permission) => ({ permission, effect: "Allow", scopeType: "Organisation", scopeId: null }));
}

/** The person behind a session, or undefined when there is no such Hiwar staff account. */
export async function selectPerson(personId: string): Promise<PersonRow | undefined> {
  const [user] = await dbRo()
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, role: s.users.platformRole })
    .from(s.users)
    .where(eq(s.users.id, personId))
    .limit(1);
  if (!user) return undefined;
  return { id: user.id, email: user.email, nameEn: user.name, nameAr: user.name, initials: initialsOf(user.name), orgUnitId: null, status: user.role ? "Active" : "Inactive" };
}

export async function selectPersonByEmail(email: string): Promise<PersonRow | undefined> {
  const [user] = await dbRo().select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email.toLowerCase())).limit(1);
  return user ? selectPerson(user.id) : undefined;
}

/** Every permission the person's platform role grants, organisation-wide. */
export async function selectGrants(personId: string): Promise<GrantRow[]> {
  const [user] = await dbRo().select({ role: s.users.platformRole }).from(s.users).where(eq(s.users.id, personId)).limit(1);
  return platformGrants(user?.role ?? null);
}

/** Hiwar has no org-unit tree. */
export async function selectOrgUnitPath(_orgUnitId: string): Promise<string[]> {
  return [];
}

/** Resolves a principal code — an agent code or a staff user's id — to its row id and type. */
export async function selectPrincipalByCode(code: string): Promise<{ type: string; id: string } | null> {
  const [agent] = await dbRo().select({ id: s.agent.id }).from(s.agent).where(eq(s.agent.code, code)).limit(1);
  if (agent) return { type: "Agent", id: agent.id };
  if (!/^[0-9a-f-]{36}$/i.test(code)) return null;
  const [person] = await dbRo()
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, code), isNotNull(s.users.platformRole)))
    .limit(1);
  return person ? { type: "Person", id: person.id } : null;
}

/** Hiwar has no projects. */
export async function selectProjectIdsInScope(_personId: string, _orgUnitIds: string[]): Promise<string[]> {
  return [];
}

export async function selectAllProjectIds(): Promise<string[]> {
  return [];
}
