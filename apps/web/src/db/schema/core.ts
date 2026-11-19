import { sql } from "drizzle-orm";
import { integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import {
  audited,
  bilingualName,
  enumCheck,
  id,
  isActive,
  searchKey,
  trigramIndex,
  } from "./_conventions";
import { PRINCIPAL_TYPES } from "./enums";

/** The parts of the module's `core` schema the AI capabilities use: calendars, the organisation settings row, groups and external contacts. People are Hiwar's `users`. */
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

/**
 * The module's people, as a view over Hiwar's `users`: staff with a platform role are Active.
 * Read-only; the view is created in the migration that adds the AI schemas.
 */
export const person = core
  .view("person", {
    id: uuid("id").notNull(),
    email: text("email").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    status: text("status").notNull(),
    preferredLanguage: text("preferred_language").notNull(),
  })
  .existing();
