"use server";

import { revalidatePath } from "next/cache";

import { type FieldNames, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import { approveRegistration as approveRegistrationService, declineRegistration as declineRegistrationService } from "@/features/auth/service";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import * as repository from "./repository";
import * as service from "./service";
import { ROUTES } from "@/lib/route-table";
import {
  emiratesIdInput,
  notificationPreferenceInput,
  orgUnitInput,
  orgUnitRemovalInput,
  passkeyIdInput,
  passkeyRegistrationInput,
  profileInput,
  inviteInput,
  approveRegistrationInput,
  personIdInput,
  placementInput,
  profilePhotoInput,
  reportingLineInput,
  roleCodeInput,
  rolePermissionsInput,
  sessionTokenInput,
  updateOrgUnitInput,
} from "./schema";

/**
 * The mutations My profile offers (S-04). Every one validates its input, checks the
 * session, writes through the repository and leaves an audit entry (`COM-18`).
 */

/** `UC-04.1-01`, `UC-04.1-02`, `UC-04.1-04` and `COM-10`. */
export async function saveProfile(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const session = await requireSession();
    const values = profileInput.parse(input);
    await repository.updatePerson(
      session.personId,
      {
        nameEn: values.nameEn,
        nameAr: values.nameAr,
        mobile: values.mobile && values.mobile.length > 0 ? values.mobile : null,
        preferredLanguage: values.preferredLanguage,
      },
      values.version,
    );
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "profile:update",
      objectType: "Person",
      objectId: session.personId,
      objectLabel: values.nameEn,
      detail: { preferredLanguage: values.preferredLanguage },
    });
  });
  revalidatePath("/profile");
  return outcome;
}

/** `UC-04.1-03` and `UC-04.1-05`: the photo, refused unless it is a small PNG, JPEG or WebP. */
export async function saveProfilePhoto(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const session = await requireSession();
    const { photo, version } = profilePhotoInput.parse(input);
    await repository.updatePersonPhoto(session.personId, photo, version);
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "profile:photo",
      objectType: "Person",
      objectId: session.personId,
      objectLabel: session.nameEn,
    });
  });
  revalidatePath("/profile");
  return outcome;
}

/** The signed-in person's notification and email switches, saved whole, with an audit entry. */
export async function saveNotificationPreferences(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const session = await requireSession();
    const values = notificationPreferenceInput.parse(input);
    await repository.updateNotificationPreference(session.personId, values);
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "profile:notifications",
      objectType: "Person",
      objectId: session.personId,
      objectLabel: session.nameEn,
      detail: values,
    });
  });
  revalidatePath("/profile");
  return outcome;
}

/**
 * Sign out one of the person's own sessions by its token; a token of somebody else's matches
 * nothing. The audit entry names only the token's first 8 characters.
 */
export async function revokeSession(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const session = await requireSession();
    const { token } = sessionTokenInput.parse(input);
    await repository.revokeSession(session.personId, token);
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "profile:revoke_session",
      objectType: "AuthSession",
      objectLabel: `${token.slice(0, 8)}…`,
    });
  });
  revalidatePath("/profile");
  return outcome;
}

/** `UC-04.3-02`: the two halves of the SimpleWebAuthn attestation ceremony, and removal. */
export async function startPasskeyRegistration() {
  return service.startPasskeyRegistration();
}

/** `UC-04.3-02`: verify the browser's attestation and store the passkey, or return why it failed. */
export async function finishPasskeyRegistration(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    await service.finishPasskeyRegistration(passkeyRegistrationInput.parse(input));
  });
  revalidatePath("/profile");
  return outcome;
}

/** `UC-04.3-02`: remove one of the person's own passkeys. */
export async function removePasskey(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    await service.removePasskey(passkeyIdInput.parse(input).id);
  });
  revalidatePath("/profile");
  return outcome;
}

/** What the typed fields are called, for a refusal that names the field instead of a thrown 500 (`COM-12`). */
const FIELDS: FieldNames = {
  code: ["The code", "الرمز"],
  nameEn: ["The English name", "الاسم بالإنجليزية"],
  nameAr: ["The Arabic name", "الاسم بالعربية"],
  emails: ["The list of addresses", "قائمة العناوين"],
};

/**
 * `UC-42.1-02`: create an org unit. A duplicate code or a missing parent comes back as a
 * message for the modal rather than an unhandled error (`COM-12`).
 */
export async function createOrgUnit(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = orgUnitInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.createOrgUnit(parsed.data);
  } catch (error) {
    if (error instanceof service.OrgUnitError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.units);
  return { ok: true };
}

/**
 * `UC-42.1`: edit an org unit's names, parent or lead; the lead may be cleared. A loop, a
 * missing parent or a stale version comes back as a message for the modal (`COM-12`).
 */
