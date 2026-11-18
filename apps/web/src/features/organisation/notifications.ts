/**
 * `UC-04.2`: who an external notification goes to.
 *
 * A person who turned a channel off is not among the people the sender is given. It is a
 * pure function over the preferences, separate from the service, so it can be read and
 * tested on its own. The finished-request and finished-work-item emails (D240) are decided
 * in the same transaction as the finish, from the same preference row.
 *
 * The Inbox is deliberately not part of it. `UC-04.2-02` and `UC-04.2-03` say mentions and
 * approvals keep appearing there whatever the person chose: the Inbox is work waiting, not
 * a notification.
 */
export type NotificationChannel =
  | "approvals"
  | "mentions"
  | "slaWarnings"
  | "dailyDigest"
  | "requestCreatedEmail"
  | "requestUpdatedEmail"
  | "requestFinishedEmail"
  | "workItemFinishedEmail";

export type NotificationPreference = Record<NotificationChannel, boolean>;

/** What the platform does for a person who has never opened My profile → Notifications. */
export const DEFAULT_PREFERENCE: NotificationPreference = {
  approvals: true,
  mentions: true,
  slaWarnings: true,
  dailyDigest: false,
  requestCreatedEmail: true,
  requestUpdatedEmail: true,
  requestFinishedEmail: true,
  workItemFinishedEmail: true,
};

/** The ids of the people who have `channel` on; a person with no saved preference gets the defaults. */
export function chooseRecipients(
  channel: NotificationChannel,
  people: readonly { personId: string; preference: NotificationPreference | null }[],
): string[] {
  return people.filter((person) => (person.preference ?? DEFAULT_PREFERENCE)[channel]).map((person) => person.personId);
}
