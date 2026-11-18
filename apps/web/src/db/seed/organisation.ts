import { eq } from "drizzle-orm";

import { PERMISSIONS, PERMISSION_CODES, SYSTEM_ROLES, type PermissionCode } from "@/authz/permissions";
import type { Database } from "../client";
import * as s from "../schema";
import { AGENTS, ORG, ORG_UNITS, PEOPLE, PEOPLE_UNITS, ROLES } from "./data/people";
import { at, shiftDay } from "./clock";
import { ids, seedId } from "./ids";

/**
 * Data model section 3: the organisation, its calendars, units, people, the permission
 * catalogue, the nine system roles and who holds them.
 */

/** The prototype's role names, mapped to the system-role codes of `src/authz/permissions.ts`. */
const ROLE_CODE: Record<string, string> = {
  "Platform Owner": "PlatformOwner",
  Administrator: "Administrator",
  "Agent Designer": "AgentDesigner",
  Publisher: "Publisher",
  "Work Lead": "WorkLead",
  Member: "Member",
  Approver: "Approver",
  Auditor: "Auditor",
  Guest: "Guest",
  "Widget visitor": "WidgetVisitor",
};

/** Which role each demo person holds, and where. The Roles tab counts these rows. */
const ASSIGNMENTS: [person: string, role: string, unit: string | null][] = [
  ["u1", "PlatformOwner", null],
  ["u2", "WorkLead", "Procurement"],
  ["u3", "Approver", "Finance"],
  ["u4", "AgentDesigner", "IT"],
  ["u5", "Member", "Finance"],
  ["u6", "Administrator", null],
  ["u7", "Auditor", null],
];

/** The unit each org unit sits under. Platform is the root; the rest hang off it. */
const UNIT_PARENT: Record<string, string | null> = {
  Platform: null,
  Finance: "Platform",
  Procurement: "Platform",
  "Customer Service": "Platform",
  IT: "Platform",
};

const isAgent = (id: string) => AGENTS.some((a) => a.id === id);

/**
 * Inserts the demo organisation: its working and holiday calendars, org units and their leads,
 * the people with their passkeys and notification preferences, the permission catalogue, the
 * system roles and their permissions, role assignments, groups, and one external contact.
 */
