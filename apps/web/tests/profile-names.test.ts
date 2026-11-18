import { describe, expect, it } from "vitest";

import { isPersonName, PERSON_NAME_MAX, profileInput } from "@/features/organisation/schema";

/**
 * `UC-04.1-01` and `COM-12`: a profile name is required and at most 120 characters once trimmed. The screen refuses
 * the same names on the field as the server does, so an invalid name never reaches Save (TC-SHL-076, TC-SHL-084).
 */
describe("isPersonName", () => {
  it("should_accept_a_name_of_exactly_the_maximum_length", () => {
    expect(isPersonName("N".repeat(PERSON_NAME_MAX))).toBe(true);
  });

  it("should_reject_a_name_one_character_too_long", () => {
    expect(isPersonName("N".repeat(PERSON_NAME_MAX + 1))).toBe(false);
  });

  it("should_reject_an_empty_or_blank_name", () => {
    expect(isPersonName("")).toBe(false);
    expect(isPersonName("   ")).toBe(false);
  });

  it("should_measure_the_name_after_trimming", () => {
    expect(isPersonName(`  ${"N".repeat(PERSON_NAME_MAX)}  `)).toBe(true);
  });

  it("should_agree_with_the_server_schema", () => {
    const base = { nameAr: "مريم", preferredLanguage: "en" as const, version: 1 };
    for (const nameEn of ["", " ", "N".repeat(PERSON_NAME_MAX), "N".repeat(PERSON_NAME_MAX + 1)]) {
      expect(profileInput.safeParse({ ...base, nameEn }).success).toBe(isPersonName(nameEn));
    }
  });
});
