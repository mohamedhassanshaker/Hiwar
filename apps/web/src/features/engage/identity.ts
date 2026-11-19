import { createHmac, timingSafeEqual } from "node:crypto";

/** Who a visitor is, when the host site says so (S-63, S-65). */
/**
 * Verifies a visitor token the host site signed (`UC-63.1-06`).
 *
 * HS256 with the shared secret the deployment holds, checked whole: the signature, the
 * expiry and the subject. Anything else is treated as no token at all, so a host site
 * cannot get a visitor identified by sending something that merely looks like one.
 */
export function verifyVisitorToken(token: string, secret: string, now = Date.now()): { subject: string; name: string | null } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (expected.length !== parts[2].length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;

  let claims: { sub?: string; name?: string; exp?: number; alg?: string };
  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string };
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as typeof claims;
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  if (!claims.sub) return null;
  if (claims.exp !== undefined && claims.exp * 1000 <= now) return null;
  return { subject: claims.sub, name: claims.name ?? null };
}
