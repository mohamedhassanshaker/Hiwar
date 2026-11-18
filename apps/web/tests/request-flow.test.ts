import { describe, expect, it } from "vitest";

import { attributeKeyFor } from "@/features/requests/attribute-key";
import { attributeDisplay, attributeProblem, attributesProblem } from "@/features/requests/attributes";
import { conditionAttributes, isTerminal, validateFlow } from "@/features/requests/flow";
import type { AttributeDefinition, RequestStep } from "@/features/requests/types";

/**
 * `UC-30.2-05` … `-08`: publishing a request type is blocked while its flow has a hole.
 *
 * This matters more than most validation. A published version is pinned by every request
 * raised against it and is immutable from then on, so a flow that cannot reach a terminal
 * step strands those requests permanently — there is no edit that rescues them.
 */

const step = (
  n: string,
  out: [string, string, string][] = [],
  aud: [string, string, string][] = [["Finance", "المالية", "CanAct"]],
): RequestStep => ({
  n,
  nAr: n,
  isTerminal: false,
  terminalOutcome: "Completed",
  slaValue: null,
  slaUnit: null,
  aud,
  out,
});

/** §7.2.5: a terminal step has no audience and no outgoing transitions. */
const terminal = (n: string): RequestStep => ({ n, nAr: n, isTerminal: true, terminalOutcome: "Completed", slaValue: null, slaUnit: null, aud: [], out: [] });

const rule = (label: string, to: string): [string, string, string] => [label, label, to];

const amount: AttributeDefinition = { key: "amount_aed", labelEn: "Amount", labelAr: "المبلغ", dataType: "Money", required: true, enumValues: null, stepName: null };

describe("what counts as a terminal step", () => {
  it("is one with no audience and no outgoing rule", () => {
    expect(isTerminal(terminal("Closed"))).toBe(true);
    expect(isTerminal(step("Submitted", [rule("Submit", "Closed")]))).toBe(false);
    expect(
      isTerminal({ n: "Odd", nAr: "Odd", isTerminal: false, terminalOutcome: "Completed", slaValue: null, slaUnit: null, aud: [["Finance", "المالية", "CanAct"]], out: [] }),
    ).toBe(false);
  });
});

describe("a flow that may be published", () => {
  it("passes when every step leads somewhere and one step closes it", () => {
    const flow = [step("Submitted", [rule("Submit", "Approval")]), step("Approval", [rule("Approve", "Closed")]), terminal("Closed")];
    expect(validateFlow(flow)).toEqual([]);
  });

  it("allows a loop back, which is an explicit Return rule", () => {
    // `UC-30.2-10`: a Return path to an earlier step is allowed, because it is a rule.
    const flow = [
      step("Submitted", [rule("Submit", "Approval")]),
      step("Approval", [rule("Approve", "Closed"), rule("Return", "Submitted")]),
      terminal("Closed"),
    ];
    expect(validateFlow(flow)).toEqual([]);
  });

  it("says nothing about an empty flow, which is a draft nobody has designed yet", () => {
    expect(validateFlow([])).toEqual([]);
  });
});

describe("UC-30.2-05 a non-terminal step with no outgoing transitions", () => {
  it("blocks publishing and names the step", () => {
    const flow = [step("Submitted", [rule("Submit", "Approval")]), step("Approval"), terminal("Closed")];
    const problems = validateFlow(flow);
    expect(problems.some((problem) => problem.rule === "no-outgoing" && problem.step === "Approval")).toBe(true);
    expect(problems.find((problem) => problem.rule === "no-outgoing")?.message).toContain("Approval");
  });
});

describe("UC-30.2-06 a step unreachable from the first", () => {
  it("blocks publishing and names the step", () => {
    const flow = [
      step("Submitted", [rule("Submit", "Closed")]),
      step("Orphan", [rule("Approve", "Closed")]),
      terminal("Closed"),
    ];
    const problems = validateFlow(flow);
    expect(problems.some((problem) => problem.rule === "unreachable" && problem.step === "Orphan")).toBe(true);
  });

  it("counts a step reached only through a loop as reachable", () => {
    const flow = [
      step("Submitted", [rule("Submit", "Review")]),
      step("Review", [rule("Return", "Submitted"), rule("Approve", "Closed")]),
      terminal("Closed"),
    ];
    expect(validateFlow(flow).filter((problem) => problem.rule === "unreachable")).toEqual([]);
  });
});

