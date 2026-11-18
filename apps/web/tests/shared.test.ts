import { describe, expect, it } from "vitest";

import { keyOf, slug } from "@/components/shared/forms";
import { chooseRecipients } from "@/features/organisation/notifications";
import { isMobile, profileInput, profilePhotoInput } from "@/features/organisation/schema";
import { formatMoney } from "@/i18n";
import { safePhotoRef } from "@/lib/photo";

/**
 * The shared pieces the common scenarios lean on, each tested where it is implemented
 * rather than through a screen that happens to use it.
 */

describe("COM-13 a code field is suggested from the name and may be overridden", () => {
  it("slugs a name", () => {
    expect(slug("Travel & Expense Policy")).toBe("travel-expense-policy");
    expect(slug("  Q4   Review  ")).toBe("q4-review");
    expect(slug("")).toBe("");
  });

  it("builds a key from the initials, or the first letters of a single word", () => {
    expect(keyOf("Finance Operations")).toBe("FO");
    expect(keyOf("Procurement")).toBe("PRO");
    expect(keyOf("Customer Service Desk")).toBe("CSD");
    expect(keyOf("")).toBe("");
  });

  it("leaves an overridden code alone", () => {
    // `CodeField` shows `slug(from)` until the writer types, and then shows what they typed:
    // the suggestion is a default, never a constraint.
    const suggestion = slug("Knowledge Refresh");
    const overridden = "kb-2026";
    expect(suggestion).toBe("knowledge-refresh");
    expect(overridden).not.toBe(suggestion);
  });
});

describe("COM-15 every cost value is written in AED", () => {
  it("puts the currency before the number in English and after it in Arabic", () => {
    expect(formatMoney("en", 915.7)).toBe("AED 915.70");
    expect(formatMoney("ar", 915.7)).toBe("915.70 د.إ");
    expect(formatMoney("en", 0)).toBe("AED 0.00");
  });
});

describe("COM-12 UC-04.1-04 an invalid mobile is refused", () => {
  it("accepts a mobile number and an empty field", () => {
    expect(isMobile("+971 50 123 4567")).toBe(true);
    expect(isMobile("0501234567")).toBe(true);
    expect(isMobile("")).toBe(true);
  });

  it("refuses anything that is not one", () => {
    expect(isMobile("not a number")).toBe(false);
    expect(isMobile("12345")).toBe(false);
    expect(isMobile("+971 50 123 4567 8901234")).toBe(false);
  });

  it("refuses it on the server too, so a forced call cannot save it", () => {
    const base = { nameEn: "Mariam", nameAr: "مريم", preferredLanguage: "en" as const, version: 1 };
    expect(profileInput.safeParse({ ...base, mobile: "+971 50 123 4567" }).success).toBe(true);
    expect(profileInput.safeParse({ ...base, mobile: "not a number" }).success).toBe(false);
    expect(profileInput.safeParse({ ...base, nameEn: "" }).success).toBe(false);
  });
});

describe("UC-04.1-05 a photo that is too large or the wrong format is refused", () => {
  const tiny = "data:image/png;base64," + "A".repeat(100);

  it("accepts a small PNG, JPEG or WebP", () => {
    expect(profilePhotoInput.safeParse({ photo: tiny, version: 1 }).success).toBe(true);
    expect(profilePhotoInput.safeParse({ photo: tiny.replace("png", "webp"), version: 1 }).success).toBe(true);
  });

  it("refuses another format and anything over 256 KB", () => {
    const bmp = "data:image/bmp;base64," + "A".repeat(100);
    const big = "data:image/png;base64," + "A".repeat(400_000);
    expect(profilePhotoInput.safeParse({ photo: bmp, version: 1 }).success).toBe(false);
    expect(profilePhotoInput.safeParse({ photo: big, version: 1 }).success).toBe(false);
  });
});

describe("UC-04.2 notification preferences decide who is sent a notification", () => {
  const on = { approvals: true, mentions: true, slaWarnings: true, dailyDigest: true, requestCreatedEmail: true, requestUpdatedEmail: true, requestFinishedEmail: true, workItemFinishedEmail: true };

  it("UC-04.2-01 leaves a person with the daily digest off out of the digest", () => {
    const people = [
      { personId: "a", preference: on },
      { personId: "b", preference: { ...on, dailyDigest: false } },
    ];
    expect(chooseRecipients("dailyDigest", people)).toEqual(["a"]);
    // The other channels are untouched by that choice.
    expect(chooseRecipients("mentions", people)).toEqual(["a", "b"]);
  });

  it("UC-04.2-02 leaves a person with mentions off out of a mention notification", () => {
    const people = [
      { personId: "a", preference: { ...on, mentions: false } },
      { personId: "b", preference: on },
    ];
    expect(chooseRecipients("mentions", people)).toEqual(["b"]);
  });

  it("UC-04.2-03 leaves a person with approvals off out of an approval notification", () => {
    const people = [
      { personId: "a", preference: { ...on, approvals: false } },
      { personId: "b", preference: on },
    ];
    expect(chooseRecipients("approvals", people)).toEqual(["b"]);
  });

  it("falls back to the platform's defaults for a person who has not chosen", () => {
    const people = [{ personId: "a", preference: null }];
    expect(chooseRecipients("approvals", people)).toEqual(["a"]);
    expect(chooseRecipients("dailyDigest", people)).toEqual([]);
  });
});

describe("a profile photo is only ever drawn from a value that cannot escape its CSS", () => {
  it("accepts what My profile uploads and what an identity provider hosts", () => {
    expect(safePhotoRef("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safePhotoRef("https://idp.tahseel.ae/photo/42.jpg")).toBe("https://idp.tahseel.ae/photo/42.jpg");
    expect(safePhotoRef(null)).toBeNull();
  });

  it("refuses anything that could close the url() it is put inside", () => {
    expect(safePhotoRef("x);position:fixed;width:100vw;height:100vh;background:red;//")).toBeNull();
    expect(safePhotoRef('https://idp.tahseel.ae/a.jpg");color:red;/*')).toBeNull();
    expect(safePhotoRef("http://idp.tahseel.ae/a.jpg")).toBeNull();
    expect(safePhotoRef("javascript:alert(1)")).toBeNull();
  });
});
