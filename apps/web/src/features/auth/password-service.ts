import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";

import { acceptInvitation } from "@/db/queries/identity";
import { mailReady, readMailSettings } from "@/db/queries/mail";
import { deletePersonSessions } from "@/db/queries/sessions";
import { audit } from "@/lib/audit";
import { startSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { escapeHtml } from "@/lib/mail-html";
import { sendMail } from "@/lib/mailer";
import { logger } from "@/lib/logger";
import { hashPassword, verifyNothing, verifyPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/password-rules";
import { countAgainst, reachedLimit, withinRate } from "@/lib/rate-window";
import { invitationTokenHash } from "@/lib/invitation";
import { SignInRefused } from "./errors";
import * as repository from "./repository";
import type { SignInPerson } from "./types";
import { linkPendingUaePass } from "./uae-pass-service";

/**
 * D387: the built-in password — signing in with it, the Forgot password link, and setting the
 * first one from an invitation. Every refusal is audited when it concerns a known person.
 */

/** One answer for an unknown address and a wrong password, so neither tells which it was. */
const NO_MATCH = new SignInRefused("That email and password do not match.", "البريد الإلكتروني وكلمة المرور غير متطابقين.");

/** How long a Forgot password link works. */
const RESET_MINUTES = 30;

/** The hex SHA-256 a reset link is stored and looked up by. */
const resetHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The first address of `x-forwarded-for`, which the gateway sets. */
async function clientAddress(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Audits one sign-in attempt on a known person. */
async function auditSignIn(person: SignInPerson, outcome: "Allowed" | "Denied", detail: Record<string, unknown>): Promise<void> {
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:sign_in",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { method: "Password", ...detail },
    outcome,
  });
}

/** Refuses a known person whose record is not Active (`UC-05.1-03`, D248). */
async function refuseInactive(person: SignInPerson): Promise<void> {
  if (person.status === "Active") return;
  await auditSignIn(person, "Denied", { status: person.status });
  if (person.status === "Invited") {
    throw new SignInRefused(
      "You are invited but have not accepted yet. Open the invitation link from your email, or ask for a new one.",
      "أنت مدعوّ ولم تقبل الدعوة بعد. افتح رابط الدعوة من بريدك، أو اطلب رابطاً جديداً.",
    );
  }
  if (person.status === "Pending") {
    throw new SignInRefused(
      "Your registration is waiting for approval. We will email you when it is approved.",
      "طلب تسجيلك بانتظار الاعتماد. سنراسلك عبر البريد الإلكتروني عند اعتماده.",
    );
  }
  throw new SignInRefused("Your access is suspended — contact your administrator.", "تم تعليق وصولك — تواصل مع مسؤول النظام.");
}

/**
 * Signs a person in with their email and password, and links a UAE PASS account waiting to be
 * linked (D387, manual linking). After 10 wrong attempts on an address, or 50 from one network
 * address, in 15 minutes, every attempt is refused until the window ends; a right one counts nothing.
 *
 * @throws {SignInRefused} for a wrong pair, too many wrong attempts, an account that is not Active,
 *   or a UAE PASS account that cannot be linked to it.
 */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const address = email.trim().toLowerCase();
  const keys = [`signin:email:${address}`, `signin:ip:${await clientAddress()}`];
  if ((await reachedLimit(keys[0], 10)) || (await reachedLimit(keys[1], 50))) {
    throw new SignInRefused("Too many attempts. Wait 15 minutes, then try again.", "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى.");
  }
  const countFailure = () => Promise.all(keys.map((key) => countAgainst(key, 900)));

  const person = await repository.personWithPassword(address);
  if (!person?.passwordHash) {
    await verifyNothing(password);
    await countFailure();
    throw NO_MATCH;
  }
  if (!(await verifyPassword(password, person.passwordHash))) {
    await countFailure();
    await auditSignIn(person, "Denied", { reason: "wrong password" });
    throw NO_MATCH;
  }
  await refuseInactive(person);
  const linked = await linkPendingUaePass(person);
  await startSession(person.id, "Password");
  await repository.recordSignInMethod(person.id, "Password");
  await auditSignIn(person, "Allowed", { linkedUaePass: linked });
}

