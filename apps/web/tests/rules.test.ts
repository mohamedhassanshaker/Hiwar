import { describe, expect, it } from "vitest";

import { csvCell } from "@/server/audit-log";
import { can, analyticsLimited } from "@/server/authz";
import { meetsAA, textOn } from "@/server/contrast";
import { questionKey } from "@/server/knowledge";
import { redact, withinHours } from "@/server/visitor";
import { defaultAgentConfig } from "@/server/agents";

describe("ORG-002 permission matrix", () => {
  it("matches FR-001 and FR-003", () => {
    expect(can("builder", "conversations")).toBe(false);
    expect(can("support_agent", "take_over")).toBe(true);
    expect(can("support_agent", "supervisor_takeover")).toBe(false);
    expect(can("admin", "billing")).toBe(false);
    expect(can("billing", "billing")).toBe(true);
    expect(can("billing", "analytics")).toBe(false);
    expect(can("analyst", "export_analytics")).toBe(true);
    expect(can("builder", "export_analytics")).toBe(false);
    expect(analyticsLimited("support_agent")).toBe(true);
  });
});

describe("AGT-001 FR-027 redaction", () => {
  it("removes card numbers that pass the Luhn check and Emirates ID numbers", () => {
    expect(redact("my card 4242 4242 4242 4242 thanks")).toBe("my card [card number removed] thanks");
    expect(redact("ID 784-1990-1234567-1")).toBe("ID [national ID removed]");
    expect(redact("order 1234567890123")).toBe("order 1234567890123");
  });
});

describe("DEP-002 FR-012 widget contrast", () => {
  it("puts white text only on colours that keep WCAG AA", () => {
    expect(meetsAA("#4338ca")).toBe(true);
    expect(textOn("#4338ca")).toBe("#ffffff");
    expect(textOn("#14b8a6")).toBe("#1b1f4b");
  });
});

describe("AGT-001 FR-021 operating hours", () => {
  it("uses the agent's time zone", () => {
    const config = defaultAgentConfig();
    // Sunday 10:00 in Dubai (06:00 UTC) is inside Sun to Thu 09:00 to 23:00.
    expect(withinHours(config, new Date("2026-11-22T06:00:00Z"))).toBe(true);
    // Sunday 03:00 in Dubai is outside.
    expect(withinHours(config, new Date("2026-11-21T23:00:00Z"))).toBe(false);
  });
});

describe("KNO-002 question grouping", () => {
  it("folds Arabic letter forms, case and punctuation", () => {
    expect(questionKey("أين طلبي؟")).toBe(questionKey("اين طلبي"));
    expect(questionKey("Where is my ORDER?")).toBe(questionKey("where is my order"));
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe("KNO-002 FR-008 grouping of differently worded questions", () => {
  it("groups rewordings and keeps different questions apart", async () => {
    const { questionTerms, sameQuestion } = await import("@/server/knowledge");
    expect(sameQuestion(questionTerms("Do you deliver to Sharjah?"), questionTerms("Is there delivery to Sharjah"))).toBe(false);
    expect(sameQuestion(questionTerms("Do you deliver to Sharjah?"), questionTerms("Can you deliver to Sharjah please"))).toBe(true);
    expect(sameQuestion(questionTerms("هل عندكم توصيل للعين؟"), questionTerms("توصيل للعين"))).toBe(true);
    expect(sameQuestion(questionTerms("Opening hours on Friday"), questionTerms("Do you deliver to Sharjah?"))).toBe(false);
  });
});
