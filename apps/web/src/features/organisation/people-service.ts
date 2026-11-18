import { CORE_PERMISSIONS, PERMISSIONS } from "@/authz/permissions";
import { audit } from "@/lib/audit";
import { normaliseEmiratesId } from "@/lib/emirates-id";
import { enqueueMailJobs } from "@/lib/valkey";
import { Rejected } from "@/lib/rejection";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

/** Thrown by the People and Roles operations when one is refused. */
export class PeopleError extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "PeopleError";
  }
}

/** The role that must never be left without a holder (`UC-41.1-05`). */
const LAST_RESORT_ROLE = "PlatformOwner";

/** What one address did, so the caller can report per address rather than per request. */
/** One address's outcome; `noEmail` says why an invited person was not emailed their link (D248). */
export type InviteOutcome = { email: string; invited: boolean; reason?: string; noEmail?: string };

/** A plausible address. The real test is whether the identity provider knows it. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A display name and initials from the local part, until the person signs in and edits it. */
function nameFromEmail(email: string): { name: string; initials: string } {
  const local = email.split("@")[0];
  const words = local.split(/[._-]+/).filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || local;
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : local.slice(0, 2)).toUpperCase();
  return { name, initials };
}

/**
 * `UC-41.1-01`: invite people into a role. `UC-41.1-02` flags the addresses that cannot be
 * invited and still invites the rest.
 *
 * Partial success is the point: a list pasted from a spreadsheet usually holds one typo, and
 * refusing the whole batch for it would make the admin find and re-enter the good addresses.
 * Each address therefore gets its own outcome.
 *
 * D387: an Emirates ID may come with the invitation when exactly one address is invited, so UAE
 * PASS links that person on their first UAE PASS sign-in.
 *
 * @throws {PeopleError} when the role itself is unknown, or the Emirates ID is given with several
 *   addresses, is not one, or is already another person's — none of which is per address.
 */
export async function invitePeople(input: {
  emails: string[];
  roleCode: string;
  orgUnitId: string | null;
  emiratesId?: string;
}): Promise<InviteOutcome[]> {
  const session = await requirePermission("permissions:write");

  const role = await repository.roleByCode(input.roleCode);
  if (!role) throw new PeopleError("That role no longer exists.", "لم يعد هذا الدور موجوداً.");
  const emiratesId = await invitedEmiratesId(input);

  const taken = await repository.existingEmails();
  const outcomes: InviteOutcome[] = [];
  // Within the batch as well as against the platform: the same address twice is still a
  // duplicate, and the second one would fail on the unique index rather than be reported.
  const seen = new Set<string>();

  for (const raw of input.emails) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      outcomes.push({ email: raw.trim(), invited: false, reason: "That is not an email address." });
      continue;
    }
    if (taken.has(email) || seen.has(email)) {
      outcomes.push({ email, invited: false, reason: "Already on the platform." });
      continue;
    }
    seen.add(email);
    const { name, initials } = nameFromEmail(email);
    const invited = await repository.insertInvitedPerson({
      email,
      nameEn: name,
      nameAr: name,
      initials,
      orgUnitId: input.orgUnitId,
      roleId: role.id,
      invitedBy: session.personId,
      emiratesId,
    });
    if (invited.reason === null) await enqueueMailJobs([invited.noticeId]);
    outcomes.push({ email, invited: true, ...(invited.reason ? { noEmail: invited.reason } : {}) });
  }

  const invited = outcomes.filter((outcome) => outcome.invited).map((outcome) => outcome.email);
  if (invited.length) {
    await audit({
      actor: { type: "Person", id: session.personId, label: session.nameEn },
      action: "permissions:write",
      objectType: "Person",
      objectLabel: `${invited.length} invited`,
      detail: { role: input.roleCode, emails: invited, ...(emiratesId ? { emiratesId: "set" } : {}) },
    });
  }
  return outcomes;
}

/**
 * D387: the Emirates ID an invitation carries, as its 15 digits, or null when none was typed.
 *
 * @throws {PeopleError} with several addresses, for a value that is not an Emirates ID, or one
 *   another person already holds.
 */
async function invitedEmiratesId(input: { emails: string[]; emiratesId?: string }): Promise<string | null> {
  const typed = input.emiratesId?.trim() ?? "";
  if (typed === "") return null;
  if (input.emails.filter((email) => email.trim() !== "").length !== 1) {
    throw new PeopleError("An Emirates ID can be given only when inviting one person.", "لا يُدخل رقم الهوية الإماراتية إلا عند دعوة شخص واحد.");
  }
  const emiratesId = normaliseEmiratesId(typed);
  if (!emiratesId) {
    throw new PeopleError("An Emirates ID is 15 digits starting with 784, like 784-1990-1234567-1.", "رقم الهوية الإماراتية 15 رقماً يبدأ بـ 784، مثل 784-1990-1234567-1.");
  }
  if (await repository.emiratesIdTaken(emiratesId)) {
    throw new PeopleError("Another person already has this Emirates ID.", "رقم الهوية الإماراتية هذا مسجّل لشخص آخر.");
  }
  return emiratesId;
}