describe("UC-30.2-07 a non-terminal step with no audience that can act", () => {
  it("blocks publishing, because nobody can move the request on", () => {
    const watchers: [string, string, string][] = [
      ["Finance", "المالية", "NotifyOnly"],
      ["Audit", "التدقيق", "ViewOnly"],
    ];
    const flow = [step("Submitted", [rule("Submit", "Closed")], watchers), terminal("Closed")];
    const problems = validateFlow(flow);
    expect(problems.some((problem) => problem.rule === "no-actor" && problem.step === "Submitted")).toBe(true);
  });

  it("accepts an agent audience, which can act", () => {
    const agent: [string, string, string][] = [["Expense Reviewer (agent)", "مدقق المصروفات", "CanAct"]];
    const flow = [step("Submitted", [rule("Submit", "Closed")], agent), terminal("Closed")];
    expect(validateFlow(flow).filter((problem) => problem.rule === "no-actor")).toEqual([]);
  });
});

describe("UC-30.2-08 a condition on an attribute the type has not got", () => {
  it("is flagged, because it can never match", () => {
    const flow = [step("Submitted", [rule("amount_aed >= 5000", "Closed")]), terminal("Closed")];
    const problems = validateFlow(flow, [{ ...amount, key: "total_aed" }]);
    expect(problems.some((problem) => problem.rule === "unknown-attribute")).toBe(true);
  });

  it("is accepted when the attribute exists", () => {
    const flow = [step("Submitted", [rule("amount_aed >= 5000", "Closed")]), terminal("Closed")];
    expect(validateFlow(flow, [amount]).filter((problem) => problem.rule === "unknown-attribute")).toEqual([]);
  });

  it("does not mistake an action name for a condition", () => {
    // "Approve" is an action, not an expression: no comparison, so nothing to resolve.
    const flow = [step("Submitted", [rule("Approve", "Closed")]), terminal("Closed")];
    expect(validateFlow(flow, [amount]).filter((problem) => problem.rule === "unknown-attribute")).toEqual([]);
  });

  it("reads the identifiers out of an expression and ignores the literals", () => {
    expect(conditionAttributes("amount_aed >= 5000")).toEqual(["amount_aed"]);
    expect(conditionAttributes("category == 'travel' and amount_aed > 100")).toEqual(["category", "amount_aed"]);
  });
});

describe("a rule pointing at a step that does not exist", () => {
  it("is flagged, because it could never be followed", () => {
    const flow = [step("Submitted", [rule("Submit", "Nowhere")]), terminal("Closed")];
    const problems = validateFlow(flow);
    expect(problems.some((problem) => problem.rule === "unknown-target")).toBe(true);
  });
});

describe("a flow with no terminal step", () => {
  it("is blocked, because a request of it could never close", () => {
    const flow = [step("Submitted", [rule("Submit", "Review")]), step("Review", [rule("Return", "Submitted")])];
    expect(validateFlow(flow).some((problem) => problem.rule === "no-terminal")).toBe(true);
  });
});

