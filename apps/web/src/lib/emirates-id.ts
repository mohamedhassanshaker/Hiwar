/**
 * D387: the Emirates ID that links a UAE PASS account to a person. Fifteen digits starting
 * with 784, written `784-YYYY-NNNNNNN-C`; stored as the bare digits UAE PASS returns in `idn`.
 *
 * No check-digit test: UAE PASS's own staging sample (`784189014978983`) fails the Luhn check,
 * so refusing on it would refuse identities UAE PASS issues.
 */

const DIGITS = /^784\d{12}$/;

/** The `auth_account` provider a UAE PASS link is stored under; People reads it to lock the Emirates ID. */
export const UAE_PASS_PROVIDER = "uaepass";

/** The bare 15 digits of an Emirates ID typed with or without dashes and spaces, or null when it is not one. */
export function normaliseEmiratesId(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return DIGITS.test(digits) ? digits : null;
}

/** An Emirates ID in its printed form, `784-1990-1234567-1`. */
export function formatEmiratesId(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

/** An Emirates ID with all but its last four digits hidden, for a screen that only confirms it. */
export function maskEmiratesId(digits: string): string {
  return `784-••••-•••${digits.slice(10, 14)}-${digits.slice(14)}`;
}
