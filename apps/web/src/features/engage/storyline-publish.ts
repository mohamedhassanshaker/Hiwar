import { type StepType, type Step, type Storyline } from "./storyline-types";

/** One problem that blocks Publish (`UC-64.1-10` … `-12`). */
/** `step` is empty for a problem of the storyline as a whole. */
export type PublishProblem = { step: string; reason: "NoSteps" | "NotConfigured" | "NoNextStep" | "Unreachable" | "MissingArabic" | "ToolNotAllowed"; detail?: string };

const TERMINAL: StepType[] = ["End", "Handoff"];

/** Steps that cannot be reached from the first one by any branch. */
function reachable(steps: Step[]): Set<string> {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const seen = new Set<string>();
  const queue = steps.length ? [steps[0].name] : [];
  while (queue.length) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const step = byName.get(name);
    if (!step) continue;
    const targets = [
      step.nextStepName,
      step.config.gotoStepName,
      step.config.otherwise,
      step.config.onErrorStepName,
      ...(step.config.branches ?? []).map((branch) => branch.goto),
    ];
    for (const target of targets) if (target && !seen.has(target)) queue.push(target);
  }
  return seen;
}

/**
 * Everything that stops a version being published.
 *
 * @param storyline the draft being published.
 * @param options `arabicEnabled` blocks a missing Arabic message; `allowedTools` are the
 *   tools the step's agent may call.
 */
export function publishProblems(
  storyline: Storyline,
  options: { arabicEnabled: boolean; allowedTools: (agentCode: string | null) => string[] },
): PublishProblem[] {
  const problems: PublishProblem[] = [];
  // A version with no steps ends every conversation as it opens (D279).
  if (storyline.steps.length === 0) problems.push({ step: "", reason: "NoSteps" });
  const live = reachable(storyline.steps);

  for (const step of storyline.steps) {
    const needsMessage = step.type === "Message" || step.type === "Ask" || step.type === "Confirm";
    if (needsMessage && (step.messageEn ?? "").trim() === "") problems.push({ step: step.name, reason: "NotConfigured" });
    if (step.type === "Ask" && !step.slot) problems.push({ step: step.name, reason: "NotConfigured", detail: "slot" });
    if (step.type === "Form" && !(step.config.formFields ?? []).length) {
      problems.push({ step: step.name, reason: "NotConfigured", detail: "formFields" });
    }
    if (!TERMINAL.includes(step.type) && !step.nextStepName && !step.config.gotoStepName && !(step.config.branches ?? []).length) {
      problems.push({ step: step.name, reason: "NoNextStep" });
    }
    if (!live.has(step.name)) problems.push({ step: step.name, reason: "Unreachable" });
    if (options.arabicEnabled && needsMessage && (step.messageAr ?? "").trim() === "") problems.push({ step: step.name, reason: "MissingArabic" });
    if (step.type === "Tool") {
      const allowed = options.allowedTools(step.agentCode);
      for (const ref of step.toolRefs) {
        if (!allowed.includes(ref)) problems.push({ step: step.name, reason: "ToolNotAllowed", detail: ref });
      }
    }
  }
  return problems;
}

/** The steps that point at `name`, which deleting it would leave dangling (`UC-64.1-07`). */
export function dependentSteps(steps: Step[], name: string): string[] {
  return steps
    .filter(
      (step) =>
        step.name !== name &&
        (step.nextStepName === name ||
          step.config.gotoStepName === name ||
          step.config.otherwise === name ||
          step.config.onErrorStepName === name ||
          (step.config.branches ?? []).some((branch) => branch.goto === name)),
    )
    .map((step) => step.name);
}
