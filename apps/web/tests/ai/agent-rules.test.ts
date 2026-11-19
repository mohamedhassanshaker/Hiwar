import { describe, expect, it } from "vitest";

import { AGENT_TRUSTS } from "@/db/schema/enums";
import { ASSIGNABLE_AGENT_TRUSTS, runBudgetInput, setTrustInput, testAgentInput } from "@/features/agents/schema";

/**
 * The two agent rules that are decided before anything is written, so they hold wherever the
 * call comes from (`COM-08`). Neither needs a database: they are properties of the input.
 */

describe("UC-50.2-04 the trust levels an agent may be given", () => {
  it("offers every level except System", () => {
    expect(ASSIGNABLE_AGENT_TRUSTS).toEqual(AGENT_TRUSTS.filter((trust) => trust !== "System"));
    expect(ASSIGNABLE_AGENT_TRUSTS).toContain("Restricted");
    expect(ASSIGNABLE_AGENT_TRUSTS).toContain("Coordinator");
  });

  it("refuses System, which is the platform's own level and no agent's", () => {
    // UC-50.2-04: System is not assignable to any agent, so a form cannot send it however it
    // was built.
    expect(() => setTrustInput.parse({ code: "exp", trust: "System", version: 1 })).toThrow();
  });

  it("accepts each of the levels it does offer", () => {
    for (const trust of ASSIGNABLE_AGENT_TRUSTS) {
      expect(() => setTrustInput.parse({ code: "exp", trust, version: 1 }), `${trust} must be assignable`).not.toThrow();
    }
  });
});

describe("UC-51.1-05 the run budget", () => {
  const budget = (soft: number | null, hard: number | null) => ({ code: "exp", soft, hard, version: 1 });

  it("refuses a soft limit above the hard limit", () => {
    // Not a stricter setting but an unreachable one: the run stops before the warning fires.
    const result = runBudgetInput.safeParse(budget(5, 2));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/stop before it warned/i);
  });

  it("accepts a soft limit below or equal to the hard limit", () => {
    expect(runBudgetInput.safeParse(budget(2, 5)).success).toBe(true);
    expect(runBudgetInput.safeParse(budget(5, 5)).success).toBe(true);
  });

  it("accepts either limit being cleared, which is an agent with no budget of its own", () => {
    expect(runBudgetInput.safeParse(budget(null, 5)).success).toBe(true);
    expect(runBudgetInput.safeParse(budget(2, null)).success).toBe(true);
    expect(runBudgetInput.safeParse(budget(null, null)).success).toBe(true);
  });

  it("refuses a negative limit", () => {
    expect(runBudgetInput.safeParse(budget(-1, 5)).success).toBe(false);
    expect(runBudgetInput.safeParse(budget(1, -5)).success).toBe(false);
  });
});

describe("UC-51.3-01 the sample input of an agent test run", () => {
  it("refuses whitespace alone, which TC-AGT-105 checked in the removed playground dialog (D382)", () => {
    expect(testAgentInput.safeParse({ code: "exp", prompt: "     " }).success).toBe(false);
    expect(testAgentInput.safeParse({ code: "exp", prompt: "Review claim EXP-4471" }).success).toBe(true);
  });
});
