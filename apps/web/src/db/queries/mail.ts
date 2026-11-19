import { inArray } from "drizzle-orm";

import { schema as s, type Database } from "@/db/client";
import { env } from "@/lib/env";
import { sendMail } from "@/server/mail";

/**
 * The AI capabilities' alert emails, sent through Hiwar's mail server (`SMTP_URL`). The module
 * queued these rows for a mail worker; Hiwar sends them straight away instead, because it has
 * one mail path for every system email.
 */

export type Notices = { mail: string[]; told: string[] };
export const NO_NOTICES: Notices = { mail: [], told: [] };

/** The SMTP settings `lib/mailer.ts` takes; Hiwar reads them from its environment. */
export type MailSettings = {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordSealed: string | null;
  fromAddress: string;
  fromName: string;
};

export type AlertKind = "Approval" | "Question" | "Mention" | "SlaWarning" | "Review" | "Update";

type Executor = Pick<Database, "select">;

/** Emails each person who gained an Inbox item. Returns no queued ids: nothing waits in a queue. */
export async function queueAlertEmails(
  db: Executor,
  input: { items: { id: string; personId: string }[]; kind: AlertKind; titleEn: string; titleAr: string; path: string; actorId: string },
): Promise<string[]> {
  if (input.items.length === 0) return [];
  const people = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(inArray(s.users.id, input.items.map((item) => item.personId)));
  const link = new URL(input.path, env().APP_URL).toString();
  await Promise.all(people.map((person) => sendMail(person.email, input.titleEn, `${input.titleEn}\n\nOpen it in the operator portal: ${link}\n`)));
  return [];
}
