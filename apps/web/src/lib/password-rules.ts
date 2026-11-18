/**
 * D387: what a new built-in password must be. Apart from `lib/password.ts`, which hashes with
 * Node's crypto, so the forms can show the same rule the server applies.
 */

/** Shortest and longest password accepted: length, not character classes (NIST SP 800-63B). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * Why a new password is refused, in both languages, or null when it is accepted: 12 to 128
 * characters, and not the person's own email address.
 */
export function passwordProblem(password: string, email: string): { en: string; ar: string } | null {
  if (password.length < PASSWORD_MIN) {
    return { en: `Use at least ${PASSWORD_MIN} characters.`, ar: `استخدم ${PASSWORD_MIN} حرفاً على الأقل.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { en: `Use at most ${PASSWORD_MAX} characters.`, ar: `استخدم ${PASSWORD_MAX} حرفاً على الأكثر.` };
  }
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return { en: "Do not use your email address as the password.", ar: "لا تستخدم بريدك الإلكتروني كلمة مرور." };
  }
  return null;
}
