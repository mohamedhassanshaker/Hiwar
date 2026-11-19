import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { invitationExpiry } from "./accounts";
import { Refused } from "./api";
import { audit } from "./audit";
import { ROLE_LABEL, type Role } from "./authz";
import { newToken } from "./crypto";
import { env } from "./env";
import { publish } from "./live";
import { sendMail } from "./mail";
import { orgPlan } from "./plans";
import type { MemberContext } from "./session";

/** ORG-001: members, invitations, security settings; OPS-003 FR-001: support access grants. */

const ASSIGNABLE = ["admin", "builder", "support_agent", "analyst", "billing"] as const;

export async function listTeam(orgId: string) {
  const members = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.members.role,
      twoStep: schema.users.totpEnabledAt,
      lastActiveAt: schema.members.lastActiveAt,
    })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.members.orgId, orgId))
    .orderBy(schema.users.name);
  const invitations = await db.query.invitations.findMany({
    where: and(
      eq(schema.invitations.orgId, orgId),
      isNull(schema.invitations.acceptedAt),
      isNull(schema.invitations.cancelledAt),
      gt(schema.invitations.expiresAt, new Date()),
    ),
  });
  return { members, invitations };
}

/** Seats used: members plus pending invitations (FR-009). */
export async function seatsUsed(orgId: string): Promise<number> {
  const [{ count }] = await db.execute<{ count: number }>(sql`
    SELECT (SELECT count(*) FROM members WHERE org_id = ${orgId})
         + (SELECT count(*) FROM invitations WHERE org_id = ${orgId} AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > now()) AS count`).then((r) => r.rows);
  return Number(count);
}

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(ASSIGNABLE),
  message: z.string().trim().max(500).optional(),
});

export async function invite(member: MemberContext, input: z.infer<typeof inviteInput>): Promise<void> {
  const orgId = member.org.id;
  const { limits } = await orgPlan(member.org);
  if ((await seatsUsed(orgId)) >= limits.seats) {
    throw new Refused(`All ${limits.seats} seats of your plan are in use. Upgrade to invite more people.`, 402, { upgrade: true });
  }
  const already = await db
    .select({ id: schema.users.id })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.orgId, orgId), eq(schema.users.email, input.email)));
  if (already.length > 0) throw new Refused("This person is already a member.", 409);
  const { token, hash } = newToken();
  await db.insert(schema.invitations).values({
    orgId,
    email: input.email,
    role: input.role,
    message: input.message || null,
    tokenHash: hash,
    invitedBy: member.user.id,
    expiresAt: invitationExpiry(),
  });
  await sendInvitationMail(member, input.email, input.role, input.message, token);
  await audit({ orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Invited", item: input.email, change: `role ${ROLE_LABEL[input.role]}` });
}

async function sendInvitationMail(member: MemberContext, email: string, role: Role, message: string | undefined | null, token: string) {
  await sendMail(
    email,
    `${member.user.name} invited you to ${member.org.name} on Hiwar`,
    `${member.user.name} invited you to join ${member.org.name} on Hiwar as ${ROLE_LABEL[role]}.\n${message ? `\n"${message}"\n` : ""}\nAccept within 7 days:\n${env().APP_URL}/invite?token=${token}\n`,
  );
}

/** FR-011: resend issues a new link valid for 7 days; cancel ends the invitation. */
export async function resendInvitation(member: MemberContext, invitationId: string): Promise<void> {
  const invitation = await db.query.invitations.findFirst({
    where: and(eq(schema.invitations.id, invitationId), eq(schema.invitations.orgId, member.org.id)),
  });
  if (!invitation || invitation.acceptedAt || invitation.cancelledAt) throw new Refused("This invitation is no longer pending.", 404);
  const { token, hash } = newToken();
  await db.update(schema.invitations).set({ tokenHash: hash, expiresAt: invitationExpiry() }).where(eq(schema.invitations.id, invitation.id));
  await sendInvitationMail(member, invitation.email, invitation.role, invitation.message, token);
}

export async function cancelInvitation(member: MemberContext, invitationId: string): Promise<void> {
  const [row] = await db
    .update(schema.invitations)
    .set({ cancelledAt: new Date() })
    .where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.orgId, member.org.id), isNull(schema.invitations.acceptedAt)))
    .returning();
  if (row) {
    await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Cancelled an invitation", item: row.email });
  }
}

async function targetMember(orgId: string, userId: string) {
  const row = await db
    .select({ role: schema.members.role, name: schema.users.name })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.orgId, orgId), eq(schema.members.userId, userId)));
  if (!row[0]) throw new Refused("This person is not a member.", 404);
  return row[0];
}

