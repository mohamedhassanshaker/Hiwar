import { createHash, randomBytes } from "node:crypto";

/**
 * D248: an invitation's token. 32 random bytes in the emailed link; the database keeps only
 * its SHA-256, so a read of the table cannot be turned into a way in.
 */

/** How long an invitation link works. */
export const INVITATION_DAYS = 7;

/** A new invitation token for the emailed link, with the hash the database keeps. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: invitationTokenHash(token) };
}

/** The hex SHA-256 of an invitation token, the value an invitation row is looked up by. */
export function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
