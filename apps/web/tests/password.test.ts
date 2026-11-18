import { describe, expect, it } from "vitest";

import { safeNext } from "@/features/auth/errors";
import { formatEmiratesId, maskEmiratesId, normaliseEmiratesId } from "@/lib/emirates-id";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/password-rules";

/** D387: the built-in password's hashing and rules, the Emirates ID's form, and where a sign-in may go next. */

describe("hashPassword / verifyPassword", () => {
  it("should_verify_the_password_a_hash_was_made_from_and_no_other", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
  });

  it("should_salt_every_hash_so_one_password_never_hashes_the_same_twice", async () => {
    expect(await hashPassword("the same password")).not.toBe(await hashPassword("the same password"));
  });

  it("should_match_nothing_against_a_stored_value_that_is_not_a_scrypt_hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$10$abc")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("should_refuse_fewer_than_12_or_more_than_128_characters_and_the_email_itself", () => {
    expect(passwordProblem("short pass1", "a@b.ae")?.en).toBe("Use at least 12 characters.");
    expect(passwordProblem("x".repeat(129), "a@b.ae")?.en).toBe("Use at most 128 characters.");
    expect(passwordProblem("Mariam@Tahseel.ae", "mariam@tahseel.ae")?.ar).toBe("لا تستخدم بريدك الإلكتروني كلمة مرور.");
  });

  it("should_accept_a_long_phrase_with_no_character_class_rules", () => {
    expect(passwordProblem("twelve chars", "a@b.ae")).toBeNull();
    expect(passwordProblem("x".repeat(128), "a@b.ae")).toBeNull();
  });
});

describe("Emirates ID", () => {
  it("should_read_15_digits_starting_with_784_with_or_without_dashes", () => {
    expect(normaliseEmiratesId("784-1890-1497898-3")).toBe("784189014978983");
    expect(normaliseEmiratesId(" 784 1990 1234567 1 ")).toBe("784199012345671");
    expect(normaliseEmiratesId("785189014978983")).toBeNull();
    expect(normaliseEmiratesId("78418901497898")).toBeNull();
    expect(normaliseEmiratesId("784-1890-149789A-3")).toBeNull();
  });

  it("should_print_and_mask_an_emirates_id", () => {
    expect(formatEmiratesId("784189014978983")).toBe("784-1890-1497898-3");
    expect(maskEmiratesId("784189014978983")).toBe("784-••••-•••7898-3");
  });
});

describe("safeNext", () => {
  it("should_keep_a_console_path_and_turn_anything_else_into_the_landing_page", () => {
    expect(safeNext("/work-items?view=mine")).toBe("/work-items?view=mine");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
