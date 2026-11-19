import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import { can, Forbidden, type Capability, type Role } from "./authz";
import { hashToken, newToken } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = "hiwar_session";

export interface SessionContext {
  sessionId: string;
  user: typeof schema.users.$inferSelect;
  org: typeof schema.organizations.$inferSelect | null;
  role: Role | null;
  mfaPassed: boolean;
  /** Set when a Hiwar support operator reads the organization under a grant (OPS-003). */
  support: { grantId: string; includeConversations: boolean; expiresAt: Date } | null;
}

/** Creates a session for the user and sets the cookie. The length follows the organization (ORG-001 FR-006). */
export async function startSession(userId: string, orgId: string | null, mfaPassed: boolean): Promise<void> {
  let days = 14;
  if (orgId) {
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    days = org?.sessionDays ?? 14;
  }
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.insert(schema.sessions).values({ id: hash, userId, orgId, mfaPassed, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** The current session, or null when there is none or it expired. */
export async function getSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.query.sessions.findFirst({
    where: and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())),
  });
  if (!session) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user) return null;
  let org = null;
  let role: Role | null = null;
  let support: SessionContext["support"] = null;
  if (session.orgId) {
    org = (await db.query.organizations.findFirst({ where: eq(schema.organizations.id, session.orgId) })) ?? null;
    if (session.supportGrantId) {
      const grant = await db.query.supportGrants.findFirst({ where: eq(schema.supportGrants.id, session.supportGrantId) });
      if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) return null;
      support = { grantId: grant.id, includeConversations: grant.includeConversations, expiresAt: grant.expiresAt };
      // Support access reads as an Admin would, without writing (OPS-003 FR-003).
      role = "admin";
    } else {
      const member = await db.query.members.findFirst({
        where: and(eq(schema.members.orgId, session.orgId), eq(schema.members.userId, user.id)),
      });
      role = member?.role ?? null;
      if (!role) org = null;
    }
  }
  return { sessionId: session.id, user, org, role, mfaPassed: session.mfaPassed, support };
}

export interface MemberContext extends SessionContext {
  org: typeof schema.organizations.$inferSelect;
  role: Role;
}

/**
 * The signed-in member of an organization, for panel pages. Sends the visitor to sign-in,
 * to 2-step set-up or entry, or to the suspended and trial-ended pages as the state requires.
 */
export async function requireMember(capability?: Capability, next = "/conversations"): Promise<MemberContext> {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!session.org || !session.role) redirect("/sign-in?reason=no-organization");
  if (!session.support) {
    if (session.user.totpEnabledAt && !session.mfaPassed) redirect(`/two-step?next=${encodeURIComponent(next)}`);
    if (session.org.require2fa && !session.user.totpEnabledAt) redirect("/two-step/setup");
    if (session.org.status === "suspended") redirect("/suspended");
  }
  if (capability && !can(session.role, capability)) redirect("/conversations?denied=1");
  return session as MemberContext;
}

/**
 * The member for an API route: throws instead of redirecting. Writes under support access
 * are refused, because support access is read-only.
 */
export async function apiMember(capability?: Capability, opts: { write?: boolean } = {}): Promise<MemberContext> {
  const session = await getSession();
  if (!session || !session.org || !session.role) throw new Unauthenticated();
  if (!session.support) {
    if (session.user.totpEnabledAt && !session.mfaPassed) throw new Unauthenticated();
    if (session.org.status === "suspended") throw new Forbidden("suspended");
  } else if (opts.write) {
    throw new Forbidden("support access is read-only");
  }
  if (capability && !can(session.role, capability)) throw new Forbidden(capability);
  if (!session.support) {
    await db
      .update(schema.members)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(schema.members.orgId, session.org.id), eq(schema.members.userId, session.user.id)));
  }
  return session as MemberContext;
}

export class Unauthenticated extends Error {
  constructor() {
    super("Your session has expired. Sign in again to continue.");
    this.name = "Unauthenticated";
  }
}
