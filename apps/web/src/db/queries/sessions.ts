import { eq } from "drizzle-orm";

import { db, schema as s } from "@/db/client";

/**
 * D387: the console's own sign-ins open and close the server-side session rows Auth.js reads
 * (`db/auth-adapter.ts`), because neither the password nor UAE PASS is an Auth.js provider.
 */

/** Stores a new session for the person, with how it was opened and from where. */
export async function insertSession(values: {
  sessionToken: string;
  personId: string;
  expires: Date;
  signInMethod: string;
  userAgent: string | null;
  ipAddress: string | null;
}): Promise<void> {
  await db().insert(s.authSession).values(values);
}

/** Deletes the session with this token and returns how it was opened, or null when there was none. */
export async function deleteSession(sessionToken: string): Promise<{ signInMethod: string | null } | null> {
  const [row] = await db()
    .delete(s.authSession)
    .where(eq(s.authSession.sessionToken, sessionToken))
    .returning({ signInMethod: s.authSession.signInMethod });
  return row ?? null;
}

/** Ends every session the person holds, as a password reset does. */
export async function deletePersonSessions(personId: string): Promise<void> {
  await db().delete(s.authSession).where(eq(s.authSession.personId, personId));
}
