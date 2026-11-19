/**
 * The working calendar inbound channels check business hours against. Hiwar has no calendar
 * screen yet, so it is the UAE working week, Monday to Friday (1 to 5; Monday is 1 and Sunday 7), with no holidays.
 */
export async function workingCalendarFor(_day: string): Promise<{ workingDays: number[]; isHoliday: boolean }> {
  return { workingDays: [1, 2, 3, 4, 5], isHoliday: false };
}
