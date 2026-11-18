import { eq } from "drizzle-orm";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";

import { db, schema as s } from "./client";

/**
 * Auth.js reads the console's server-side sessions in PostgreSQL through this adapter
 * (requirement 26). The platform's identity table is `core.person` (data model section 3), not
 * a generic `users` table, so the adapter maps between the two here.
 *
 * D387: Auth.js signs nobody in. The password and UAE PASS sign-ins open the session rows
 * themselves (`lib/auth.ts`), so the account and user-creation methods Auth.js insists an
 * adapter has are refused: reaching one would mean a provider had been added without D387's
 * rules (invite-only, Emirates ID linking).
 *
 * Sessions are server-side rows, which is what My profile → Security lists and revokes.
 *
 * It sits under `src/db/` rather than `src/lib/` because it is nothing but Drizzle
 * statements, and only `src/db/` and a feature's `repository.ts` touch the client
 * (requirement 65).
 */

type PersonRow = typeof s.person.$inferSelect;

/** A person as Auth.js sees a user; an Active person counts as email-verified from creation. */
function toUser(person: PersonRow): AdapterUser {
  return {
    id: person.id,
    email: person.email,
    emailVerified: person.status === "Active" ? person.createdAt : null,
    name: person.nameEn,
    image: person.photoRef,
  };
}

/** What every method Auth.js would only call for a provider of its own does. */
function noProvider(): never {
  throw new Error("Auth.js has no sign-in provider here (D387): people sign in with a password or UAE PASS.");
}

/** The Auth.js adapter over `core.person` and `auth_session`. */
export function awpAdapter(): Adapter {
  return {
    createUser: noProvider,
    getUserByEmail: noProvider,
    getUserByAccount: noProvider,
    updateUser: noProvider,
    linkAccount: noProvider,
    createSession: noProvider,

    async getUser(id) {
      const [row] = await db().select().from(s.person).where(eq(s.person.id, id)).limit(1);
      return row ? toUser(row) : null;
    },

    /** The session and its person by token, or null. Expiry is left to Auth.js. */
    async getSessionAndUser(sessionToken) {
      const [row] = await db()
        .select({ session: s.authSession, person: s.person })
        .from(s.authSession)
        .innerJoin(s.person, eq(s.person.id, s.authSession.personId))
        .where(eq(s.authSession.sessionToken, sessionToken))
        .limit(1);
      if (!row) return null;
      const session: AdapterSession = {
        sessionToken: row.session.sessionToken,
        userId: row.session.personId,
        expires: row.session.expires,
      };
      return { session, user: toUser(row.person) };
    },

    /** Extends the expiry when given and stamps `lastSeenAt`; null when the session no longer exists. */
    async updateSession(session) {
      const [row] = await db()
        .update(s.authSession)
        .set({
          ...(session.expires ? { expires: session.expires } : {}),
          lastSeenAt: new Date(),
        })
        .where(eq(s.authSession.sessionToken, session.sessionToken))
        .returning();
      if (!row) return null;
      return { sessionToken: row.sessionToken, userId: row.personId, expires: row.expires };
    },

    async deleteSession(sessionToken) {
      await db().delete(s.authSession).where(eq(s.authSession.sessionToken, sessionToken));
    },
  };
}
