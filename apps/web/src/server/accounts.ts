import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import { z } from "zod";

import { db, schema } from "@/db";
import { Refused } from "./api";
import { audit } from "./audit";
import { hashToken, newToken, openText, sealText } from "./crypto";
import { env } from "./env";
import { sendMail } from "./mail";
import { hashPassword, verifyNothing, verifyPassword } from "./password";
import { latestPlanVersion } from "./plans";

/** ORG-004: sign-up, verification, sign-in, 2-step sign-in, invitations and password reset. */

export const PASSWORD_MIN = 12;
const VERIFY_HOURS = 24;
const RESET_HOURS = 1;
const LOCK_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60_000;
const INVITE_DAYS = 7;

export const signUpInput = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(200),
  orgName: z.string().trim().min(1, "Enter your organization's name.").max(120),
});

/** FR-001 to FR-003, FR-013: the account, the organization on a 14-day trial, and the verification email. */
export async function signUp(input: z.infer<typeof signUpInput>): Promise<{ userId: string }> {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, input.email) });
  if (existing) throw new Refused("An account with this email already exists. Sign in instead.", 409, { field: "email" });
  const trial = await latestPlanVersion("trial");
  const passwordHash = await hashPassword(input.password);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning({ id: schema.users.id });
    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: input.orgName,
        plan: "trial",
        status: "trial",
        planVersionId: trial.id,
        trialEndsAt: new Date(Date.now() + (trial.trialDays ?? 14) * 86_400_000),
      })
      .returning({ id: schema.organizations.id });
    await tx.insert(schema.members).values({ orgId: org.id, userId: user.id, role: "owner" });
    return user.id;
  });
  await sendVerification(userId, input.email);
  return { userId };
}

export async function sendVerification(userId: string, email: string): Promise<void> {
  const { token, hash } = newToken();
  await db.insert(schema.oneTimeTokens).values({
    tokenHash: hash,
    userId,
    purpose: "verify_email",
    expiresAt: new Date(Date.now() + VERIFY_HOURS * 3_600_000),
  });
  await sendMail(
    email,
    "Verify your email for Hiwar",
    `Open this link within ${VERIFY_HOURS} hours to verify your email and open your control panel:\n\n${env().APP_URL}/verify-email?token=${token}\n`,
  );
}

/** Consumes a one-time token of a purpose; returns the user id or null when invalid, used or expired. */
async function consume(token: string, purpose: "verify_email" | "reset_password"): Promise<string | null> {
  const [row] = await db
    .update(schema.oneTimeTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.oneTimeTokens.tokenHash, hashToken(token)),
        eq(schema.oneTimeTokens.purpose, purpose),
        isNull(schema.oneTimeTokens.usedAt),
        gt(schema.oneTimeTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: schema.oneTimeTokens.userId });
  return row?.userId ?? null;
}

/** FR-003/FR-004: marks the email verified; returns the user and their organization. */
export async function verifyEmail(token: string): Promise<{ userId: string; orgId: string | null } | null> {
  const userId = await consume(token, "verify_email");
  if (!userId) return null;
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId));
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, userId) });
  return { userId, orgId: member?.orgId ?? null };
}

export type SignInResult =
  | { ok: true; userId: string; orgId: string | null; needsCode: boolean }
  | { ok: false; error: string; unverified?: boolean };

const WRONG = "Email or password is incorrect.";

/** FR-005 to FR-007: password check with the 5-in-15-minutes lock. */
export async function signIn(emailRaw: string, password: string): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) {
    await verifyNothing(password);
    return { ok: false, error: WRONG };
  }
  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const windowOpen = user.firstFailedAt && now - user.firstFailedAt.getTime() < LOCK_WINDOW_MS;
    const attempts = windowOpen ? user.failedAttempts + 1 : 1;
    const lock = attempts >= LOCK_ATTEMPTS;
    await db
      .update(schema.users)
      .set({
        failedAttempts: lock ? 0 : attempts,
        firstFailedAt: lock ? null : windowOpen ? user.firstFailedAt : new Date(now),
        lockedUntil: lock ? new Date(now + LOCK_WINDOW_MS) : null,
      })
      .where(eq(schema.users.id, user.id));
    if (lock) {
      await sendMail(
        user.email,
        "Sign-in to Hiwar blocked for 15 minutes",
        "There were 5 failed sign-in attempts on your account in 15 minutes, so sign-in is blocked for 15 minutes. If this was not you, reset your password.",
      );
    }
    return { ok: false, error: WRONG };
  }
  await db.update(schema.users).set({ failedAttempts: 0, firstFailedAt: null, lockedUntil: null }).where(eq(schema.users.id, user.id));
  if (!user.emailVerifiedAt) return { ok: false, error: "Verify your email first. We sent you a new link.", unverified: true };
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id) });
  if (member) {
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, member.orgId) });
    if (org?.status === "suspended") return { ok: false, error: "This organization is suspended. Contact support." };
  }
  return { ok: true, userId: user.id, orgId: member?.orgId ?? null, needsCode: Boolean(user.totpEnabledAt) };
}

