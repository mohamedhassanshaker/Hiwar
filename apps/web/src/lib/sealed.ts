import { decrypt, encrypt } from "./crypto";

/**
 * A value the browser carries for the server between two requests and can neither read nor
 * change: a sign-in's state across the UAE PASS round trip, and a UAE PASS identity waiting
 * to be linked (D387). Encrypted and authenticated under `APP_KEK`, with its purpose and an
 * expiry inside, so a value sealed for one purpose is refused for another.
 */

/** Seals `payload` for `purpose`, valid for `seconds`, as base64url text for a cookie. */
export function seal(purpose: string, payload: Record<string, unknown>, seconds: number): string {
  const body = JSON.stringify({ purpose, expires: Date.now() + seconds * 1000, payload });
  return encrypt(body).toString("base64url");
}

/** The payload sealed for `purpose`, or null when the value is missing, altered, expired or for another purpose. */
export function unseal<T extends Record<string, unknown>>(purpose: string, value: string | undefined): T | null {
  if (!value) return null;
  try {
    const opened = JSON.parse(decrypt(Buffer.from(value, "base64url"))) as { purpose: string; expires: number; payload: T };
    return opened.purpose === purpose && opened.expires > Date.now() ? opened.payload : null;
  } catch {
    // A value that does not decrypt was not sealed here, or was changed: the same as none.
    return null;
  }
}
