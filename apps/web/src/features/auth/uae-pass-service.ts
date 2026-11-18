import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { audit } from "@/lib/audit";
import { startSession, type SignInMethod } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { seal, unseal } from "@/lib/sealed";
import { SIGN_IN_ERRORS, SignInRefused, safeNext } from "./errors";
import * as repository from "./repository";
import type { PendingUaePass as Pending, SignInPerson } from "./types";
import { authorizeUrl, CANCELLED, exchangeCode, logoutUrl, uaePassConfigured, UaePassFailed, userInfo, type UaePassProfile } from "./uae-pass";

/**
 * D387: signing in with UAE PASS and linking it to a person, following UAE PASS's account
 * linking guidelines:
 *
 * - a UAE PASS account already linked (its `uuid`) signs its person in;
 * - otherwise the Emirates ID it returns (`idn`) finds the person an admin recorded it on, and
 *   the two are linked automatically, once;
 * - otherwise the person links it themselves by signing in once with their email and password
 *   (manual linking), or registers it (D393) and waits for approval;
 * - an unverified (SOP1) account is refused with UAE PASS's own message.
 */

const STATE_COOKIE = "awp-uaepass-state";
const LINK_COOKIE = "awp-uaepass-link";
/** Ten minutes for the round trip and for a link waiting on the password. */
const COOKIE_SECONDS = 600;

/** Sets one of the two short-lived cookies of this flow. */
async function setFlowCookie(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_SECONDS });
}

/** Starts a UAE PASS sign-in: the address to send the browser to, with its state in a sealed cookie. */
export async function beginUaePass(next: string | null, lang: "en" | "ar"): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await setFlowCookie(STATE_COOKIE, seal("uaepass-state", { state, next: safeNext(next) }, COOKIE_SECONDS));
  return authorizeUrl(state, lang);
}

/** `/sign-in` with a code the screen words. */
const refusedWith = (code: string) => `/sign-in?error=${code}`;

/**
 * Finishes the round trip UAE PASS sends the browser back on, and returns where to send it
 * next: the console, `/sign-in` to link the account, or `/sign-in` with why it failed.
 */
export async function finishUaePass(params: URLSearchParams): Promise<string> {
  const jar = await cookies();
  const started = unseal<{ state: string; next: string }>("uaepass-state", jar.get(STATE_COOKIE)?.value);
  jar.delete(STATE_COOKIE);
  if (!started || params.get("state") !== started.state) {
    logger().warn("uaepass callback: no matching state");
    return refusedWith(SIGN_IN_ERRORS.failed);
  }
  const error = params.get("error");
  if (error) return refusedWith(CANCELLED.has(error) ? SIGN_IN_ERRORS.cancelled : SIGN_IN_ERRORS.failed);

  let profile: UaePassProfile;
  try {
    profile = await userInfo(await exchangeCode(params.get("code") ?? ""));
  } catch (problem) {
    if (!(problem instanceof UaePassFailed)) throw problem;
    logger().warn({ reason: problem.message }, "uaepass sign-in failed");
    return refusedWith(SIGN_IN_ERRORS.failed);
  }
  if (profile.userType === "SOP1") return refusedWith(SIGN_IN_ERRORS.unverified);
  return signInAs(profile, started.next);
}