// ---------------------------------------------------------------- 2-step sign-in

function totpFor(secret: string, email: string) {
  return new TOTP({ issuer: "Hiwar", label: email, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

/** A new secret for set-up, sealed for storage, with its otpauth URI for the QR code. */
export function newTotpSecret(email: string): { sealed: string; uri: string; base32: string } {
  const secret = new Secret({ size: 20 });
  const totp = totpFor(secret.base32, email);
  return { sealed: sealText(secret.base32), uri: totp.toString(), base32: secret.base32 };
}

/** The pending set-up secret travels in the form, sealed and bound to the user. */
export function sealPending(userId: string, sealed: string): string {
  return sealText(JSON.stringify({ userId, sealed, at: Date.now() }));
}

export function openPending(userId: string, value: string): string | null {
  try {
    const data = JSON.parse(openText(value)) as { userId: string; sealed: string; at: number };
    return data.userId === userId && Date.now() - data.at < 15 * 60_000 ? data.sealed : null;
  } catch {
    return null;
  }
}

export function checkTotp(sealed: string, email: string, code: string): boolean {
  const totp = totpFor(openText(sealed), email);
  return totp.validate({ token: code.replace(/\s/g, ""), window: 1 }) !== null;
}

/** Confirms set-up: stores the sealed secret when the code matches (FR-008). */
export async function enableTotp(userId: string, email: string, sealed: string, code: string): Promise<boolean> {
  if (!checkTotp(sealed, email, code)) return false;
  await db.update(schema.users).set({ totpSecret: sealed, totpEnabledAt: new Date() }).where(eq(schema.users.id, userId));
  return true;
}

// ---------------------------------------------------------------- password reset

/** FR-012: always the same answer, whether or not the account exists. */
export async function requestReset(emailRaw: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, emailRaw.trim().toLowerCase()) });
  if (!user) return;
  const { token, hash } = newToken();
  await db.insert(schema.oneTimeTokens).values({
    tokenHash: hash,
    userId: user.id,
    purpose: "reset_password",
    expiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000),
  });
  await sendMail(
    user.email,
    "Reset your Hiwar password",
    `Open this link within 1 hour to set a new password. It works once.\n\n${env().APP_URL}/reset-password?token=${token}\n`,
  );
}

/** Sets the new password and ends every session of the member (FR-012). */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  if (password.length < PASSWORD_MIN) throw new Refused(`Use at least ${PASSWORD_MIN} characters.`);
  const userId = await consume(token, "reset_password");
  if (!userId) return false;
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), emailVerifiedAt: sql`coalesce(email_verified_at, now())` }).where(eq(schema.users.id, userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  return true;
}

// ---------------------------------------------------------------- invitations

export async function findInvitation(token: string) {
  const invitation = await db.query.invitations.findFirst({ where: eq(schema.invitations.tokenHash, hashToken(token)) });
  if (!invitation || invitation.acceptedAt || invitation.cancelledAt || invitation.expiresAt <= new Date()) return null;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, invitation.orgId) });
  return org ? { invitation, org } : null;
}

/** FR-011: accepting creates the account (or joins an existing one) with the invited role. */
export async function acceptInvitation(
  token: string,
  name: string,
  password: string,
): Promise<{ userId: string; orgId: string } | null> {
  const found = await findInvitation(token);
  if (!found) return null;
  const { invitation } = found;
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, invitation.email) });
  if (existing && !(await verifyPassword(password, existing.passwordHash))) {
    throw new Refused("An account with this email exists. Enter its password to join.", 401);
  }
  if (!existing && password.length < PASSWORD_MIN) throw new Refused(`Use at least ${PASSWORD_MIN} characters.`);
  const userId = await db.transaction(async (tx) => {
    const id =
      existing?.id ??
      (
        await tx
          .insert(schema.users)
          .values({ email: invitation.email, name: name.trim() || invitation.email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() })
          .returning({ id: schema.users.id })
      )[0].id;
    await tx.insert(schema.members).values({ orgId: invitation.orgId, userId: id, role: invitation.role }).onConflictDoNothing();
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, invitation.id));
    await audit(
      { orgId: invitation.orgId, actorUserId: id, actorName: name.trim() || invitation.email, area: "Users", action: "Joined", item: invitation.email, change: `role ${invitation.role}` },
      tx,
    );
    return id;
  });
  await db.insert(schema.notifications).values({
    orgId: invitation.orgId,
    roles: ["owner", "admin"],
    kind: "invitation_accepted",
    title: `${invitation.email} accepted the invitation`,
    link: "/team",
  });
  return { userId, orgId: invitation.orgId };
}

export function invitationExpiry(): Date {
  return new Date(Date.now() + INVITE_DAYS * 86_400_000);
}
