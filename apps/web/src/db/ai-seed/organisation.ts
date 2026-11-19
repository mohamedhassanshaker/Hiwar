import type { Database } from "../client";
import * as s from "../schema";
import { shiftDay } from "./clock";
import { ids } from "./ids";

/**
 * The module's organisation settings for Hiwar: the platform's working week and UAE holidays,
 * and the one organisation row. People are Hiwar staff accounts (`users` with a platform role),
 * so no people, roles or org units are seeded here.
 */
export async function seedOrganisation(db: Database): Promise<void> {
  await db.insert(s.calendar).values([
    { id: ids.workingCalendar, nameEn: "Hiwar working week", nameAr: "أسبوع عمل حوار", workingDays: [1, 2, 3, 4, 5], workingHoursJson: { start: "08:00", end: "17:00" } },
    { id: ids.holidayCalendar, nameEn: "UAE public holidays", nameAr: "العطل الرسمية في الإمارات", workingDays: [], workingHoursJson: {} },
  ]);
  await db.insert(s.calendarHoliday).values([
    { calendarId: ids.holidayCalendar, date: shiftDay("2026-12-02"), nameEn: "National Day", nameAr: "اليوم الوطني" },
    { calendarId: ids.holidayCalendar, date: shiftDay("2026-12-03"), nameEn: "National Day holiday", nameAr: "عطلة اليوم الوطني" },
  ]);
  await db.insert(s.organisation).values({
    id: ids.organisation,
    nameEn: "Hiwar",
    nameAr: "حوار",
    timeZone: "Asia/Dubai",
    languages: ["en", "ar"],
    workingCalendarId: ids.workingCalendar,
    holidayCalendarId: ids.holidayCalendar,
  });
  await db.insert(s.group).values([{ id: ids.group("platform-team"), code: "platform-team", nameEn: "Platform team", nameAr: "فريق المنصة" }]);
}