/** Signs in the person this profile belongs to, linking it by Emirates ID, or sends them to link it. */
async function signInAs(profile: UaePassProfile, next: string): Promise<string> {
  const linked = await repository.personByUaePass(profile.uuid);
  const person = linked ?? (profile.idn ? await repository.personByEmiratesId(profile.idn) : null);
  if (!person) {
    const pending: Pending = { uuid: profile.uuid, idn: profile.idn, nameEn: profile.nameEn, nameAr: profile.nameAr };
    await setFlowCookie(LINK_COOKIE, seal("uaepass-link", pending, COOKIE_SECONDS));
    // A person who came from Register finishes there (D393); one who came from Sign in links an account.
    return next.startsWith("/register") ? "/register" : `/sign-in?link=uaepass&next=${encodeURIComponent(next)}`;
  }
  if (person.status !== "Active") {
    await auditUaePass(person, "Denied", { status: person.status });
    return refusedWith(({ Invited: SIGN_IN_ERRORS.invitation, Pending: SIGN_IN_ERRORS.pending } as Record<string, string>)[person.status] ?? SIGN_IN_ERRORS.suspended);
  }
  if (!linked) {
    // Matched by Emirates ID: one UAE PASS account per person, so another one already linked is refused.
    if (await repository.uaePassOf(person.id)) {
      await auditUaePass(person, "Denied", { reason: "another UAE PASS account is linked" });
      return refusedWith(SIGN_IN_ERRORS.mismatch);
    }
    await repository.linkUaePass(person.id, profile.uuid, profile.idn);
  }
  await startSession(person.id, "UAE PASS");
  await repository.recordSignInMethod(person.id, "UAE PASS");
  await auditUaePass(person, "Allowed", { linked: linked ? "before" : "automatically, by Emirates ID" });
  return next;
}

/** Audits one UAE PASS sign-in on a known person; the Emirates ID itself is never recorded. */
async function auditUaePass(person: SignInPerson, outcome: "Allowed" | "Denied", detail: Record<string, unknown>): Promise<void> {
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:sign_in",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { method: "UAE PASS", ...detail },
    outcome,
  });
}

/** The UAE PASS account waiting in this browser, to link or to register, or null. */
export async function pendingUaePassProfile(): Promise<Pending | null> {
  return unseal<Pending>("uaepass-link", (await cookies()).get(LINK_COOKIE)?.value);
}

/** The name of the UAE PASS account waiting to be linked, for the sign-in screen, or null. */
export async function pendingUaePass(): Promise<{ nameEn: string; nameAr: string } | null> {
  const pending = unseal<Pending>("uaepass-link", (await cookies()).get(LINK_COOKIE)?.value);
  return pending ? { nameEn: pending.nameEn, nameAr: pending.nameAr } : null;
}

/** Drops the UAE PASS account waiting to be linked. */
export async function cancelPendingUaePass(): Promise<void> {
  (await cookies()).delete(LINK_COOKIE);
}

/**
 * Manual linking: links the UAE PASS account waiting in this browser to the person who just
 * proved their password, and returns whether there was one. Refused when either side is
 * already linked elsewhere or the Emirates IDs differ.
 *
 * @throws {SignInRefused} when the accounts cannot be linked; no session is opened then.
 */
export async function linkPendingUaePass(person: SignInPerson): Promise<boolean> {
  const pending = unseal<Pending>("uaepass-link", (await cookies()).get(LINK_COOKIE)?.value);
  if (!pending) return false;
  await cancelPendingUaePass();
  const holder = pending.idn ? await repository.personByEmiratesId(pending.idn) : null;
  const clash =
    (person.emiratesId !== null && pending.idn !== null && person.emiratesId !== pending.idn) ||
    (holder !== null && holder.id !== person.id) ||
    (await repository.uaePassOf(person.id)) !== null ||
    (await repository.personByUaePass(pending.uuid)) !== null;
  if (clash) {
    await auditUaePass(person, "Denied", { reason: "UAE PASS link refused" });
    throw new SignInRefused(
      "Your UAE PASS cannot be linked to this account: it is linked elsewhere or its Emirates ID is a different one. Ask your administrator.",
      "لا يمكن ربط الهوية الرقمية بهذا الحساب: فهي مرتبطة بحساب آخر أو رقم الهوية الإماراتية مختلف. تواصل مع مسؤول النظام.",
    );
  }
  await repository.linkUaePass(person.id, pending.uuid, pending.idn);
  await audit({
    actor: { type: "Person", id: person.id, label: person.nameEn },
    action: "auth:uaepass_link",
    objectType: "Person",
    objectId: person.id,
    objectLabel: person.email,
    detail: { mode: "manual" },
  });
  return true;
}

/** Where Log out ends: UAE PASS's logout for a UAE PASS session, as its guide requires, else the sign-in page. */
export function signOutDestination(method: SignInMethod | null): string {
  return method === "UAE PASS" && uaePassConfigured() ? logoutUrl() : "/sign-in";
}
