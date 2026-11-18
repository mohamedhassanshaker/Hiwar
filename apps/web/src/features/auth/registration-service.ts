import { headers } from "next/headers";
import { after } from "next/server";

import { mailReady, readMailSettings } from "@/db/queries/mail";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { notifyInbox } from "@/lib/live";
import { escapeHtml } from "@/lib/mail-html";
import { sendMail } from "@/lib/mailer";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/password-rules";
import { withinRate } from "@/lib/rate-window";
import { requirePermission } from "@/lib/session";
import { Rejected } from "@/lib/rejection";
import { SignInRefused } from "./errors";
import * as repository from "./repository";
import { cancelPendingUaePass, pendingUaePassProfile } from "./uae-pass-service";

/**
 * D393: registering without an invitation. A person registers with an email and password, or
 * with UAE PASS, and waits as a Pending person. The holders of `registrations:approve` are told
 * in their Inbox and by email; approving makes the person Active with a role and emails them,
 * declining removes the registration. A Pending person cannot sign in (`UC-05.1-03`).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The role an approval grants unless the approver may grant permissions and picks another. */
const DEFAULT_ROLE = "Member";
/** Registrations from one network address in an hour. */
const REGISTRATIONS_PER_HOUR = 20;

const TAKEN = new SignInRefused(
  "This email is already registered. Sign in, or use Forgot password.",
  "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول أو استخدم نسيت كلمة المرور.",
);

/** An approval or a decline the approver is told about. */
export class RegistrationError extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RegistrationError";
  }
}

