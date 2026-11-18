import { and, eq } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";

/**
 * The one read-or-create behind every stranger the platform deals with.
 *
 * A visitor on an embedded widget, a WhatsApp sender and someone filling in a request
 * type's intake form on another company's website are the same kind of principal: an
 * external contact, identified by the channel and the address they arrived on. Two
 * submissions from one address are one contact, so their requests hang together.
 *
 * It lives here rather than in one feature's repository because `engage` and `requests`
 * both need it, and a second copy of the query is a second place for the identity rule to
 * drift.
 */
export async function externalContactFor(channel: string, address: string, displayName: string): Promise<string> {
  const [existing] = await dbRo()
    .select({ id: s.externalContact.id })
    .from(s.externalContact)
    .where(and(eq(s.externalContact.channel, channel), eq(s.externalContact.channelAddress, address)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db()
    .insert(s.externalContact)
    .values({ channel, channelAddress: address, displayName })
    .returning({ id: s.externalContact.id });
  return created.id;
}
