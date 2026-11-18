import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clientKeyMatches, decrypt, encrypt, hashClientKey, newClientKey, newKek } from "@/lib/crypto";
import { resetEnvCache } from "@/lib/env";

/**
 * Specification section 9, Secrets: a secret entered in the console is stored as
 * ciphertext, is write-only in every API, and is never sent to a model, an AG-UI event, a
 * log or a trace.
 */
describe("envelope encryption", () => {
  const originalKek = process.env.APP_KEK;
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://unused/awp";
    process.env.APP_KEK = newKek();
    resetEnvCache();
  });

  afterEach(() => {
    if (originalKek === undefined) delete process.env.APP_KEK;
    else process.env.APP_KEK = originalKek;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    resetEnvCache();
  });

  it("returns the value it was given", () => {
    expect(decrypt(encrypt("sk-live-0123456789"))).toBe("sk-live-0123456789");
  });

  it("keeps Arabic and other non-ASCII values intact", () => {
    const secret = "رمز-سري-٢٠٢٦ · token";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("never writes the value into the ciphertext", () => {
    const envelope = encrypt("sk-live-0123456789");
    expect(envelope.includes(Buffer.from("sk-live-0123456789", "utf8"))).toBe(false);
  });

  it("produces a different envelope every time, so two equal secrets do not look equal", () => {
    expect(encrypt("same").equals(encrypt("same"))).toBe(false);
  });

  it("refuses a tampered envelope rather than returning the wrong value", () => {
    const envelope = encrypt("sk-live-0123456789");
    envelope[envelope.length - 1] ^= 0xff;
    expect(() => decrypt(envelope)).toThrow();
  });

  it("refuses an envelope wrapped with another key", () => {
    const envelope = encrypt("sk-live-0123456789");
    process.env.APP_KEK = newKek();
    resetEnvCache();
    expect(() => decrypt(envelope)).toThrow();
  });

  it("refuses a buffer that is not an envelope", () => {
    expect(() => decrypt(Buffer.from("plain text secret", "utf8"))).toThrow();
  });

  it("fails loudly when no key is configured, rather than storing plain text", () => {
    delete process.env.APP_KEK;
    resetEnvCache();
    expect(() => encrypt("sk-live-0123456789")).toThrow(/APP_KEK is not set/);
  });
});

/** S-77: the client secret is shown once; afterwards only the prefix is available. */
describe("integration client keys", () => {
  it("shows the secret once and keeps only a prefix and a hash", () => {
    const { secret, visiblePrefix, hash } = newClientKey();
    expect(secret.startsWith(visiblePrefix)).toBe(true);
    expect(hash.equals(hashClientKey(secret))).toBe(true);
    expect(hash.includes(Buffer.from(secret, "utf8"))).toBe(false);
  });

  it("recognises the key it issued and refuses any other", () => {
    const issued = newClientKey();
    expect(clientKeyMatches(issued.secret, issued.hash)).toBe(true);
    expect(clientKeyMatches(`${issued.secret}x`, issued.hash)).toBe(false);
    expect(clientKeyMatches(newClientKey().secret, issued.hash)).toBe(false);
  });

  it("issues a different secret every time", () => {
    expect(newClientKey().secret).not.toBe(newClientKey().secret);
  });
});
