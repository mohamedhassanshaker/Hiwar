"use server";

import { redirect } from "next/navigation";

import { SignInRefused, safeNext } from "./errors";
import { acceptInvitationWithPassword, invitedPersonId, requestPasswordReset, resetPassword, signInWithPassword } from "./password-service";
import { registerWithPassword, registerWithUaePass } from "./registration-service";
import { newPasswordInput, passwordResetRequestInput, passwordSignInInput, registerInput, uaePassRegisterInput } from "./schema";
import { cancelPendingUaePass } from "./uae-pass-service";

/**
 * D387: the sign-in screens' server actions. A refusal comes back as both languages for the
 * form to show; success leaves the page with a redirect.
 */

export type AuthOutcome = { ok: true } | { ok: false; message: string; messageAr: string };

/** What a form shows for input that did not even parse. */
const UNREADABLE: AuthOutcome = { ok: false, message: "Fill in every field.", messageAr: "املأ جميع الحقول." };

/** Runs a sign-in step, turning its refusal into the form's message. */
async function refusalOf(step: () => Promise<void>): Promise<AuthOutcome | null> {
  try {
    await step();
    return null;
  } catch (problem) {
    if (problem instanceof SignInRefused) return { ok: false, message: problem.message, messageAr: problem.messageAr };
    throw problem;
  }
}

/** Signs in with email and password, then goes to `next` (a console path) or the landing page. */
export async function signInWithPasswordAction(input: unknown): Promise<AuthOutcome> {
  const parsed = passwordSignInInput.safeParse(input);
  if (!parsed.success) return UNREADABLE;
  const refused = await refusalOf(() => signInWithPassword(parsed.data.email, parsed.data.password));
  if (refused) return refused;
  redirect(safeNext(parsed.data.next));
}

/** Forgot password: always answers ok, whether or not the address has an account. */
export async function requestPasswordResetAction(input: unknown): Promise<AuthOutcome> {
  const parsed = passwordResetRequestInput.safeParse(input);
  if (!parsed.success) return UNREADABLE;
  await requestPasswordReset(parsed.data.email);
  return { ok: true };
}

/** Sets a new password from a reset link, then back to sign-in to use it. */
export async function resetPasswordAction(input: unknown): Promise<AuthOutcome> {
  const parsed = newPasswordInput.safeParse(input);
  if (!parsed.success) return mismatchOrUnreadable(parsed.error);
  const refused = await refusalOf(() => resetPassword(parsed.data.token, parsed.data.password));
  if (refused) return refused;
  redirect("/sign-in?reset=done");
}

/** Accepts an invitation by choosing a password, then into the console. */
export async function acceptInvitationAction(input: unknown): Promise<AuthOutcome> {
  const parsed = newPasswordInput.safeParse(input);
  if (!parsed.success) return mismatchOrUnreadable(parsed.error);
  const personId = await invitedPersonId(parsed.data.token);
  if (!personId) return { ok: false, message: "This invitation link is not valid.", messageAr: "رابط الدعوة هذا غير صالح." };
  const refused = await refusalOf(() => acceptInvitationWithPassword(parsed.data.token, personId, parsed.data.password));
  if (refused) return refused;
  redirect("/");
}

/** D393: registers with an email and password, then to sign-in with the news that approval is awaited. */
export async function registerAction(input: unknown): Promise<AuthOutcome> {
  const parsed = registerInput.safeParse(input);
  if (!parsed.success) return mismatchOrUnreadable(parsed.error);
  const refused = await refusalOf(() => registerWithPassword(parsed.data));
  if (refused) return refused;
  redirect("/sign-in?registered=done");
}

/** D393: registers the UAE PASS account waiting in this browser, with the email typed for it. */
export async function registerWithUaePassAction(input: unknown): Promise<AuthOutcome> {
  const parsed = uaePassRegisterInput.safeParse(input);
  if (!parsed.success) return UNREADABLE;
  const refused = await refusalOf(() => registerWithUaePass(parsed.data));
  if (refused) return refused;
  redirect("/sign-in?registered=done");
}

/** Drops the UAE PASS account waiting to be linked, leaving the plain sign-in screen. */
export async function cancelUaePassLinkAction(): Promise<void> {
  await cancelPendingUaePass();
  redirect("/sign-in");
}

/** The two passwords typed differently, or else unreadable input. */
function mismatchOrUnreadable(error: { issues: { path: PropertyKey[] }[] }): AuthOutcome {
  return error.issues.some((issue) => issue.path[0] === "confirm")
    ? { ok: false, message: "The two passwords are not the same.", messageAr: "كلمتا المرور غير متطابقتين." }
    : UNREADABLE;
}
