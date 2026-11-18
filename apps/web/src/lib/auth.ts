import { randomBytes } from "node:crypto";
import NextAuth from "next-auth";
import { cookies, headers } from "next/headers";

import { awpAdapter } from "@/db/auth-adapter";
import { deleteSession, insertSession } from "@/db/queries/sessions";
import { env } from "./env";

/**
 * Requirement 26 and D387: server-side sessions in PostgreSQL, read through Auth.js v5. The
 * console signs people in itself, with the built-in password or UAE PASS
 * (`features/auth`), and opens the same session rows Auth.js reads; Auth.js has no provider of
 * its own. Passkeys stay a second factor registered from My profile → Security.
 */

/** Eight hours, as the sessions Auth.js opened before D387. */
const SESSION_SECONDS = 8 * 60 * 60;

/** Whether the console is served over HTTPS, which decides the cookie's `__Secure-` prefix. */
function secureCookies(): boolean {
  return new URL(process.env.AUTH_URL ?? env().APP_URL).protocol === "https:";
}

/** The session cookie: Auth.js's own name, set here explicitly so both sides agree on it. */
function sessionCookie() {
  const secure = secureCookies();
  return {
    name: `${secure ? "__Secure-" : ""}authjs.session-token`,
    options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure },
  };
}

export const { handlers, auth } = NextAuth(() => ({
  adapter: awpAdapter(),
  session: { strategy: "database", maxAge: SESSION_SECONDS },
  trustHost: true,
  secret: env().AUTH_SECRET,
  providers: [],
  useSecureCookies: secureCookies(),
  cookies: { sessionToken: sessionCookie() },
  pages: { signIn: "/sign-in", signOut: "/sign-in", error: "/sign-in" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
}));

/** How a session was opened. */
export type SignInMethod = "Password" | "UAE PASS";

/**
 * Opens a session for the person and sets its cookie. A new random token every time, so a
 * token seen before signing in is never the signed-in one. Only from a server action or a
 * route handler, where cookies can be written.
 */
export async function startSession(personId: string, method: SignInMethod): Promise<void> {
  const requestHeaders = await headers();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  await insertSession({
    sessionToken: token,
    personId,
    expires,
    signInMethod: method,
    userAgent: requestHeaders.get("user-agent")?.slice(0, 400) ?? null,
    ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  const cookie = sessionCookie();
  (await cookies()).set(cookie.name, token, { ...cookie.options, expires });
}

/** Ends the current session and clears its cookie; returns how it had been opened, or null when there was none. */
export async function endSession(): Promise<SignInMethod | null> {
  const jar = await cookies();
  const cookie = sessionCookie();
  const token = jar.get(cookie.name)?.value;
  jar.delete({ name: cookie.name, path: "/", secure: cookie.options.secure });
  if (!token) return null;
  const ended = await deleteSession(token);
  return (ended?.signInMethod as SignInMethod | null) ?? null;
}