/**
 * D248: a new invitation link for somebody still invited, emailed to them; the earlier links
 * stop working. Says why when no email will go.
 */
export async function resendInvitation(personId: string): Promise<{ noEmail: string | null }> {
  const session = await requirePermission("permissions:write");
  const invited = await repository.reinvitePerson(personId, session.personId);
  if (!invited) throw new PeopleError("Only somebody still invited can be invited again.", "لا تُعاد الدعوة إلا لمن لا يزال مدعوّاً.");
  if (invited.reason === null) await enqueueMailJobs([invited.noticeId]);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Person",
    objectId: personId,
    objectLabel: invited.email,
    detail: { invitation: "resent", emailed: invited.reason === null },
  });
  return { noEmail: invited.reason };
}

/**
 * D248: what the invitation page shows. Public: the token in the link is the only credential,
 * and it says nothing beyond the invited person's own name and address.
 */
export async function invitationForToken(token: string) {
  return repository.invitationByToken(token);
}

/**
 * `UC-41.1-03`: move a person into another org unit, another role, or both.
 *
 * The change takes effect on their next request because authorisation is evaluated from the
 * stored grants on each one, not cached into the session.
 *
 * `UC-41.2-03`: the role may be granted across the organisation, or only within one org unit
 * or project, which is the scope `evaluate` then measures every decision against.
 *
 * @throws {PeopleError} when the role is unknown, or this would leave nobody in the role
 *   that `UC-41.1-05` protects.
 */
export async function changePersonPlacement(input: {
  personId: string;
  roleCode: string;
  orgUnitId: string | null;
  scopeType: "Organisation" | "OrgUnit" | "Project";
  scopeId: string | null;
}): Promise<void> {
  const session = await requirePermission("permissions:write");

  const role = await repository.roleByCode(input.roleCode);
  if (!role) throw new PeopleError("That role no longer exists.", "لم يعد هذا الدور موجوداً.");

  // Moving the last Platform Owner out of the role empties it just as suspending them does.
  if (input.roleCode !== LAST_RESORT_ROLE && (await wouldEmptyTheOwnerRole(input.personId))) {
    throw new PeopleError("This is the last Platform Owner: give someone else the role first.", "هذا آخر مالك للمنصة: امنح الدور لشخص آخر أولاً.");
  }

  await repository.updatePersonPlacement({
    personId: input.personId,
    orgUnitId: input.orgUnitId,
    roleId: role.id,
    scopeType: input.scopeType,
    scopeId: input.scopeType === "Organisation" ? null : input.scopeId,
    changedBy: session.personId,
  });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Person",
    objectId: input.personId,
    objectLabel: input.personId,
    detail: { role: input.roleCode, orgUnitId: input.orgUnitId, scope: input.scopeType },
  });
}

/** Whether this person is the only active holder of the role nobody may empty. */
async function wouldEmptyTheOwnerRole(personId: string): Promise<boolean> {
  if (!(await repository.personHoldsRole(personId, LAST_RESORT_ROLE))) return false;
  return (await repository.roleHolderCount(LAST_RESORT_ROLE)) <= 1;
}

/**
 * `UC-41.1-04`: suspend a person, ending every session they hold.
 *
 * `UC-41.1-05` refuses the last Platform Owner: a platform with nobody able to grant
 * permissions cannot be recovered from inside itself.
 *
 * Their open work stays assigned to them, as `UC-21.3-05` requires, and is returned here so
 * the admin sees what now needs a new owner.
 *
 * @throws {PeopleError} when this is the last Platform Owner.
 */
export async function suspendPerson(personId: string): Promise<{ key: string; title: string }[]> {
  const session = await requirePermission("permissions:write");

  if (await wouldEmptyTheOwnerRole(personId)) {
    throw new PeopleError("This is the last Platform Owner, so they cannot be suspended.", "هذا آخر مالك للمنصة، فلا يمكن تعليق حسابه.");
  }

  const stranded = await repository.openAssignedWork(personId);
  await repository.suspendPersonAndEndSessions(personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Person",
    objectId: personId,
    objectLabel: personId,
    detail: { suspended: true, openWork: stranded.map((item) => item.key) },
  });
  return stranded;
}

/**
 * D381: delete a person who is Invited or Suspended and whom no record still refers to.
 *
 * An Active person is refused: suspending first ends their sessions and lists their open work,
 * which is the step that decides what happens to it. A person a record still names (a work
 * item they wrote, a decision, a project they own) is refused with that record's table, and
 * can stay suspended. The audit keeps who they were by id.
 *
 * @throws {PeopleError} when the person is Active, unknown, or still referred to.
 */
