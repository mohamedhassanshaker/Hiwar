import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "./env";

/** A development key, used only when SECRET_KEY is unset outside production. */
const DEV_KEY = createHash("sha256").update("hiwar-development-only").digest();

function key(): Buffer {
  const value = env().SECRET_KEY;
  if (value) return Buffer.from(value, "base64");
  if (env().NODE_ENV === "production") throw new Error("SECRET_KEY is required in production");
  return DEV_KEY;
}

/** AES-256-GCM, stored as base64url of iv + tag + ciphertext. */
export function sealText(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openText(sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** A random token for a link or cookie, and the hash that is stored for it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
