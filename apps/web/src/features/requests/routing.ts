/**
 * Where a request goes when somebody acts on the step it is at (`UC-29.2-01` … `-09`).
 *
 * The rules of a published version are data, not code, so this is an interpreter over them.
 * It is deliberately small: comparisons against the request's own attributes, joined by
 * `and` and `or`. Anything richer would be a language the designer cannot see the rules of.
 *
 * Kept apart from the database so the routing of a given flow and a given set of attributes
 * can be stated and tested on its own.
 */

/** One rule out of a step, as the version stored it. */
export type Rule = {
  kind: "Condition" | "Action";
  /** For a condition rule, e.g. `amount_aed >= 5000`; on an action rule, the condition that guards it. */
  expression: string | null;
  /** For an action rule, e.g. `Approve`. */
  actionName: string | null;
  /** The step it goes to, by name. Null means the rule ends the request where it is. */
  toStepName: string | null;
};

export type RoutingOutcome =
  | { matched: true; toStepName: string | null; rule: Rule }
  | { matched: false; reason: "NoMatchingRoute" };

const COMPARISONS = [">=", "<=", "!=", "==", "=", ">", "<"] as const;

/** A value as the comparison should read it: a number when both sides are numeric. */
function coerce(left: string, right: string): [string | number, string | number] {
  const asNumbers = [Number(left), Number(right)];
  if (asNumbers.every((value) => !Number.isNaN(value) && left.trim() !== "" && right.trim() !== "")) {
    return [asNumbers[0], asNumbers[1]];
  }
  return [left, right];
}

/** One comparison, e.g. `amount_aed >= 5000`, against the request's attributes. */
function compare(clause: string, attributes: Record<string, string>): boolean {
  const operator = COMPARISONS.find((candidate) => clause.includes(candidate));
  if (!operator) {
    // A bare attribute name is true when it has a value, which is how "is it set?" reads.
    const value = attributes[clause.trim()];
    return value !== undefined && value !== "";
  }
  const [rawLeft, rawRight] = clause.split(operator);
  const name = rawLeft.trim();
  // A comparison on an attribute the request has not got is false, not a comparison of the
  // attribute's own name against the value.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && attributes[name] === undefined) return false;
  const left = attributes[name] ?? name;
  const right = (attributes[rawRight.trim()] ?? rawRight.trim()).replace(/^['"]|['"]$/g, "");
  const [a, b] = coerce(left, right);
  switch (operator) {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "!=":
      return a !== b;
    default:
      return a === b;
  }
}

/**
 * Whether a condition holds for a request's attributes.
 *
 * `and` binds tighter than `or`, as it does everywhere else. An attribute the request has
 * not got makes its comparison false rather than throwing, because a request raised before
 * the attribute existed is a normal thing, not an error.
 */
export function evaluateCondition(expression: string, attributes: Record<string, string>): boolean {
  return expression
    .split(/\s+or\s+/i)
    .some((group) => group.split(/\s+and\s+/i).every((clause) => compare(clause.trim(), attributes)));
}

/**
 * The rule that decides where a request goes, or that nothing does.
 *
 * Action rules are tried against the action somebody took, and a guarded one (`Approve if
 * amount_aed >= 5000`) only while its condition holds; condition rules against the request's
 * attributes, whatever the action. The first match in the designer's order wins, which is
 * what lets a specific rule sit above a general one.
 *
 * `UC-29.2-09`: no match is reported rather than guessed. A request that routes somewhere
 * nobody chose is worse than one that stops and says so.
 */
export function routeFor(rules: Rule[], action: string, attributes: Record<string, string>): RoutingOutcome {
  for (const rule of rules) {
    if (rule.kind === "Action") {
      const guarded = !rule.expression || evaluateCondition(rule.expression, attributes);
      if (guarded && rule.actionName?.toLowerCase() === action.toLowerCase()) return { matched: true, toStepName: rule.toStepName, rule };
      continue;
    }
    if (rule.expression && evaluateCondition(rule.expression, attributes)) {
      return { matched: true, toStepName: rule.toStepName, rule };
    }
  }
  return { matched: false, reason: "NoMatchingRoute" };
}

/** The actions a step offers: every action rule out of it, in the designer's order. */
export function actionsOf(rules: Rule[]): string[] {
  return [...new Set(rules.filter((rule) => rule.kind === "Action" && rule.actionName).map((rule) => rule.actionName as string))];
}

/** A rule as the designer writes it: `amount_aed >= 5000`, `Approve`, or `Approve if amount_aed >= 5000`. */
export function ruleLabel(rule: { kind: string; expression: string | null; actionName: string | null }): string {
  if (rule.kind === "Condition") return rule.expression ?? "";
  return rule.expression ? `${rule.actionName ?? ""} if ${rule.expression}` : (rule.actionName ?? "");
}

/** The rule a designer's "When" text describes; the inverse of `ruleLabel`. */
export function parseRuleLabel(when: string): Pick<Rule, "kind" | "expression" | "actionName"> {
  const text = when.trim();
  const guarded = /^(.+?)\s+if\s+(.+)$/i.exec(text);
  if (guarded && !/[<>=!]/.test(guarded[1])) return { kind: "Action", actionName: guarded[1].trim(), expression: guarded[2].trim() };
  return /[<>=!]/.test(text)
    ? { kind: "Condition", expression: text, actionName: null }
    : { kind: "Action", expression: null, actionName: text };
}
