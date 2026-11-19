import { describe, expect, it } from "vitest";

import { BRIEF_MAX_CHARS, agentAnswerOf, clip, composeBrief, withBrief } from "@/features/agents/brief";

/**
 * D384: a work item or request run starts from a brief of the record, and its answer is posted
 * back on the record as the agent's comment. RUN-88152 got "Changes were requested on TSK-2305"
 * and nothing else, and asked what TSK-2305 was.
 */

describe("D384 the brief of a record", () => {
  it("lists the facts it has, leaves out the empty ones and says none for an empty section", () => {
    const brief = composeBrief({
      heading: "Work item TSK-2305: Create SFD Merchant 2",
      facts: [["Status", "InProgress"], ["Due", null], ["Blocked because", "  "]],
      sections: [
        { title: "Description", lines: ["Create a merchant for Sharjah Finance Department."] },
        { title: "Attachments (names only)", lines: [] },
      ],
    });
    expect(brief).toContain("# Work item TSK-2305: Create SFD Merchant 2");
    expect(brief).toContain("- Status: InProgress");
    expect(brief).not.toContain("Due");
    expect(brief).not.toContain("Blocked because");
    expect(brief).toContain("## Attachments (names only)\nnone");
  });

  it("drops the oldest history first when it is too long, and says how many went", () => {
    const history = Array.from({ length: 200 }, (_, index) => `- entry ${index} ${"x".repeat(400)}`);
    const brief = composeBrief({ heading: "Request REQ-1", facts: [], sections: [{ title: "History", lines: history }] });
    expect(brief.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
    expect(brief).toContain("- entry 199 ");
    expect(brief).not.toContain("- entry 0 ");
    expect(brief).toMatch(/\(\d+ older entries left out\)/);
  });

  it("cuts a long value by character, never through an emoji", () => {
    expect(clip("📎".repeat(5), 3)).toBe("📎📎📎 […]");
    expect(clip("short", 10)).toBe("short");
  });

  it("puts what was asked first, then says how the answer is used, then the brief", () => {
    const prompt = withBrief("Changes were requested on TSK-2305: use the new fee.", "# Work item TSK-2305", "TSK-2305");
    expect(prompt.startsWith("Changes were requested on TSK-2305: use the new fee.")).toBe(true);
    expect(prompt).toContain("is posted on TSK-2305 as your comment");
    expect(prompt.endsWith("# Work item TSK-2305")).toBe(true);
  });
});

describe("D384 the answer posted on the record", () => {
  it("is the run's text as it is", () => {
    expect(agentAnswerOf("  Merchant SFD-2 created, id 4471.  ")).toBe("Merchant SFD-2 created, id 4471.");
  });

  it("reads a step's JSON as the decision and its reason", () => {
    expect(agentAnswerOf('{"action":"Approve","comment":"All documents are present."}')).toBe(
      "Decision: Approve. All documents are present.",
    );
  });

  it("keeps JSON that is not a step result as text, and is empty when the run said nothing", () => {
    expect(agentAnswerOf('["a","b"]')).toBe('["a","b"]');
    expect(agentAnswerOf("   ")).toBe("");
  });
});
