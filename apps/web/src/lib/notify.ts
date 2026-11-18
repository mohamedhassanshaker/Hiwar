import type { Notices } from "@/db/queries/mail";
import { notifyInbox } from "@/lib/live";
import { enqueueMailJobs } from "@/lib/valkey";

/**
 * D394: after the transaction that wrote some notices has committed, sends their emails and tells
 * each person's open screen that their Inbox gained an item.
 */
export async function announce(notices: Notices): Promise<void> {
  await enqueueMailJobs(notices.mail);
  await Promise.all([...new Set(notices.told)].map((personId) => notifyInbox(personId, "update")));
}