/** Initials from a name: the first letters of its first two words. */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/** The first address of `x-forwarded-for`, which the gateway sets. */
async function clientAddress(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Runs `send` for each address after the response, skipping and logging when the mail server is not set up. */
function mailAfter(what: string, messages: { to: string; subject: string; text: string; html: string }[]): void {
  if (messages.length === 0) return;
  after(async () => {
    const settings = await readMailSettings();
    if (!mailReady(settings)) return logger().warn({ what }, "registration email not sent: the platform mail server is not configured");
    for (const message of messages) {
      try {
        await sendMail(settings, message);
      } catch (problem) {
        logger().error({ what, err: problem }, "registration email failed");
      }
    }
  });
}

/** Stores a registration, audits it, and tells the approvers. */
async function register(values: { nameEn: string; nameAr: string; email: string; orgUnitId: string; passwordHash: string | null; uaePass: { uuid: string; idn: string | null } | null }): Promise<void> {
  const email = values.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new SignInRefused("That is not an email address.", "هذا ليس بريداً إلكترونياً.");
  if (!(await withinRate(`register:ip:${await clientAddress()}`, REGISTRATIONS_PER_HOUR, 3600))) {
    throw new SignInRefused("Too many registrations from this network. Try again in an hour.", "تسجيلات كثيرة من هذه الشبكة. حاول مرة أخرى بعد ساعة.");
  }
  if (!(await repository.orgUnitExists(values.orgUnitId))) {
    throw new SignInRefused("Choose your organization from the list.", "اختر جهتك من القائمة.");
  }
  const nameEn = values.nameEn.trim();
  const nameAr = values.nameAr.trim() || nameEn;
  const personId = await repository.insertRegistrant({ email, nameEn, nameAr, initials: initialsOf(nameEn), orgUnitId: values.orgUnitId, passwordHash: values.passwordHash, uaePass: values.uaePass });
  if (!personId) throw TAKEN;
  await audit({
    actor: { type: "Person", id: personId, label: nameEn },
    action: "auth:register",
    objectType: "Person",
    objectId: personId,
    objectLabel: email,
    detail: { method: values.uaePass ? "UAE PASS" : "Password" },
  });

  const approvers = await repository.approverIds();
  await repository.notifyApprovers(personId, approvers);
  await Promise.all(approvers.map((id) => notifyInbox(id, "registration")));
  const emails = await repository.emailsOf(approvers);
  const link = new URL("/people?status=Pending", env().APP_URL).toString();
  mailAfter(
    "approvers",
    emails.map((to) => ({
      to,
      subject: "New registration waiting for approval · طلب تسجيل جديد بانتظار الاعتماد",
      text: `${nameEn} (${email}) registered and is waiting for approval. Review it at ${link}\n\nسجّل ${nameAr} (${email}) وهو بانتظار الاعتماد. راجعه في ${link}`,
      html:
        `<p>${escapeHtml(nameEn)} (${escapeHtml(email)}) registered and is waiting for approval.</p><p><a href="${escapeHtml(link)}">Review the registration</a></p>` +
        `<div dir="rtl"><p>سجّل ${escapeHtml(nameAr)} (${escapeHtml(email)}) وهو بانتظار الاعتماد.</p><p><a href="${escapeHtml(link)}">راجع طلب التسجيل</a></p></div>`,
    })),
  );
}

/**
 * Registers a person with an email, a password and the organization they belong to.
 *
 * @throws {SignInRefused} for an address already on the platform, a password the rules refuse,
 *   an address that is not one, an organization that does not exist, or too many registrations
 *   from one network address.
 */
export async function registerWithPassword(input: { nameEn: string; nameAr: string; email: string; orgUnitId: string; password: string }): Promise<void> {
  const problem = passwordProblem(input.password, input.email.trim().toLowerCase());
  if (problem) throw new SignInRefused(problem.en, problem.ar);
  await register({ ...input, passwordHash: await hashPassword(input.password), uaePass: null });
}

/**
 * Registers the UAE PASS account waiting in this browser, with the email typed for it; the name
 * and Emirates ID are UAE PASS's.
 *
 * @throws {SignInRefused} as `registerWithPassword`, or when no UAE PASS account is waiting.
 */
export async function registerWithUaePass(input: { email: string; orgUnitId: string }): Promise<void> {
  const profile = await pendingUaePassProfile();
  if (!profile) throw new SignInRefused("Your UAE PASS sign-in expired. Start again.", "انتهت صلاحية تسجيل الدخول بالهوية الرقمية. ابدأ من جديد.");
  await register({ nameEn: profile.nameEn, nameAr: profile.nameAr, email: input.email, orgUnitId: input.orgUnitId, passwordHash: null, uaePass: { uuid: profile.uuid, idn: profile.idn } });
  await cancelPendingUaePass();
}

/**
 * Approves a Pending registration: the person becomes Active in `roleCode` (the Member role
 * unless the approver also holds `permissions:write`) and in the organization they registered in
 * unless `orgUnitId` names another, their Inbox items close for every approver,
 * and they are emailed that they can sign in.
 *
 * @throws {RegistrationError} when the registration is no longer pending, the role is unknown, or the
 *   approver may not grant that role.
 */
export async function approveRegistration(input: { personId: string; roleCode?: string; orgUnitId?: string | null }): Promise<void> {
  const session = await requirePermission("registrations:approve");
  const roleCode = input.roleCode ?? DEFAULT_ROLE;
  if (roleCode !== DEFAULT_ROLE) await requirePermission("permissions:write");
  const roleId = await repository.roleIdByCode(roleCode);
  if (!roleId) throw new RegistrationError("That role no longer exists.", "لم يعد هذا الدور موجوداً.");
  const person = await repository.pendingRegistrant(input.personId);
  if (!person) throw new RegistrationError("This registration was already decided.", "سبق البت في طلب التسجيل هذا.");
  if (!(await repository.activateRegistrant(person.id, roleId, input.orgUnitId ?? null, session.personId))) {
    throw new RegistrationError("This registration was already decided.", "سبق البت في طلب التسجيل هذا.");
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "registrations:approve",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { decision: "Approved", role: roleCode },
  });
  await tellApprovers(person.id);
  const link = new URL("/sign-in", env().APP_URL).toString();
  mailAfter("approved", [
    {
      to: person.email,
      subject: "Your account is approved · تم اعتماد حسابك",
      text: `Hello ${person.nameEn},\n\nYour registration was approved. You can sign in at ${link}\n\nمرحباً ${person.nameAr}،\n\nتم اعتماد تسجيلك. يمكنك تسجيل الدخول من ${link}`,
      html:
        `<p>Hello ${escapeHtml(person.nameEn)},</p><p>Your registration was approved. <a href="${escapeHtml(link)}">Sign in</a>.</p>` +
        `<div dir="rtl"><p>مرحباً ${escapeHtml(person.nameAr)}،</p><p>تم اعتماد تسجيلك. <a href="${escapeHtml(link)}">سجّل الدخول</a>.</p></div>`,
    },
  ]);
}

/**
 * Declines a Pending registration: the registration is removed, so the person may register again,
 * and every approver's Inbox item for it closes.
 *
 * @throws {RegistrationError} when the registration is no longer pending.
 */
export async function declineRegistration(personId: string): Promise<void> {
  const session = await requirePermission("registrations:approve");
  const person = await repository.pendingRegistrant(personId);
  if (!person || !(await repository.deleteRegistrant(person.id))) {
    throw new RegistrationError("This registration was already decided.", "سبق البت في طلب التسجيل هذا.");
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "registrations:approve",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { decision: "Declined" },
  });
  await tellApprovers(person.id);
}

/** Closes the registration's Inbox items and tells each approver's open screen. */
async function tellApprovers(personId: string): Promise<void> {
  const approvers = await repository.resolveRegistrationItems(personId);
  await Promise.all(approvers.map((id) => notifyInbox(id, "registration")));
}
