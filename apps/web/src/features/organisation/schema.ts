import { z } from "zod";

import { PHOTO_DATA_URL } from "@/lib/photo";

/** Requirement 32: every action input is validated here before it reaches the service. */

export const notificationPreferenceInput = z.object({
  approvals: z.boolean(),
  mentions: z.boolean(),
  slaWarnings: z.boolean(),
  dailyDigest: z.boolean(),
  requestCreatedEmail: z.boolean(),
  requestUpdatedEmail: z.boolean(),
  requestFinishedEmail: z.boolean(),
  workItemFinishedEmail: z.boolean(),
});

/**
 * `UC-04.1-04` and `COM-12`: a mobile number is optional, but when it is given it has to
 * be one — a leading `+`, then seven to fifteen digits, with spaces, dashes and brackets
 * allowed between them. `isMobile` is exported so the screen can refuse the same input on
 * the field before Save is ever pressed.
 */
export const MOBILE_PATTERN = /^\+?[0-9][0-9 ()-]{6,24}$/;

/** Whether a value is empty or a mobile number: `MOBILE_PATTERN`, and 7 to 15 digits in all. */
export function isMobile(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const digits = trimmed.replace(/\D/g, "");
  return MOBILE_PATTERN.test(trimmed) && digits.length >= 7 && digits.length <= 15;
}

/** `UC-04.1-01`: the longest English or Arabic name a person may have, once trimmed. */
export const PERSON_NAME_MAX = 120;

/** `COM-12`: whether a profile name is accepted, so the screen refuses it on the field as the server does. */
export function isPersonName(value: string): boolean {
  const length = value.trim().length;
  return length > 0 && length <= PERSON_NAME_MAX;
}

export const profileInput = z.object({
  nameEn: z.string().trim().min(1).max(PERSON_NAME_MAX),
  nameAr: z.string().trim().min(1).max(PERSON_NAME_MAX),
  mobile: z.string().trim().max(32).refine(isMobile, "That is not a mobile number.").optional(),
  preferredLanguage: z.enum(["en", "ar"]),
  version: z.number().int().positive(),
});

export const sessionTokenInput = z.object({ token: z.string().min(1) });

export const passkeyLabelInput = z.object({ label: z.string().trim().min(1).max(60) });

/**
 * `UC-04.1-03` and `UC-04.1-05`: a profile photo arrives as a `data:` URL, because the
 * column that holds it is `core.person.photo_ref` until plan item 8 puts the image in
 * object storage. PNG, JPEG and WebP only, and at most 256 KB of image once decoded.
 */
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 256 * 1024;

export const profilePhotoInput = z.object({
  photo: z
    .string()
    .regex(PHOTO_DATA_URL, "PNG, JPEG or WebP only.")
    .refine((value) => {
      const encoded = value.slice(value.indexOf(",") + 1);
      return Math.ceil((encoded.length * 3) / 4) <= PHOTO_MAX_BYTES;
    }, "The photo is larger than 256 KB."),
  version: z.number().int().positive(),
});

/** The response of a SimpleWebAuthn attestation ceremony, verified on the server. */
export const passkeyRegistrationInput = z.object({
  label: z.string().trim().min(1).max(60),
  response: z.record(z.string(), z.unknown()),
});

export const passkeyIdInput = z.object({ id: z.string().min(1) });

export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInput>;
export type ProfileInput = z.infer<typeof profileInput>;
export type ProfilePhotoInput = z.infer<typeof profilePhotoInput>;
export type PasskeyRegistrationInput = z.infer<typeof passkeyRegistrationInput>;

/** `UC-42.1-02`: the New org unit modal. The code is suggested from the name (`COM-13`). */
export const orgUnitInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, "A code is required.")
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, digits, hyphen or underscore."),
  nameEn: z.string().trim().min(1, "An English name is required.").max(120),
  nameAr: z.string().trim().min(1, "An Arabic name is required.").max(120),
  parentOrgUnitId: z.uuid().nullable().default(null),
  leadPersonId: z.uuid().nullable().default(null),
});

/**
 * `UC-42.1`: one org unit as a patch — the one write path for a unit.
 *
 * Name the fields to change and nothing else: an omitted field is left alone, and an
 * explicit null detaches the unit from its parent or clears its lead. The code is the
 * unit's identity, as a project's key is, and is not editable here. `expectedVersion` is
 * the version last read and goes in the SQL `WHERE`.
 */
export const updateOrgUnitInput = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    nameAr: z.string().trim().min(1).max(120).optional(),
    /** Sensitive: everything under the unit moves with it. Null puts it at the top. */
    parentOrgUnitId: z.uuid().nullable().optional(),
    leadPersonId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (patch) => ["nameEn", "nameAr", "parentOrgUnitId", "leadPersonId"].some((field) => field in patch),
    { message: "An edit has to change something: name one field." },
  );

export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitInput>;

/** The unit a delete names, and the code the audit entry records. */
export const orgUnitRemovalInput = z.object({ id: z.uuid(), code: z.string().min(1) });

/**
 * `UC-40.2-01`: a reporting-line change.
 *
 * The ids are org chart node ids, not row ids: a person is a uuid and an agent is its code,
 * which is what the chart and every link already use. `null` puts the subject at the top.
 */
export const reportingLineInput = z.object({
  subjectNodeId: z.string().trim().min(1),
  managerNodeId: z.string().trim().min(1).nullable().default(null),
});

/**
 * `UC-41.1-01`: an invitation batch. The addresses are validated one at a time in the
 * service, not here, because `UC-41.1-02` requires the good ones to be invited even when
 * one is wrong — a schema that rejected the batch would make that impossible.
 */
export const inviteInput = z.object({
  emails: z.array(z.string()).min(1).max(200),
  roleCode: z.string().trim().min(1),
  orgUnitId: z.uuid().nullable().default(null),
  /** D387: the invited person's Emirates ID, only when one address is invited; checked in the service. */
  emiratesId: z.string().max(40).optional(),
});

/** `UC-41.1-03`: a person's org unit and role. */
export const placementInput = z.object({
  personId: z.uuid(),
  roleCode: z.string().trim().min(1),
  orgUnitId: z.uuid().nullable().default(null),
  scopeType: z.enum(["Organisation", "OrgUnit", "Project"]).default("Organisation"),
  scopeId: z.uuid().nullable().default(null),
});

/** `UC-41.1-04`: suspend a person. */
export const personIdInput = z.object({ personId: z.uuid() });

/** D393: approving a registration; the role and org unit are optional, and the role defaults to Member. */
export const approveRegistrationInput = z.object({
  personId: z.uuid(),
  roleCode: z.string().min(1).max(64).optional(),
  orgUnitId: z.uuid().nullable().optional(),
});

/** D387: a person's Emirates ID, with or without dashes; empty clears it. Checked in the service. */
export const emiratesIdInput = z.object({ personId: z.uuid(), emiratesId: z.string().max(40) });

/** `UC-41.2-02`: a role's permissions, each either allowed or denied. */
export const rolePermissionsInput = z.object({
  roleCode: z.string().trim().min(1),
  effects: z.record(z.string(), z.enum(["Allow", "Deny"])),
});

/** `UC-41.2-01`: which role to read. */
export const roleCodeInput = z.object({ roleCode: z.string().trim().min(1) });