export async function seedOrganisation(db: Database): Promise<void> {
  await db.insert(s.calendar).values([
    {
      id: ids.workingCalendar,
      nameEn: "Tahseel working week",
      nameAr: "أسبوع عمل تحصيل",
      workingDays: [1, 2, 3, 4, 5],
      workingHoursJson: { start: "08:00", end: "17:00" },
    },
    {
      id: ids.holidayCalendar,
      nameEn: "UAE public holidays",
      nameAr: "العطل الرسمية في الإمارات",
      workingDays: [],
      workingHoursJson: {},
    },
  ]);

  await db.insert(s.calendarHoliday).values([
    { calendarId: ids.holidayCalendar, date: shiftDay("2026-12-02"), nameEn: "National Day", nameAr: "اليوم الوطني" },
    { calendarId: ids.holidayCalendar, date: shiftDay("2026-12-03"), nameEn: "National Day holiday", nameAr: "عطلة اليوم الوطني" },
  ]);

  await db.insert(s.organisation).values({
    id: ids.organisation,
    nameEn: "Tahseel",
    nameAr: "تحصيل",
    timeZone: "Asia/Dubai",
    languages: ["en", "ar"],
    workingCalendarId: ids.workingCalendar,
    holidayCalendarId: ids.holidayCalendar,
  });

  await db.insert(s.orgUnit).values(
    ORG_UNITS.map(([nameEn, nameAr]) => ({
      id: ids.orgUnit(nameEn),
      code: nameEn.toUpperCase().replace(/\s+/g, "-"),
      nameEn,
      nameAr,
      parentOrgUnitId: UNIT_PARENT[nameEn] ? ids.orgUnit(UNIT_PARENT[nameEn] as string) : null,
    })),
  );

  await db.insert(s.person).values(
    PEOPLE.map((p) => {
      const node = ORG.find((o) => o.id === p.id);
      const parent = node?.parent ?? null;
      return {
        id: ids.person(p.id),
        email: p.email,
        nameEn: p.name,
        nameAr: p.nameAr,
        initials: p.ini,
        mobile: p.id === "u1" ? "+971 50 123 4567" : null,
        preferredLanguage: "en",
        orgUnitId: ids.orgUnit(PEOPLE_UNITS[p.id]),
        jobTitleEn: p.role,
        jobTitleAr: p.roleAr,
        reportsToType: parent ? (isAgent(parent) ? "Agent" : "Person") : null,
        reportsToId: parent ? (isAgent(parent) ? ids.agent(parent) : ids.person(parent)) : null,
        signInMethod: "Password",
        status: "Active",
      };
    }),
  );

  // Every org unit in the demo organisation is led by a person.
  for (const [nameEn, , lead] of ORG_UNITS) {
    await db.update(s.orgUnit).set({ leadPersonId: ids.person(lead) }).where(eq(s.orgUnit.id, ids.orgUnit(nameEn)));
  }

  // Two passkeys for the platform owner, which My profile -> Security lists (S-04).
  await db.insert(s.passkey).values([
    {
      id: seedId("passkey", "u1:laptop"),
      personId: ids.person("u1"),
      label: "MacBook Touch ID",
      credentialId: "seed-credential-u1-laptop",
      publicKey: "seed-public-key-u1-laptop",
      counter: 7,
      transports: ["internal"],
      lastUsedAt: at(60),
    },
    {
      id: seedId("passkey", "u1:yubikey"),
      personId: ids.person("u1"),
      label: "YubiKey 5C",
      credentialId: "seed-credential-u1-yubikey",
      publicKey: "seed-public-key-u1-yubikey",
      counter: 2,
      transports: ["usb", "nfc"],
      lastUsedAt: at(60 * 24 * 9),
    },
  ]);

  await db
    .insert(s.notificationPreference)
    .values(PEOPLE.map((p) => ({ personId: ids.person(p.id), approvals: true, mentions: true, slaWarnings: true, dailyDigest: false })));

  await db.insert(s.permission).values(
    PERMISSION_CODES.map((code) => ({
      id: ids.permission(code),
      code,
      descriptionEn: PERMISSIONS[code].en,
      descriptionAr: PERMISSIONS[code].ar,
    })),
  );

  await db.insert(s.role).values(
    ROLES.map(([nameEn, nameAr]) => ({ id: ids.role(ROLE_CODE[nameEn]), code: ROLE_CODE[nameEn], nameEn, nameAr, isSystem: true })),
  );

  await db.insert(s.rolePermission).values(
    Object.keys(SYSTEM_ROLES).flatMap((roleCode) =>
      SYSTEM_ROLES[roleCode].allow.map((permission: PermissionCode) => ({
        roleId: ids.role(roleCode),
        permissionId: ids.permission(permission),
        effect: "Allow",
      })),
    ),
  );

  await db.insert(s.roleAssignment).values(
    ASSIGNMENTS.map(([personCode, roleCode, unit]) => ({
      id: ids.roleAssignment(`${personCode}:${roleCode}`),
      personId: ids.person(personCode),
      roleId: ids.role(roleCode),
      scopeType: unit ? "OrgUnit" : "Organisation",
      scopeId: unit ? ids.orgUnit(unit) : null,
    })),
  );

  await db.insert(s.group).values([
    { id: ids.group("finance-approvers"), code: "finance-approvers", nameEn: "Finance Approvers", nameAr: "معتمدو المالية" },
    { id: ids.group("work-leads"), code: "work-leads", nameEn: "Work Leads", nameAr: "قادة العمل" },
    { id: ids.group("finance-operations"), code: "finance-operations", nameEn: "Finance Operations", nameAr: "العمليات المالية" },
    { id: ids.group("platform-team"), code: "platform-team", nameEn: "Platform team", nameAr: "فريق المنصة" },
  ]);

  await db.insert(s.groupMember).values([
    { groupId: ids.group("finance-approvers"), principalType: "Person", principalId: ids.person("u3") },
    { groupId: ids.group("work-leads"), principalType: "Person", principalId: ids.person("u2") },
    { groupId: ids.group("finance-operations"), principalType: "Person", principalId: ids.person("u3") },
    { groupId: ids.group("finance-operations"), principalType: "Agent", principalId: ids.agent("exp") },
    { groupId: ids.group("platform-team"), principalType: "Person", principalId: ids.person("u1") },
  ]);

  await db.insert(s.externalContact).values([
    {
      id: ids.externalContact("a-karim"),
      displayName: "A. Karim",
      channel: "WebWidget",
      channelAddress: "visitor:9f2c41",
      verifiedLevel: "Otp",
    },
  ]);
}
