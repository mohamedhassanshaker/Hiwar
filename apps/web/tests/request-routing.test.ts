import { describe, expect, it } from "vitest";

import { actionsOf, evaluateCondition, parseRuleLabel, routeFor, ruleLabel, type Rule } from "@/features/requests/routing";

/**
 * S-29: where a request goes when somebody acts on it.
 *
 * The rules of a published version are data, so this is the interpreter over them. A
 * request routed somewhere nobody chose is worse than one that stops and says so, which is
 * what the no-match case is about.
 */

const rules: Rule[] = [
  { kind: "Condition", expression: "amount_aed >= 5000", actionName: null, toStepName: "Finance + Work Lead" },
  { kind: "Action", expression: null, actionName: "Approve", toStepName: "Finance approval" },
  { kind: "Action", expression: null, actionName: "Request changes", toStepName: "Submitted" },
  { kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" },
];

describe("routing a request", () => {
  it("UC-29.2-01 an action rule moves the request to the step it names", () => {
    const outcome = routeFor(rules, "Approve", { amount_aed: "120" });
    expect(outcome.matched).toBe(true);
    expect(outcome.matched && outcome.toStepName).toBe("Finance approval");
  });

  it("UC-29.2-04 a condition on the request's own data routes it elsewhere", () => {
    // The condition sits above the action rules, so a large claim takes the longer route.
    const large = routeFor(rules, "Approve", { amount_aed: "7500" });
    expect(large.matched && large.toStepName).toBe("Finance + Work Lead");

    const small = routeFor(rules, "Approve", { amount_aed: "4999" });
    expect(small.matched && small.toStepName).toBe("Finance approval");
  });

  it("UC-29.2-02 Request changes sends it back to the step the requester is at", () => {
    const outcome = routeFor(rules, "Request changes", {});
    expect(outcome.matched && outcome.toStepName).toBe("Submitted");
  });

  it("UC-29.2-09 nothing matching is reported, not guessed", () => {
    const outcome = routeFor(
      [{ kind: "Condition", expression: "amount_aed >= 5000", actionName: null, toStepName: "Escalation" }],
      "Approve",
      { amount_aed: "10" },
    );
    expect(outcome).toEqual({ matched: false, reason: "NoMatchingRoute" });
  });

  it("UC-29.2-08 a rule may end the request where it is, which is a terminal step", () => {
    const outcome = routeFor(rules, "Close", {});
    expect(outcome.matched && outcome.toStepName).toBe("Closed");
  });

  it("UC-29.2-04 a guarded action branches on the request's data, and another action is not caught by it", () => {
    const guarded: Rule[] = [
      { kind: "Action", expression: "amount_aed >= 5000", actionName: "Approve", toStepName: "Finance" },
      { kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" },
      { kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" },
    ];
    expect(routeFor(guarded, "Approve", { amount_aed: "7500" })).toMatchObject({ toStepName: "Finance" });
    expect(routeFor(guarded, "Approve", { amount_aed: "10" })).toMatchObject({ toStepName: "Done" });
    expect(routeFor(guarded, "Close", { amount_aed: "7500" })).toMatchObject({ toStepName: "Closed" });
    expect(actionsOf(guarded)).toEqual(["Approve", "Close"]);
  });

  it("UC-30.2-03 the designer's When text reads back as the rule it wrote", () => {
    for (const when of ["Approve", "amount_aed >= 5000", "Approve if amount_aed >= 5000 and category == 'travel'"]) {
      expect(ruleLabel(parseRuleLabel(when))).toBe(when);
    }
    expect(parseRuleLabel("Approve if amount_aed >= 5000")).toEqual({
      kind: "Action",
      actionName: "Approve",
      expression: "amount_aed >= 5000",
    });
    expect(parseRuleLabel("amount_aed >= 5000")).toMatchObject({ kind: "Condition", actionName: null });
  });

  it("UC-30.2-03 the actions a step offers are its action rules, in the designer's order", () => {
    expect(actionsOf(rules)).toEqual(["Approve", "Request changes", "Close"]);
  });

  it("UC-30.2-08 a condition reads the request's attributes, and an absent one is false", () => {
    expect(evaluateCondition("amount_aed >= 5000", { amount_aed: "5000" })).toBe(true);
    expect(evaluateCondition("amount_aed > 5000", { amount_aed: "5000" })).toBe(false);
    // An attribute the request has not got makes the comparison false rather than throwing.
    expect(evaluateCondition("amount_aed >= 5000", {})).toBe(false);

    // Strings compare as strings, and quotes around the value are not part of it.
    expect(evaluateCondition("category == 'travel'", { category: "travel" })).toBe(true);
    expect(evaluateCondition("category != 'travel'", { category: "meals" })).toBe(true);

    // `and` binds tighter than `or`, as it does everywhere else.
    expect(
      evaluateCondition("amount_aed >= 5000 and category == 'travel' or urgent", { amount_aed: "10", urgent: "yes" }),
    ).toBe(true);
    expect(
      evaluateCondition("amount_aed >= 5000 and category == 'travel'", { amount_aed: "9000", category: "meals" }),
    ).toBe(false);
  });
});