export async function deletePerson(personId: string): Promise<void> {
  const session = await requirePermission("permissions:write");
  const status = await repository.personStatus(personId);
  if (status === null) throw new PeopleError("There is no such person.", "لا يوجد شخص بهذا المعرّف.");
  if (status === "Active") {
    throw new PeopleError(
      "Only an invited or suspended person can be deleted. Suspend them first.",
      "لا يُحذف إلا شخص مدعو أو معلّق. علّق حسابه أولًا.",
    );
  }
  const { deleted, heldBy } = await repository.deletePersonIfUnused(personId);
  if (heldBy) {
    throw new PeopleError(
      `They cannot be deleted: ${heldBy} still refers to them. Keep them suspended instead.`,
      `لا يمكن حذفهم: ما زال ${heldBy} يشير إليهم. أبقِ حسابهم معلّقًا بدلًا من ذلك.`,
    );
  }
  if (!deleted) throw new PeopleError("They changed while you were deleting them; try again.", "تغيّر حسابهم أثناء الحذف، حاول مجددًا.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Person",
    objectId: personId,
    objectLabel: personId,
    detail: { deleted: true, status },
  });
}

/**
 * D387: a person's Emirates ID for the person dialog, and whether UAE PASS has locked it. Only
 * for whoever may change it, since it is a national ID.
 *
 * @throws {PeopleError} when there is no such person.
 */
export async function emiratesIdOf(personId: string): Promise<{ emiratesId: string | null; linked: boolean }> {
  await requirePermission("permissions:write");
  const found = await repository.personEmiratesId(personId);
  if (!found) throw new PeopleError("There is no such person.", "لا يوجد شخص بهذا المعرّف.");
  return found;
}

/**
 * D387: sets or clears the Emirates ID UAE PASS sign-in links a person by. Once UAE PASS has
 * linked the account the ID is the one UAE PASS returned, and its guidelines forbid editing it.
 * The audit records that it changed, never the number.
 *
 * @throws {PeopleError} when the value is not an Emirates ID, UAE PASS has locked it, or another
 *   person holds it.
 */
export async function setEmiratesId(personId: string, value: string): Promise<void> {
  const session = await requirePermission("permissions:write");
  const emiratesId = value.trim() === "" ? null : normaliseEmiratesId(value);
  if (value.trim() !== "" && !emiratesId) {
    throw new PeopleError("An Emirates ID is 15 digits starting with 784, like 784-1990-1234567-1.", "رقم الهوية الإماراتية 15 رقماً يبدأ بـ 784، مثل 784-1990-1234567-1.");
  }
  const current = await repository.personEmiratesId(personId);
  if (!current) throw new PeopleError("There is no such person.", "لا يوجد شخص بهذا المعرّف.");
  if (current.linked && current.emiratesId !== emiratesId) {
    throw new PeopleError("UAE PASS is linked to this person, so their Emirates ID cannot be changed.", "الهوية الرقمية مرتبطة بهذا الشخص، فلا يمكن تغيير رقم هويته الإماراتية.");
  }
  if ((await repository.saveEmiratesId(personId, emiratesId, session.personId)) === "taken") {
    throw new PeopleError("Another person already has this Emirates ID.", "رقم الهوية الإماراتية هذا مسجّل لشخص آخر.");
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Person",
    objectId: personId,
    objectLabel: personId,
    detail: { emiratesId: emiratesId ? "set" : "cleared" },
  });
}

/** `UC-41.2-01`: a role's permissions, and which of them may not be removed. */
export async function loadRolePermissions(roleCode: string): Promise<{
  effects: Record<string, "Allow" | "Deny">;
  locked: string | null;
}> {
  await requirePermission("organisation:read");
  const [effects, isSystem] = await Promise.all([
    repository.rolePermissions(roleCode),
    repository.isSystemRole(roleCode),
  ]);
  return { effects, locked: isSystem ? (CORE_PERMISSIONS[roleCode] ?? null) : null };
}

/**
 * `UC-41.2-02`: set what a role allows and denies. The change applies to every member,
 * because a grant is read from the role on each request rather than copied onto the person.
 *
 * An explicit `Deny` is kept as a row rather than dropped: `evaluate` lets a deny beat an
 * allow at any scope, which is the only way to carve an exception out of a wider grant.
 *
 * `UC-41.2-05`: a system role keeps the permission it exists for, whatever the form sends.
 *
 * @throws {PeopleError} when the role is unknown, or the edit drops a locked permission.
 */
export async function setRolePermissions(input: {
  roleCode: string;
  effects: Record<string, "Allow" | "Deny">;
}): Promise<void> {
  const session = await requirePermission("permissions:write");

  if (!(await repository.roleByCode(input.roleCode))) {
    throw new PeopleError("That role no longer exists.", "لم يعد هذا الدور موجوداً.");
  }

  if (await repository.isSystemRole(input.roleCode)) {
    const core = CORE_PERMISSIONS[input.roleCode];
    if (core && input.effects[core] !== "Allow") {
      throw new PeopleError(
        `"${PERMISSIONS[core].en}" is what this role is, so it cannot be removed or denied.`,
        `"${PERMISSIONS[core].ar}" هي جوهر هذا الدور، فلا يمكن إزالتها أو منعها.`,
      );
    }
  }

  await repository.replaceRolePermissions(input.roleCode, input.effects, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "permissions:write",
    objectType: "Role",
    objectLabel: input.roleCode,
    detail: {
      allowed: Object.keys(input.effects).filter((code) => input.effects[code] === "Allow").length,
      denied: Object.keys(input.effects).filter((code) => input.effects[code] === "Deny").length,
    },
  });
}
