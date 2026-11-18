import { cookies } from "next/headers";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";

import { audit } from "@/lib/audit";
import { maskEmiratesId } from "@/lib/emirates-id";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import type { MyProfileData } from "./components/profile";
import * as repository from "./repository";
import type { PasskeyRegistrationInput } from "./schema";

/** S-04 and S-05: my profile, its notification preferences, passkeys and active sessions. */
export async function loadMyProfile(): Promise<MyProfileData> {
  const session = await requireSession();
  const [people, person, preference, security, identity] = await Promise.all([
    repository.listPeople(),
    repository.readPerson(session.personId),
    repository.readNotificationPreference(session.personId),
    repository.listSecurity(session.personId),
    repository.personEmiratesId(session.personId),
  ]);
  const me = people.find((candidate) => candidate.id === session.personId);
  if (!me || !person) throw new Error("The signed-in person is not in the directory.");
  return {
    me,
    // D387: read-only here, and masked: the screen only confirms which ID it is.
    emiratesId: identity?.emiratesId ? maskEmiratesId(identity.emiratesId) : null,
    uaePassLinked: identity?.linked ?? false,
    mobile: person.mobile,
    preferredLanguage: person.preferredLanguage,
    version: person.version,
    preference: {
      approvals: preference?.approvals ?? true,
      mentions: preference?.mentions ?? true,
      slaWarnings: preference?.slaWarnings ?? true,
      dailyDigest: preference?.dailyDigest ?? false,
      requestCreatedEmail: preference?.requestCreatedEmail ?? true,
      requestUpdatedEmail: preference?.requestUpdatedEmail ?? true,
      requestFinishedEmail: preference?.requestFinishedEmail ?? true,
      workItemFinishedEmail: preference?.workItemFinishedEmail ?? true,
    },
    passkeys: security.passkeys.map((passkey) => ({
      id: passkey.id,
      label: passkey.label,
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
      createdAt: passkey.createdAt.toISOString(),
    })),
    sessions: security.sessions.map((authSession) => ({
      token: authSession.token,
      userAgent: authSession.userAgent,
      ipAddress: authSession.ipAddress,
      lastSeenAt: authSession.lastSeenAt.toISOString(),
      expires: authSession.expires.toISOString(),
    })),
  };
}

/**
 * `UC-04.3-02` and requirement 26: registering a passkey, through the SimpleWebAuthn
 * attestation ceremony.
 *
 * The challenge is issued here and kept in an http-only cookie for the length of the
 * ceremony — a minute — so the browser never decides what it is being asked to sign, and
 * `verifyRegistrationResponse` checks the answer against the same value.
 */
const CHALLENGE_COOKIE = "awp.webauthn.challenge";

const CHALLENGE_SECONDS = 60;

/**
 * Begin registering a passkey for the signed-in person: the WebAuthn registration options,
 * with the challenge also set in an http-only cookie for 60 seconds.
 */
export async function startPasskeyRegistration() {
  const session = await requireSession();
  const { WEBAUTHN_RP_ID, APP_URL } = env();

  const options = await generateRegistrationOptions({
    rpName: "Agentic Work Platform",
    rpID: WEBAUTHN_RP_ID,
    userID: isoUint8Array.fromUTF8String(session.personId),
    userName: session.email,
    userDisplayName: session.nameEn,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const store = await cookies();
  store.set(CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CHALLENGE_SECONDS,
    secure: APP_URL.startsWith("https://"),
  });

  return options;
}

/**
 * Verify the browser's attestation against the challenge cookie, the app's origin and the
 * relying party id, then store the passkey with an audit entry. The cookie is deleted once the
 * answer is checked.
 *
 * @throws {Error} when the challenge cookie has expired or the attestation does not verify.
 */
export async function finishPasskeyRegistration(input: PasskeyRegistrationInput): Promise<void> {
  const session = await requireSession();
  const { WEBAUTHN_RP_ID, APP_URL } = env();
  const store = await cookies();
  const expectedChallenge = store.get(CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) throw new Error("The passkey registration timed out. Start it again.");

  type VerifyOptions = Parameters<typeof verifyRegistrationResponse>[0];
  const verification = await verifyRegistrationResponse({
    response: input.response as unknown as VerifyOptions["response"],
    expectedChallenge,
    expectedOrigin: APP_URL,
    expectedRPID: WEBAUTHN_RP_ID,
  });
  store.delete(CHALLENGE_COOKIE);
  if (!verification.verified || !verification.registrationInfo) throw new Error("That passkey could not be verified.");

  const { credential } = verification.registrationInfo;
  await repository.insertPasskey({
    personId: session.personId,
    label: input.label,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: (input.response.transports as string[] | undefined) ?? null,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "profile:passkey_register",
    objectType: "Passkey",
    objectLabel: input.label,
  });
}

/** Delete one of the signed-in person's passkeys and audit it; another person's id deletes nothing. */
export async function removePasskey(passkeyId: string): Promise<void> {
  const session = await requireSession();
  const label = await repository.deletePasskey(session.personId, passkeyId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "profile:passkey_remove",
    objectType: "Passkey",
    objectId: passkeyId,
    objectLabel: label,
  });
}
