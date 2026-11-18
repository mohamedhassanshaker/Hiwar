import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "./env";

/**
 * Envelope encryption for the secrets a person types into the console: connector auth,
 * channel tokens, model provider keys and integration client keys.
 *
 * Specification section 9, Secrets: "Write-only in APIs; never sent to models, AG-UI
 * events, logs or traces." The ciphertext is what the `bytea` columns hold; nothing else
 * in the application can read a secret back, because nothing else imports this module's
 * `decrypt`.
 *
 * Each value gets its own random data key. The data key is wrapped with `APP_KEK` and
 * stored beside the ciphertext, so rotating the KEK rewraps the data keys without
 * re-encrypting every value (stack specification SD-6).
 *
 * Layout, one buffer:
 *   byte 0        format version (1)
 *   bytes 1..12   KEK wrap nonce
 *   bytes 13..28  KEK wrap tag
 *   bytes 29..60  wrapped data key
 *   bytes 61..72  payload nonce
 *   bytes 73..88  payload tag
 *   bytes 89..     ciphertext
 */

const FORMAT = 1;
const NONCE = 12;
const TAG = 16;
const KEY = 32;

const HEADER = 1 + NONCE + TAG + KEY + NONCE + TAG;

/** The key-encryption key from `APP_KEK`, base64-decoded. Throws when it is not set. */
function kek(): Buffer {
  const configured = env().APP_KEK;
  if (!configured) {
    throw new Error("APP_KEK is not set: the application cannot store or read a secret. See .env.example.");
  }
  return Buffer.from(configured, "base64");
}

/** Wraps a value so it can be written to a `bytea` column. */
export function encrypt(plaintext: string): Buffer {
  const dataKey = randomBytes(KEY);

  const wrapNonce = randomBytes(NONCE);
  const wrapper = createCipheriv("aes-256-gcm", kek(), wrapNonce, { authTagLength: TAG });
  const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
  const wrapTag = wrapper.getAuthTag();

  const payloadNonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", dataKey, payloadNonce, { authTagLength: TAG });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payloadTag = cipher.getAuthTag();

  dataKey.fill(0);

  return Buffer.concat([Buffer.of(FORMAT), wrapNonce, wrapTag, wrappedKey, payloadNonce, payloadTag, ciphertext]);
}

/**
 * Unwraps a value. Called only where the platform itself needs the secret — generating the
 * agentgateway configuration, calling a connector, posting to a channel — never from a screen,
 * an action result or a log line.
 */
export function decrypt(envelope: Buffer): string {
  if (envelope.length < HEADER) throw new Error("The ciphertext is too short to be a secret envelope.");
  if (envelope[0] !== FORMAT) throw new Error(`Unknown secret envelope format ${envelope[0]}.`);

  let at = 1;
  const wrapNonce = envelope.subarray(at, (at += NONCE));
  const wrapTag = envelope.subarray(at, (at += TAG));
  const wrappedKey = envelope.subarray(at, (at += KEY));
  const payloadNonce = envelope.subarray(at, (at += NONCE));
  const payloadTag = envelope.subarray(at, (at += TAG));
  const ciphertext = envelope.subarray(at);

  const unwrapper = createDecipheriv("aes-256-gcm", kek(), wrapNonce, { authTagLength: TAG });
  unwrapper.setAuthTag(wrapTag);
  const dataKey = Buffer.concat([unwrapper.update(wrappedKey), unwrapper.final()]);

  const decipher = createDecipheriv("aes-256-gcm", dataKey, payloadNonce, { authTagLength: TAG });
  decipher.setAuthTag(payloadTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  dataKey.fill(0);
  return plaintext;
}

/**
 * What the Integrations screen shows after creating a client key (S-77): the secret once,
 * and from then on only its prefix. The hash is what `gov.client_key.secret_hash` holds.
 */
export function newClientKey(prefix = "awp"): { secret: string; visiblePrefix: string; hash: Buffer } {
  const body = randomBytes(24).toString("base64url");
  const visiblePrefix = `${prefix}_${body.slice(0, 6)}`;
  const secret = `${visiblePrefix}_${body.slice(6)}`;
  return { secret, visiblePrefix, hash: hashClientKey(secret) };
}

/** The SHA-256 of a client key, as `gov.client_key.secret_hash` stores it. */
export function hashClientKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Constant-time comparison, so a presented key cannot be guessed by timing. */
export function clientKeyMatches(secret: string, stored: Buffer): boolean {
  const presented = hashClientKey(secret);
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/** Generates a KEK for `.env`. Used by `scripts/secrets-from-env.sh` and the docs. */
export function newKek(): string {
  return randomBytes(KEY).toString("base64");
}
