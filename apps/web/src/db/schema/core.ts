import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  audited,
  bilingualName,
  enumCheck,
  id,
  isActive,
  principalTypeCheck,
  rowCheck,
  searchKey,
  trigramIndex,
  ts,
} from "./_conventions";
import { PERMISSION_EFFECTS, PERSON_STATUSES, PREFERRED_LANGUAGES, PRINCIPAL_TYPES, ROLE_SCOPE_TYPES } from "./enums";

/** Data model section 3 — organisation and identity. */
export const core = pgSchema("core");

export const calendar = core.table("calendar", {
  id: id(),
  ...bilingualName,
  workingDays: integer("working_days").array().notNull(),
  workingHoursJson: jsonb("working_hours_json").$type<Record<string, unknown>>(),
  isActive: isActive(),
  ...audited,
});

export const calendarHoliday = core.table(
  "calendar_holiday",
  {
    id: id(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendar.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    ...bilingualName,
    ...audited,
  },
  (t) => [uniqueIndex("calendar_holiday_key").on(t.calendarId, t.date)],
);

export const organisation = core.table(
  "organisation",
  {
    id: id(),
    ...bilingualName,
    timeZone: text("time_zone").notNull().default("Asia/Dubai"),
    languages: text("languages").array().notNull().default(sql`'{en,ar}'::text[]`),
    workingCalendarId: uuid("working_calendar_id").references(() => calendar.id),
    holidayCalendarId: uuid("holiday_calendar_id").references(() => calendar.id),
    ...audited,
  },
  // Section 3: "Exactly one row."
  () => [uniqueIndex("organisation_singleton").on(sql`(true)`)],
);

export const orgUnit = core.table(
  "org_unit",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    parentOrgUnitId: uuid("parent_org_unit_id"),
    leadPersonId: uuid("lead_person_id"),
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [
    uniqueIndex("org_unit_code_key").on(t.code),
    index("org_unit_parent_idx").on(t.parentOrgUnitId),
    trigramIndex("org_unit_search_idx", t.searchKey),
    foreignKey({ columns: [t.parentOrgUnitId], foreignColumns: [t.id], name: "org_unit_parent_fk" }),
  ],
);

export const person = core.table(
  "person",
  {
    id: id(),
    email: text("email").notNull(),
    ...bilingualName,
    initials: text("initials").notNull(),
    mobile: text("mobile"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    photoRef: text("photo_ref"),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id),
    jobTitleEn: text("job_title_en"),
    jobTitleAr: text("job_title_ar"),
    reportsToType: text("reports_to_type"),
    reportsToId: uuid("reports_to_id"),
    /** How the person last signed in: `Password` or `UAE PASS` (D387); `SSO` before D387. */
    signInMethod: text("sign_in_method").notNull().default("Password"),
    /** D387: the 15-digit Emirates ID UAE PASS sign-in is linked by; a national ID, never logged. */
    emiratesId: text("emirates_id"),
    status: text("status").notNull().default("Invited"),
    searchKey: searchKey("search_key", "name_en", "name_ar", "email"),
    ...audited,
  },
  (t) => [
    uniqueIndex("person_email_key").on(t.email),
    uniqueIndex("person_emirates_id_key").on(t.emiratesId),
    rowCheck("person_emirates_id_check", "emirates_id is null or emirates_id ~ '^784[0-9]{12}$'"),
    index("person_org_unit_idx").on(t.orgUnitId),
    trigramIndex("person_search_idx", t.searchKey),
    enumCheck("person_status_check", t.status, PERSON_STATUSES),
    enumCheck("person_language_check", t.preferredLanguage, PREFERRED_LANGUAGES),
    principalTypeCheck("person_reports_to_type_check", t.reportsToType),
  ],
);

export const passkey = core.table(
  "passkey",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports").array(),
    lastUsedAt: ts("last_used_at"),
    ...audited,
  },
  (t) => [uniqueIndex("passkey_credential_key").on(t.credentialId), index("passkey_person_idx").on(t.personId)],
);

export const notificationPreference = core.table("notification_preference", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => person.id, { onDelete: "cascade" }),
  approvals: boolean("approvals").notNull().default(true),
  mentions: boolean("mentions").notNull().default(true),
  slaWarnings: boolean("sla_warnings").notNull().default(true),
  dailyDigest: boolean("daily_digest").notNull().default(false),
  /** D240: an email when a request of theirs, or a work item they are on, finishes. */
  requestFinishedEmail: boolean("request_finished_email").notNull().default(true),
  workItemFinishedEmail: boolean("work_item_finished_email").notNull().default(true),
  /** D247: an email when a request of theirs is created, and when it moves on. */
  requestCreatedEmail: boolean("request_created_email").notNull().default(true),
  requestUpdatedEmail: boolean("request_updated_email").notNull().default(true),
  ...audited,
});

