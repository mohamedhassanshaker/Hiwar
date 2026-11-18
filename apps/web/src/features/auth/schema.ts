import { z } from "zod";

import { PASSWORD_MAX } from "@/lib/password-rules";

/**
 * Requirement 32: the sign-in forms' inputs (D387). The password's length rule is checked in
 * the service, so its refusal is worded like every other sign-in refusal; here a value only has
 * to be a bounded string.
 */

const password = z.string().min(1).max(PASSWORD_MAX * 4);

export const passwordSignInInput = z.object({
  email: z.string().trim().min(1).max(320),
  password,
  next: z.string().max(2000).optional(),
});

/** D393: a registration with a password; the Arabic name is optional and the organization is chosen. */
export const registerInput = z
  .object({
    nameEn: z.string().trim().min(1).max(120),
    nameAr: z.string().trim().max(120),
    email: z.string().trim().min(1).max(320),
    orgUnitId: z.uuid(),
    password,
    confirm: password,
  })
  .refine((values) => values.password === values.confirm, { message: "The two passwords are not the same.", path: ["confirm"] });

/** D393: a UAE PASS registration; the account's name and Emirates ID come from UAE PASS. */
export const uaePassRegisterInput = z.object({ email: z.string().trim().min(1).max(320), orgUnitId: z.uuid() });

export const passwordResetRequestInput = z.object({ email: z.string().trim().min(1).max(320) });

/** A new password from a reset link or an invitation, typed twice. */
export const newPasswordInput = z
  .object({ token: z.string().min(1).max(200), password, confirm: password })
  .refine((values) => values.password === values.confirm, { message: "The two passwords are not the same.", path: ["confirm"] });