export async function editOrgUnit(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const parsed = updateOrgUnitInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  try {
    await service.updateOrgUnit(parsed.data);
  } catch (error) {
    if (error instanceof service.OrgUnitError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.units);
  return { ok: true };
}

/** The unit's own history, read when its drawer opens. */
export async function orgUnitHistory(code: string) {
  return service.orgUnitHistory(code);
}

/** `UC-42.1-04`: remove an org unit, unless something still points at it. */
export async function removeOrgUnit(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { id, code } = orgUnitRemovalInput.parse(input);
  try {
    await service.removeOrgUnit(id, code);
  } catch (error) {
    if (error instanceof service.OrgUnitError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.units);
  return { ok: true };
}

/**
 * `UC-40.2-01`: change who someone reports to. A loop comes back as a message for the
 * drawer rather than an unhandled error (`UC-40.2-02`).
 */
export async function changeReportingLine(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { subjectNodeId, managerNodeId } = reportingLineInput.parse(input);
  try {
    await service.changeReportingLine(subjectNodeId, managerNodeId);
  } catch (error) {
    if (error instanceof service.ReportingLineError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.orgchart);
  return { ok: true };
}

/** `UC-41.1-01` and `UC-41.1-02`: invite people, reporting each address on its own. */
export async function invitePeople(
  input: unknown,
): Promise<{ ok: true; outcomes: service.InviteOutcome[] } | { ok: false; message: string; messageAr: string }> {
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) return inputRefusal(parsed.error, FIELDS);
  let outcomes: service.InviteOutcome[];
  try {
    outcomes = await service.invitePeople(parsed.data);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true, outcomes };
}

/** `UC-41.1-03`: change a person's org unit or role. */
export async function changePersonPlacement(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const values = placementInput.parse(input);
  try {
    await service.changePersonPlacement(values);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true };
}

/** D393: approve a registration; the person becomes Active and is emailed. */
export async function approveRegistration(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => approveRegistrationService(approveRegistrationInput.parse(input)));
  revalidatePath(ROUTES.people);
  revalidatePath(ROUTES.inbox);
  return outcome;
}

/** D393: decline a registration, which removes it. */
export async function declineRegistration(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => declineRegistrationService(personIdInput.parse(input).personId));
  revalidatePath(ROUTES.people);
  revalidatePath(ROUTES.inbox);
  return outcome;
}

/** `UC-41.1-04`: suspend a person, returning the work that now needs a new owner. */
export async function suspendPerson(
  input: unknown,
): Promise<{ ok: true; stranded: { key: string; title: string }[] } | { ok: false; message: string; messageAr: string }> {
  const { personId } = personIdInput.parse(input);
  let stranded: { key: string; title: string }[];
  try {
    stranded = await service.suspendPerson(personId);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true, stranded };
}

/** D381: delete an invited or suspended person whom no record still refers to. */
export async function deletePerson(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { personId } = personIdInput.parse(input);
  try {
    await service.deletePerson(personId);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true };
}

/** D387: a person's Emirates ID and whether UAE PASS has locked it, for the person dialog. */
export async function loadEmiratesId(
  input: unknown,
): Promise<{ ok: true; emiratesId: string | null; linked: boolean } | { ok: false; message: string; messageAr: string }> {
  const { personId } = personIdInput.parse(input);
  try {
    return { ok: true, ...(await service.emiratesIdOf(personId)) };
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** D387: set or clear a person's Emirates ID, which UAE PASS sign-in links them by. */
export async function savePersonEmiratesId(input: unknown): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { personId, emiratesId } = emiratesIdInput.parse(input);
  try {
    await service.setEmiratesId(personId, emiratesId);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true };
}

/** D248: email a person still invited a new link to accept. */
export async function resendInvitation(
  input: unknown,
): Promise<{ ok: true; noEmail: string | null } | { ok: false; message: string; messageAr: string }> {
  const { personId } = personIdInput.parse(input);
  try {
    const { noEmail } = await service.resendInvitation(personId);
    revalidatePath(ROUTES.people);
    return { ok: true, noEmail };
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-41.2-02`: save a role's permissions. */
export async function setRolePermissions(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const values = rolePermissionsInput.parse(input);
  try {
    await service.setRolePermissions(values);
  } catch (error) {
    if (error instanceof service.PeopleError) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
  revalidatePath(ROUTES.people);
  return { ok: true };
}

/** `UC-41.2-01`: a role's current permissions, and the one that may not be removed. */
export async function loadRolePermissionsAction(
  input: unknown,
): Promise<{ effects: Record<string, "Allow" | "Deny">; locked: string | null }> {
  const { roleCode } = roleCodeInput.parse(input);
  return service.loadRolePermissions(roleCode);
}

/** The org units a picker offers, for a modal that has to draw one before it can submit. */
export async function listOrgUnitChoices(): Promise<{ id: string; nameEn: string; nameAr: string; code: string }[]> {
  return service.orgUnitChoices();
}
