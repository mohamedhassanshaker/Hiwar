/** Scheduled work items (S-31). */

export type Schedule = {
  id: string;
  /** `COM-10`: what a pause or resume is written against, so a stale one is refused. */
  version: number;
  n: string;
  nAr: string;
  /** The person or agent the created work item is assigned to; empty for a group. */
  a: string;
  isAgent: boolean;
  /** Agent, Person or Group. */
  audienceType: string;
  /** The group's names when the audience is a group, otherwise null. */
  groupNameEn: string | null;
  groupNameAr: string | null;
  p: string;
  repeats: string;
  eventName: string | null;
  timeOfDay: string | null;
  skipHolidaysAndWeekends: boolean;
  nextRunAt: string | null;
  on: boolean;
  /** The outcome of the last run: Created, Failed or Skipped. */
  last: string | null;
};
