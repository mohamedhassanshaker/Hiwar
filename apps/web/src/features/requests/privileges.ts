import type { PermissionCode } from "@/authz/permissions";
import { fieldRulesTable as renderFieldRules, type FieldRule } from "@/lib/field-rules";

import type { UpdateStepInput } from "./schema";

/**
 * The field rules of a request type step: what each editable field needs, and whether an
 * agent may set it without a person agreeing first.
 *
 * Two separate questions, deliberately side by side. The **privilege** is who may change
 * the field at all, and applies to everybody — the console included. **Sensitivity** is
 * whether an agent acting on someone's behalf may set it unattended; a person clicking in
 * the console is already the decision, so sensitivity does not apply to them.
 *
 * A declarative rule rather than service logic, so it reads as a table and is testable on
 * its own. `fieldRulesTable()` renders it for review.
 */
export const STEP_FIELD_RULES: Record<string, FieldRule> & {
  nameEn: FieldRule;
  nameAr: FieldRule;
  slaValue: FieldRule;
  slaUnit: FieldRule;
  terminalOutcome: FieldRule;
  isTerminal: FieldRule;
  position: FieldRule;
} = {
  nameEn: { privilege: "request_types:write", sensitive: false },
  nameAr: { privilege: "request_types:write", sensitive: false },
  slaValue: { privilege: "request_types:write", sensitive: false },
  slaUnit: { privilege: "request_types:write", sensitive: false },
  terminalOutcome: { privilege: "request_types:write", sensitive: false },
  isTerminal: {
    privilege: "request_types:publish",
    sensitive: true,
    reason: "A terminal step loses every audience and outgoing rule it has.",
  },
  // A draft's order; nothing changes for a request until the draft is published, which is
  // the decision a person takes.
  position: { privilege: "request_types:write", sensitive: false },
};

export type StepField = "nameEn" | "nameAr" | "slaValue" | "slaUnit" | "terminalOutcome" | "isTerminal" | "position";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateStepInput): StepField[] {
  return (Object.keys(STEP_FIELD_RULES) as StepField[]).filter((field) => field in patch);
}

/** Every privilege one patch needs, each named once. */
export function privilegesForStepPatch(patch: UpdateStepInput): PermissionCode[] {
  return [...new Set(fieldsIn(patch).map((field) => STEP_FIELD_RULES[field].privilege))];
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateStepInput): StepField[] {
  return fieldsIn(patch).filter((field) => STEP_FIELD_RULES[field].sensitive);
}

/**
 * The module's field rules as a table, for review.
 *
 * Rendered from the rules rather than written beside them, so the table cannot say one
 * thing while the code does another.
 */
export function fieldRulesTable(
  subject: string,
  rules: Record<string, FieldRule> = STEP_FIELD_RULES,
): string {
  return renderFieldRules(subject, rules);
}
