import type { AttributeDefinition, RequestStep } from "./types";

/**
 * Whether a request type's transition steps may be published.
 *
 * Specification §7.2.5 and `UC-30.2-05` … `-08`. A published request type is what every
 * request of that type then follows, pinned to the version it started on, so a flow that
 * cannot reach a terminal step strands every request raised against it — and the version is
 * immutable by then. The checks therefore run before publishing, not after.
 *
 * Pure graph work over the steps as the designer shows them: no database, no version, no
 * ordering assumption beyond "the first step is where a request starts".
 *
 * A **terminal** step is one with no audience and no outgoing rule, which is how §7.2.5
 * defines it: "A terminal step has no audience and no outgoing transitions."
 */

export type FlowProblem = {
  /** Which check failed, so a caller can group or translate. */
  rule: "no-outgoing" | "unreachable" | "no-actor" | "unknown-target" | "unknown-attribute" | "no-terminal";
  /** The step the problem is about, by name. Empty when the problem is the flow's as a whole. */
  step: string;
  message: string;
  messageAr: string;
};

/** A step with nothing to do and nowhere to go: §7.2.5's terminal step. */
export function isTerminal(step: RequestStep): boolean {
  return step.aud.length === 0 && step.out.length === 0;
}

/** Whether any audience on the step may act, rather than only watch or be notified. */
function hasActor(step: RequestStep): boolean {
  // The audience carries its access, so this is the stored fact rather than a reading of
  // the label: an audience that may only be notified cannot move the request on.
  return step.aud.some(([, , access]) => access === "CanAct");
}

/** The attribute keys a condition may refer to. */
function attributeKeys(attributes: AttributeDefinition[]): Set<string> {
  return new Set(attributes.map((attribute) => attribute.key));
}

/**
 * The identifiers a routing condition reads, e.g. `amount_aed >= 5000` reads `amount_aed`.
 * Comparison values, numbers and the operators themselves are not identifiers.
 */
export function conditionAttributes(expression: string): string[] {
  const withoutStrings = expression.replace(/'[^']*'|"[^"]*"/g, " ");
  const words = withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const keywords = new Set(["and", "or", "not", "true", "false", "null", "in", "is"]);
  return [...new Set(words.filter((word) => !keywords.has(word.toLowerCase())))];
}

/**
 * Every reason this flow may not be published, in the order a designer would fix them.
 * An empty list means it may.
 */
export function validateFlow(steps: RequestStep[], attributes: AttributeDefinition[] = []): FlowProblem[] {
  const problems: FlowProblem[] = [];
  if (steps.length === 0) return problems;

  const byName = new Map(steps.map((step) => [step.n, step]));
  const keys = attributeKeys(attributes);

  for (const step of steps) {
    if (isTerminal(step)) continue;

    // `UC-30.2-05`: a non-terminal step with no way out strands anything that reaches it.
    if (step.out.length === 0) {
      problems.push({
        rule: "no-outgoing",
        step: step.n,
        message: `Step "${step.n}" has no outgoing transitions.`,
        messageAr: `الخطوة "${step.n}" بلا انتقالات خارجة.`,
      });
    }

    // `UC-30.2-07`: a step nobody may act on cannot be left, whatever its rules say.
    if (!hasActor(step)) {
      problems.push({
        rule: "no-actor",
        step: step.n,
        message: `Step "${step.n}" has no audience that can act.`,
        messageAr: `الخطوة "${step.n}" بلا جمهور يمكنه التصرف.`,
      });
    }

    for (const [expression, , target] of step.out) {
      // A rule pointing at a step that is not in the flow cannot ever be followed.
      if (!byName.has(target)) {
        problems.push({
          rule: "unknown-target",
          step: step.n,
          message: `Step "${step.n}" has a rule going to "${target}", which is not a step of this type.`,
          messageAr: `الخطوة "${step.n}" بها قاعدة تنتقل إلى "${target}"، وهي ليست خطوة في هذا النوع.`,
        });
      }

      // `UC-30.2-08`: a condition on an attribute the type has not got never matches, so the
      // request stops at this step with "No matching route" (`UC-29.2-09`).
      if (keys.size > 0 && /[<>=!]/.test(expression)) {
        // A guarded action rule reads `Approve if <condition>`; only the condition names attributes.
        for (const name of conditionAttributes(expression.replace(/^.*?\s+if\s+/i, ""))) {
          if (!keys.has(name)) {
            problems.push({
              rule: "unknown-attribute",
              step: step.n,
              message: `Step "${step.n}" has a condition on "${name}", which is not an attribute of this type.`,
              messageAr: `الخطوة "${step.n}" بها شرط على "${name}"، وهي ليست سمة في هذا النوع.`,
            });
          }
        }
      }
    }
  }

  // `UC-30.2-06`: reachability from the first step, which is where a request starts.
  const reached = new Set<string>([steps[0].n]);
  const queue = [steps[0]];
  while (queue.length) {
    const step = queue.shift()!;
    for (const [, , target] of step.out) {
      if (reached.has(target)) continue;
      reached.add(target);
      const next = byName.get(target);
      if (next) queue.push(next);
    }
  }
  for (const step of steps) {
    if (!reached.has(step.n)) {
      problems.push({
        rule: "unreachable",
        step: step.n,
        message: `Step "${step.n}" cannot be reached from "${steps[0].n}".`,
        messageAr: `لا يمكن الوصول إلى الخطوة "${step.n}" من "${steps[0].n}".`,
      });
    }
  }

  // A flow with no terminal step never closes a request, however well connected it is.
  if (!steps.some(isTerminal)) {
    problems.push({
      rule: "no-terminal",
      step: "",
      message: "This type has no terminal step, so a request of it could never close.",
      messageAr: "لا توجد خطوة نهائية في هذا النوع، فلا يمكن إغلاق أي طلب منه.",
    });
  }

  return problems;
}