describe("the edit convention: privileges are the union over the fields named", () => {
  it("asks for what an SLA change needs, and no more", async () => {
    const { privilegesForStepPatch } = await import("@/features/requests/privileges");
    expect(
      privilegesForStepPatch({ code: "T", stepName: "Review", expectedVersion: 1, slaValue: 30, slaUnit: "Minutes" }),
    ).toEqual(["request_types:write"]);
  });

  it("asks for the stronger right when the patch names the terminal flag", async () => {
    // Marking a step terminal discards its audiences and its outgoing rules: a change to
    // the shape of the flow, not to one of its settings.
    const { privilegesForStepPatch } = await import("@/features/requests/privileges");
    expect(
      privilegesForStepPatch({ code: "T", stepName: "Review", expectedVersion: 1, isTerminal: true }),
    ).toEqual(["request_types:publish"]);
  });

  it("asks for both when the patch names an ordinary field and a sensitive one", async () => {
    const { privilegesForStepPatch } = await import("@/features/requests/privileges");
    expect(
      privilegesForStepPatch({
        code: "T",
        stepName: "Review",
        expectedVersion: 1,
        slaValue: 30,
        slaUnit: "Minutes",
        isTerminal: true,
      }),
    ).toEqual(expect.arrayContaining(["request_types:write", "request_types:publish"]));
  });

  it("refuses a field nobody declared rather than dropping it quietly", async () => {
    const { updateStepInput } = await import("@/features/requests/schema");
    const parsed = updateStepInput.safeParse({
      code: "T",
      stepName: "Review",
      expectedVersion: 1,
      slaValue: 30,
      colour: "red",
    });
    // A model that invents a column name must be told, not left believing the write worked.
    expect(parsed.success).toBe(false);
  });

  it("refuses an edit that changes nothing", async () => {
    const { updateStepInput } = await import("@/features/requests/schema");
    expect(updateStepInput.safeParse({ code: "T", stepName: "Review", expectedVersion: 1 }).success).toBe(false);
  });
});

/**
 * D41: what a request step expects back from the agent working it.
 *
 * A mission has no objective definition of done of its own, so the step's own contract is
 * the one the platform uses. These tests are over the derivation; the check itself is the
 * agent service's `step_contract`, so there is one validator rather than two.
 */