/** FR-002, FR-007, FR-008: the Owner is locked; the change applies on the member's next request. */
export async function changeRole(member: MemberContext, userId: string, role: Role): Promise<void> {
  if (!(ASSIGNABLE as readonly string[]).includes(role)) throw new Refused("The Owner role cannot be assigned.");
  const target = await targetMember(member.org.id, userId);
  if (target.role === "owner") throw new Refused("The Owner's role is locked.");
  if (target.role === role) return;
  await db.update(schema.members).set({ role }).where(and(eq(schema.members.orgId, member.org.id), eq(schema.members.userId, userId)));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Changed a role", item: target.name, change: `${ROLE_LABEL[target.role]} to ${ROLE_LABEL[role]}` });
}

/** FR-003, FR-010: access ends at once; owned conversations go back to Needs a person. */
export async function removeMember(member: MemberContext, userId: string): Promise<void> {
  const target = await targetMember(member.org.id, userId);
  if (target.role === "owner") throw new Refused("The Owner cannot be removed.");
  const orgId = member.org.id;
  await db.transaction(async (tx) => {
    const owned = await tx
      .update(schema.conversations)
      .set({ state: "HANDOVER_PENDING", ownerUserId: null, version: sql`${schema.conversations.version} + 1`, reasonCode: "released", waitingSince: new Date() })
      .where(and(eq(schema.conversations.orgId, orgId), eq(schema.conversations.ownerUserId, userId), eq(schema.conversations.state, "HUMAN_ACTIVE")))
      .returning({ id: schema.conversations.id, version: schema.conversations.version });
    for (const c of owned) {
      await tx.insert(schema.ownershipEvents).values({
        orgId,
        conversationId: c.id,
        event: `Released: ${target.name} was removed from the team`,
        actor: "system",
        reasonCode: "released",
        version: c.version,
      });
    }
    await tx.delete(schema.members).where(and(eq(schema.members.orgId, orgId), eq(schema.members.userId, userId)));
    await tx.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.orgId, orgId)));
    await audit({ orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Removed a member", item: target.name, change: ROLE_LABEL[target.role] }, tx);
  });
  await publish(`org:${orgId}`, { type: "conversations" });
}

export const securityInput = z.object({
  require2fa: z.boolean(),
  sessionDays: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]),
});

export async function updateSecurity(member: MemberContext, input: z.infer<typeof securityInput>): Promise<void> {
  const before = member.org;
  await db.update(schema.organizations).set(input).where(eq(schema.organizations.id, member.org.id));
  const changes: string[] = [];
  if (before.require2fa !== input.require2fa) changes.push(`require 2-step sign-in ${input.require2fa ? "on" : "off"}`);
  if (before.sessionDays !== input.sessionDays) changes.push(`session length ${before.sessionDays} to ${input.sessionDays} days`);
  if (changes.length) {
    await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Changed security settings", item: member.org.name, change: changes.join("; ") });
  }
}

// ---------------------------------------------------------------- support access (OPS-003)

export const grantInput = z.object({
  hours: z.union([z.literal(1), z.literal(24), z.literal(72)]),
  includeConversations: z.boolean(),
});

export async function activeGrant(orgId: string) {
  return db.query.supportGrants.findFirst({
    where: and(eq(schema.supportGrants.orgId, orgId), isNull(schema.supportGrants.revokedAt), gt(schema.supportGrants.expiresAt, new Date())),
  });
}

export async function grantSupport(member: MemberContext, input: z.infer<typeof grantInput>): Promise<void> {
  const orgId = member.org.id;
  await db
    .update(schema.supportGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.supportGrants.orgId, orgId), isNull(schema.supportGrants.revokedAt)));
  await db.insert(schema.supportGrants).values({
    orgId,
    grantedBy: member.user.id,
    includeConversations: input.includeConversations,
    expiresAt: new Date(Date.now() + input.hours * 3_600_000),
  });
  await audit({
    orgId,
    actorUserId: member.user.id,
    actorName: member.user.name,
    area: "Users",
    action: "Granted support access",
    item: "Hiwar support",
    change: `${input.hours} hours, ${input.includeConversations ? "with" : "without"} conversations`,
  });
}

export async function revokeSupport(member: MemberContext): Promise<void> {
  const rows = await db
    .update(schema.supportGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.supportGrants.orgId, member.org.id), isNull(schema.supportGrants.revokedAt)))
    .returning({ id: schema.supportGrants.id });
  if (rows.length) {
    await db.delete(schema.sessions).where(and(eq(schema.sessions.orgId, member.org.id), isNotNull(schema.sessions.supportGrantId)));
    await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Users", action: "Revoked support access", item: "Hiwar support" });
  }
}
