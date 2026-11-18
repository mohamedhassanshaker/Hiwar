/** A run's title is cut from its prompt without splitting a character (D378). */
import { describe, expect, it } from "vitest";
import { RUN_TITLE_LENGTH, runTitle } from "@/features/agents/run-title";

describe("runTitle", () => {
  it("keeps a short prompt whole", () => {
    expect(runTitle("Summarise this page")).toBe("Summarise this page");
  });

  it("cuts a long prompt at 120 characters", () => {
    expect(runTitle("a".repeat(300))).toBe("a".repeat(RUN_TITLE_LENGTH));
  });

  it("never leaves half an emoji where the cut falls inside one", () => {
    const prompt = `${"a".repeat(RUN_TITLE_LENGTH - 1)}📎 file.zip`;

    const title = runTitle(prompt);

    expect(title.endsWith("📎")).toBe(true);
    expect(title.isWellFormed()).toBe(true);
  });
});