/** The Forgot password email, in both languages; the link is the only thing in it that matters. */
function resetMail(person: SignInPerson, link: string): { subject: string; text: string; html: string } {
  const text =
    `Hello ${person.nameEn},\n\nTo choose a new password, open ${link}\nThe link works once, for ${RESET_MINUTES} minutes. ` +
    `If you did not ask for it, ignore this email.\n\n` +
    `مرحباً ${person.nameAr}،\n\nلاختيار كلمة مرور جديدة افتح ${link}\nيعمل الرابط مرة واحدة لمدة ${RESET_MINUTES} دقيقة. إن لم تطلبه فتجاهل هذا البريد.`;
  const anchor = `<a href="${escapeHtml(link)}">`;
  const html =
    `<p>Hello ${escapeHtml(person.nameEn)},</p><p>${anchor}Choose a new password</a></p>` +
    `<p>The link works once, for ${RESET_MINUTES} minutes. If you did not ask for it, ignore this email.</p>` +
    `<div dir="rtl"><p>مرحباً ${escapeHtml(person.nameAr)}،</p><p>${anchor}اختر كلمة مرور جديدة</a></p>` +
    `<p>يعمل الرابط مرة واحدة لمدة ${RESET_MINUTES} دقيقة. إن لم تطلبه فتجاهل هذا البريد.</p></div>`;
  return { subject: "Reset your password · إعادة تعيين كلمة المرور", text, html };
}

/**
 * Forgot password: emails an Active person a link to choose a new password. Answers the same
 * whether or not the address has an account, and sends after the response, so neither the
 * answer nor its timing tells. Three requests per address an hour.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!(await withinRate(`reset:email:${address}`, 3, 3600))) return;
  const person = await repository.personWithPassword(address);
  if (person?.status !== "Active") return;

  const token = randomBytes(32).toString("base64url");
  await repository.insertPasswordReset(person.id, resetHash(token), new Date(Date.now() + RESET_MINUTES * 60_000));
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:password_reset_request",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
  });
  const link = new URL(`/reset-password/${token}`, env().APP_URL).toString();
  after(async () => {
    const settings = await readMailSettings();
    if (!mailReady(settings)) return logger().warn({ personId: person.id }, "password reset not emailed: the platform mail server is not configured");
    try {
      await sendMail(settings, { to: person.email, ...resetMail(person, link) });
    } catch (problem) {
      logger().error({ personId: person.id, err: problem }, "password reset email failed");
    }
  });
}

/** Whether a reset link is still open, for the page it leads to. */
export async function resetLinkIsOpen(token: string): Promise<boolean> {
  return (await repository.openPasswordReset(resetHash(token))) !== null;
}

/**
 * Sets a new password from a Forgot password link, spends the link, and ends every session the
 * person held, since whoever forgot it may not be the only one who knew it.
 *
 * @throws {SignInRefused} when the link is no longer open or the password is refused.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const person = await repository.openPasswordReset(resetHash(token));
  if (!person) throw new SignInRefused("This link has expired or was used. Ask for a new one.", "انتهت صلاحية هذا الرابط أو استُخدم. اطلب رابطاً جديداً.");
  const problem = passwordProblem(password, person.email);
  if (problem) throw new SignInRefused(problem.en, problem.ar);
  if ((await repository.spendPasswordReset(resetHash(token))) !== person.id) {
    throw new SignInRefused("This link has expired or was used. Ask for a new one.", "انتهت صلاحية هذا الرابط أو استُخدم. اطلب رابطاً جديداً.");
  }
  await repository.savePassword(person.id, await hashPassword(password));
  await deletePersonSessions(person.id);
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:password_reset",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
  });
}

/**
 * D248 and D387: accepts an open invitation by choosing a password, makes the person Active
 * and signs them in. The emailed link is the proof of the address.
 *
 * @throws {SignInRefused} when the invitation is no longer open or the password is refused.
 */
export async function acceptInvitationWithPassword(token: string, personId: string, password: string): Promise<void> {
  const person = await repository.personById(personId);
  if (!person) throw new SignInRefused("This invitation link is not valid.", "رابط الدعوة هذا غير صالح.");
  const problem = passwordProblem(password, person.email);
  if (problem) throw new SignInRefused(problem.en, problem.ar);
  const accepted = await acceptInvitation(person.id, token);
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:invitation_accept",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { method: "Password" },
    outcome: accepted ? "Allowed" : "Denied",
  });
  if (!accepted) throw new SignInRefused("This invitation no longer works. Ask your administrator to send a new one.", "لم تعد هذه الدعوة صالحة. اطلب من المسؤول إرسال دعوة جديدة.");
  await repository.savePassword(person.id, await hashPassword(password));
  await startSession(person.id, "Password");
  await repository.recordSignInMethod(person.id, "Password");
}

/** The person an invitation token is for, so the page can accept it for them; null for an unknown token. */
export async function invitedPersonId(token: string): Promise<string | null> {
  return repository.personIdByInvitation(invitationTokenHash(token));
}