/**
 * D248: an invitation to the platform. Only the token's hash identifies it; the token itself is
 * kept under `APP_KEK` until the invitation email is sent, then cleared.
 */
export const personInvitation = core.table(
  "person_invitation",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenCipher: text("token_cipher"),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    ...audited,
  },
  (t) => [uniqueIndex("person_invitation_token").on(t.tokenHash), index("person_invitation_person").on(t.personId)],
);

/**
 * D387: a person's built-in password, as a scrypt hash. Its own table so that no read of
 * `person` can carry it to a screen; the reporting role cannot read it (`06-roles.sql`).
 */
export const personCredential = core.table("person_credential", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => person.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  changedAt: ts("changed_at").notNull().defaultNow(),
});

/**
 * D387: a Forgot password link. Only the token's hash is stored; a link works once, until it
 * expires, and a newer link for the same person replaces it.
 */
export const passwordReset = core.table(
  "password_reset",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("password_reset_token").on(t.tokenHash), index("password_reset_person").on(t.personId)],
);

export const role = core.table(
  "role",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    isSystem: boolean("is_system").notNull().default(false),
    ...audited,
  },
  (t) => [uniqueIndex("role_code_key").on(t.code)],
);

export const permission = core.table(
  "permission",
  {
    id: id(),
    code: text("code").notNull(),
    descriptionEn: text("description_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    ...audited,
  },
  (t) => [uniqueIndex("permission_code_key").on(t.code)],
);

export const rolePermission = core.table(
  "role_permission",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
    // Section 3: an explicit Deny beats any Allow.
    effect: text("effect").notNull().default("Allow"),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId], name: "role_permission_pk" }),
    enumCheck("role_permission_effect_check", t.effect, PERMISSION_EFFECTS),
  ],
);

export const roleAssignment = core.table(
  "role_assignment",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    ...audited,
  },
  (t) => [
    uniqueIndex("role_assignment_key").on(
      t.personId,
      t.roleId,
      t.scopeType,
      sql`coalesce(${t.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("role_assignment_person_idx").on(t.personId),
    enumCheck("role_assignment_scope_check", t.scopeType, ROLE_SCOPE_TYPES),
    // An organisation-wide assignment has no scope id; a unit or project assignment must have one.
    rowCheck(
      "role_assignment_scope_id_check",
      `("scope_type" = 'Organisation' and "scope_id" is null) or ("scope_type" <> 'Organisation' and "scope_id" is not null)`,
    ),
  ],
);

export const group = core.table(
  "group",
  {
    id: id(),
    code: text("code").notNull(),
    ...bilingualName,
    searchKey: searchKey("search_key", "name_en", "name_ar", "code"),
    ...audited,
  },
  (t) => [uniqueIndex("group_code_key").on(t.code), trigramIndex("group_search_idx", t.searchKey)],
);

export const groupMember = core.table(
  "group_member",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: uuid("principal_id").notNull(),
    ...audited,
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.principalType, t.principalId], name: "group_member_pk" }),
    enumCheck("group_member_principal_check", t.principalType, PRINCIPAL_TYPES),
  ],
);

export const externalContact = core.table(
  "external_contact",
  {
    id: id(),
    displayName: text("display_name").notNull(),
    channel: text("channel").notNull(),
    channelAddress: text("channel_address").notNull(),
    verifiedLevel: text("verified_level").notNull().default("None"),
    searchKey: searchKey("search_key", "display_name", "channel_address"),
    ...audited,
  },
  (t) => [
    uniqueIndex("external_contact_address_key").on(t.channel, t.channelAddress),
    trigramIndex("external_contact_search_idx", t.searchKey),
  ],
);

/**
 * Auth.js v5 keeps sessions server-side in PostgreSQL. `auth_session` carries the user
 * agent and address as well, because My profile → Security lists the active sessions and
 * can revoke one (S-04).
 */
export const authAccount = core.table(
  "auth_account",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId], name: "auth_account_pk" })],
);

export const authSession = core.table(
  "auth_session",
  {
    sessionToken: text("session_token").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    expires: ts("expires").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    /** D387: `Password` or `UAE PASS`; a UAE PASS session is also ended at UAE PASS on Log out. */
    signInMethod: text("sign_in_method"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("auth_session_person_idx").on(t.personId)],
);

export const authVerificationToken = core.table(
  "auth_verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token], name: "auth_verification_token_pk" })],
);