describe("the contract a request step holds an agent mission to", () => {
  const action = (name: string, to: string) => ({ kind: "Action" as const, expression: null, actionName: name, toStepName: to });

  it("is the actions the step offers, as the schema its output has to match", async () => {
    const { stepContract } = await import("@/features/requests/step-contract");
    const contract = stepContract([action("Approve", "Closed"), action("Reject", "Rejected")], "Approval");
    expect(contract?.actions).toEqual(["Approve", "Reject"]);
    const properties = (contract?.outputSchema as { properties: { action: { enum: string[] } } }).properties;
    // Return is every step's, as the console's Request changes is (D215).
    expect(properties.action.enum).toEqual(["Approve", "Reject", "Return"]);
    // A step without a rejecting action of its own still offers Reject (D218).
    const approveOnly = stepContract([action("Approve", "Closed")], "Approval");
    expect((approveOnly?.outputSchema as { properties: { action: { enum: string[] } } }).properties.action.enum).toEqual([
      "Approve",
      "Return",
      "Reject",
    ]);
    expect((contract?.outputSchema as { required: string[] }).required).toEqual(["action"]);
    // Nothing but the step action: a contract wider than the tool that satisfies it is not
    // a definition of done, it is a second opinion about one.
    expect((contract?.outputSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it("is none for a step that offers no named action, which has nothing objective to check", async () => {
    const { stepContract } = await import("@/features/requests/step-contract");
    expect(stepContract([], "Closed")).toBeNull();
    expect(stepContract([{ kind: "Condition", expression: "amount_aed >= 5000", actionName: null, toStepName: "Finance" }], "Triage")).toBeNull();
  });

  it("states the schema in the mission prompt, so the agent produces the shape that is then checked", async () => {
    const { stepContract, stepMissionPrompt } = await import("@/features/requests/step-contract");
    const contract = stepContract([action("Approve", "Closed")], "Approval")!;
    const prompt = stepMissionPrompt("REQ-9001", "Approval", contract);
    expect(prompt).toContain("REQ-9001");
    expect(prompt).toContain("\"Approve\"");
    // D215: how the agent decides, and the tool for each decision.
    expect(prompt).toMatch(/missing or incorrect/);
    expect(prompt).toMatch(/duplicates another/);
    expect(prompt).toContain("request_change_request_create");
    expect(prompt).toContain("request_rejection_create");
  });
});

describe("the key an attribute label is stored under", () => {
  it("UC-30.3-01 makes a key the schema accepts from what a designer types", () => {
    const valid = /^[a-z][a-z0-9_]*$/;
    for (const label of ["entity name", "Amount (AED)", "2nd contact", "الاسم", "Café owner"]) {
      expect(attributeKeyFor(label, [])).toMatch(valid);
    }
    expect(attributeKeyFor("entity name", [])).toBe("entity_name");
    expect(attributeKeyFor("Amount (AED)", [])).toBe("amount_aed");
    expect(attributeKeyFor("2nd contact", [])).toBe("a_2nd_contact");
    expect(attributeKeyFor("الاسم", [])).toBe("attribute");
  });

  it("UC-30.3-02 does not reuse a key the type already has", () => {
    expect(attributeKeyFor("Entity name", ["entity_name", "entity_name_2"])).toBe("entity_name_3");
  });
});

describe("D304 what a value has to be to satisfy its attribute", () => {
  const urgency: AttributeDefinition = {
    key: "urgency",
    labelEn: "Urgency",
    labelAr: "الأولوية",
    dataType: "Enum",
    required: true,
    enumValues: [
      { value: "Low", labelEn: "Low", labelAr: "منخفضة" },
      { value: "High", labelEn: "High", labelAr: "عالية" },
    ],
    stepName: null,
  };
  const consent: AttributeDefinition = { key: "consent", labelEn: "Consent", labelAr: "الموافقة", dataType: "Boolean", required: true, enumValues: null, stepName: null };
  const due: AttributeDefinition = { key: "due", labelEn: "Due", labelAr: "الاستحقاق", dataType: "Date", required: false, enumValues: null, stepName: null };
  const verified: AttributeDefinition = { ...amount, key: "verified_amount", stepName: "Finance" };

  it("takes a list's value only from its choices, and labels it in each language", () => {
    expect(attributeProblem(urgency, "High")).toBeNull();
    expect(attributeProblem(urgency, "high")?.en).toBe("Urgency must be one of its choices.");
    expect(attributeDisplay(urgency, "High")).toEqual(["High", "عالية"]);
  });

  it("holds a required checkbox to being ticked, and a date to a calendar day", () => {
    expect(attributeProblem(consent, "false")?.ar).toBe("الموافقة يجب تحديده.");
    expect(attributeProblem(consent, "true")).toBeNull();
    expect(attributeProblem(due, "2026-13-40")?.en).toBe("Due must be a date.");
    expect(attributeProblem(due, "2026-10-27")).toBeNull();
    expect(attributeProblem(due, "")).toBeNull();
  });

  it("requires an attribute only where it is asked: the form, or its own step", () => {
    const attributes = [amount, verified];
    expect(attributesProblem(attributes, { amount_aed: "10" }, null)).toBeNull();
    expect(attributesProblem(attributes, { amount_aed: "10" }, "Finance")?.key).toBe("verified_amount");
    // Asked elsewhere, a value given is still held to its type.
    expect(attributesProblem(attributes, { amount_aed: "10", verified_amount: "ten" }, null)?.key).toBe("verified_amount");
  });
});

describe("D385 the decision a step agent finished with", () => {
  it("is the contract's action and comment", async () => {
    const { stepDecisionOf } = await import("@/features/requests/step-contract");
    expect(stepDecisionOf(' {"action":"Complete","comment":" Merchant 331 created. "} ')).toEqual({
      action: "Complete",
      comment: "Merchant 331 created.",
    });
    expect(stepDecisionOf('{"action":"Approve"}')).toEqual({ action: "Approve", comment: "" });
  });

  it("is nothing when the output is text, not an object, or names no action", async () => {
    const { stepDecisionOf } = await import("@/features/requests/step-contract");
    expect(stepDecisionOf("I created the merchant.")).toBeNull();
    expect(stepDecisionOf('["Complete"]')).toBeNull();
    expect(stepDecisionOf('{"action":"  ","comment":"done"}')).toBeNull();
    expect(stepDecisionOf('{"comment":"done"}')).toBeNull();
  });
});
