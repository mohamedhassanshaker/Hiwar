"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/db";
import {
  acceptInvitation,
  checkTotp,
  enableTotp,
  openPending,
  requestReset,
  resetPassword,
  sendVerification,
  signIn,
  signUp,
  signUpInput,
} from "@/server/accounts";
import { Refused } from "@/server/api";
import { getSession, startSession } from "@/server/session";

export type FormState = { error?: string; fields?: Record<string, string[] | undefined>; done?: string } | undefined;

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/conversations";
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the highlighted fields.", fields: parsed.error.flatten().fieldErrors };
  try {
    await signUp(parsed.data);
  } catch (problem) {
    if (problem instanceof Refused) return { error: problem.message, fields: { email: [problem.message] } };
    throw problem;
  }
  return { done: `We sent a verification link to ${parsed.data.email}. Open it within 24 hours to start your trial.` };
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const result = await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!result.ok) {
    if (result.unverified) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.email, String(form.get("email")).trim().toLowerCase()) });
      if (user) await sendVerification(user.id, user.email);
    }
    return { error: result.error };
  }
  await startSession(result.userId, result.orgId, !result.needsCode);
  const next = safeNext(form.get("next"));
  redirect(result.needsCode ? `/two-step?next=${encodeURIComponent(next)}` : next);
}

export async function twoStepAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.user.totpSecret || !checkTotp(session.user.totpSecret, session.user.email, String(form.get("code") ?? ""))) {
    return { error: "That code is not valid. Enter the current 6-digit code from your authenticator app." };
  }
  await db.update(schema.sessions).set({ mfaPassed: true }).where(eq(schema.sessions.id, session.sessionId));
  redirect(safeNext(form.get("next")));
}

export async function setupTwoStepAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const sealed = openPending(session.user.id, String(form.get("pending") ?? ""));
  if (!sealed) return { error: "The set-up expired. Reload the page to get a new code." };
  const ok = await enableTotp(session.user.id, session.user.email, sealed, String(form.get("code") ?? ""));
  if (!ok) return { error: "That code is not valid. Scan the QR code again and enter the current code." };
  await db.update(schema.sessions).set({ mfaPassed: true }).where(eq(schema.sessions.id, session.sessionId));
  redirect("/conversations");
}

export async function forgotAction(_: FormState, form: FormData): Promise<FormState> {
  await requestReset(String(form.get("email") ?? ""));
  return { done: "If an account exists for that email, we sent a link to reset the password. It works once within 1 hour." };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const ok = await resetPassword(String(form.get("token") ?? ""), String(form.get("password") ?? ""));
    if (!ok) return { error: "This link is no longer valid. Ask for a new one." };
  } catch (problem) {
    if (problem instanceof Refused) return { error: problem.message };
    throw problem;
  }
  return { done: "Your password is changed and your other sessions are signed out. Sign in with the new password." };
}

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const joined = await acceptInvitation(String(form.get("token") ?? ""), String(form.get("name") ?? ""), String(form.get("password") ?? ""));
    if (!joined) return { error: "This invitation is no longer valid. Ask for a new one." };
    await startSession(joined.userId, joined.orgId, false);
  } catch (problem) {
    if (problem instanceof Refused) return { error: problem.message };
    throw problem;
  }
  redirect("/conversations");
}
