import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing (from AWP). Hashed with scrypt from Node's own crypto, so no package is
 * added; the parameters travel inside the stored value, so they can be raised later and
 * every existing hash still verifies.
 *
 * Stored as `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`.
 */

const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;

/** scrypt as a promise; `maxmem` is raised because N = 2^15 needs 32 MB. */
function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...cost, maxmem: 128 * cost.N * cost.r * 2 };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (problem, key) => (problem ? reject(problem) : resolve(key))),
  );
}

/** The stored form of a new password, with a fresh salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Whether `password` is the one `stored` was made from, compared in constant time. A stored
 * value that is not a scrypt hash matches nothing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash no password matches, verified when there is no account so a miss takes as long as a hit. */
let decoy: Promise<string> | null = null;

/** Spends the time of one verification without an account to verify against. */
export async function verifyNothing(password: string): Promise<void> {
  decoy ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await decoy);
}
