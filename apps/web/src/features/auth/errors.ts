import { Rejected } from "@/lib/rejection";

/**
 * D387: why a sign-in did not complete. A refusal raised while the person is on a form is a
 * `SignInRefused` the form shows; one reached through the UAE PASS round trip travels as one
 * of these codes on `/sign-in?error=`, and the sign-in screen words it (`components/sign-in.tsx`).
 */
export const SIGN_IN_ERRORS = {
  suspended: "AccessSuspended",
  invitation: "InvitationRequired",
  pending: "RegistrationPending",
  cancelled: "UaePassCancelled",
  unverified: "UaePassUnverified",
  failed: "UaePassFailed",
  mismatch: "UaePassMismatch",
} as const;

/** A sign-in or password change the person is told about in both languages. */
export class SignInRefused extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "SignInRefused";
  }
}

/** A path inside the console to go to after signing in; anything else (another origin, `//host`) is `/`. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
