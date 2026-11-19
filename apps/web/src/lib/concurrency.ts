import { STALE_WRITE_DIGEST } from "./digests";

/**
 * Requirement 25 and `COM-10`: every mutable row carries a `version` that the
 * `awp_version_bump` trigger increases on each update. A write that names the version it
 * read is rejected when someone else has written since, with the message the console shows.
 */
export class StaleWriteError extends Error {
  readonly code = "STALE_WRITE";
  /** Survives Next.js's sanitising of server errors, so the boundary knows what this is. */
  readonly digest = STALE_WRITE_DIGEST;
  constructor(readonly objectType: string) {
    super("This record was changed by someone else.");
    this.name = "StaleWriteError";
  }
}

/** The Arabic half of the message, which the client pairs with the English one. */
export const STALE_WRITE_MESSAGE: [string, string] = [
  "This record was changed by someone else.",
  "تم تغيير هذا السجل بواسطة شخص آخر.",
];

/**
 * Turns "no rows updated" into the stale-write error. Every repository update that takes a
 * `version` runs its result through this.
 */
export function assertWritten(rows: unknown[], objectType: string): void {
  if (rows.length === 0) throw new StaleWriteError(objectType);
}

/**
 * Whether a failed write was a unique index refusing a duplicate.
 *
 * Postgres reports it as SQLSTATE 23505, and the driver wraps the original error. Matching
 * on the code rather than on a message keeps the check working whatever the driver prints.
 */
export function isUniqueViolation(problem: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = problem;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
