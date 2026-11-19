import type { PermissionCode } from "@/authz/permissions";

/**
 * What one editable field of a subject needs, and whether an agent may set it unattended.
 *
 * Two separate questions, deliberately side by side. The **privilege** is who may change
 * the field at all, and applies to everybody — the console included. **Sensitivity** is
 * whether an agent acting on someone's behalf may set it without a person agreeing
 * first; a person clicking in the console is already the decision, so sensitivity does
 * not apply to them (D57, D58).
 *
 * Declarative rather than service logic, so a module's rules read as a table and are
 * testable on their own. Each subject keeps its own rules next to its schema; this is
 * only the shape they share and the renderer the owner reviews them with.
 */
export type FieldRule = {
  privilege: PermissionCode;
  /**
   * `true` when an agent needs a bound approval before setting it. The MCP server
   * escalates the call on the payload and refuses it without one (D49, D58).
   */
  sensitive: boolean;
  /** Why it is sensitive, in one line — this is what an approver reads. */
  reason?: string;
  /**
   * The values that need the approval, where only some of them do. Omitted means the
   * whole field does, which stays the default.
   *
   * A field whose every value waits for a person produces an approval for each ordinary
   * move as well as each consequential one, and a queue of approvals that are nearly all
   * routine is approved without being read. Naming the values that matter keeps the
   * approval for the decision it was meant for.
   *
   * Fail closed: a value that is not plainly one of the safe ones — not a string, so not
   * a value this rule can judge — still waits for a person.
   */
  sensitiveValues?: readonly string[];
};

/** Whether this particular value of a field is one an agent may not set unattended. */
function needsApproval(rule: FieldRule, value: unknown): boolean {
  if (!rule.sensitive) return false;
  if (!rule.sensitiveValues) return true;
  return typeof value !== "string" || rule.sensitiveValues.includes(value);
}

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn<Field extends string>(
  rules: Record<Field, FieldRule>,
  patch: object,
): Field[] {
  return (Object.keys(rules) as Field[]).filter((field) => field in patch);
}

/** Every privilege one patch needs, each named once. */
export function privilegesFor<Field extends string>(
  rules: Record<Field, FieldRule>,
  patch: object,
): PermissionCode[] {
  return [...new Set(fieldsIn(rules, patch).map((field) => rules[field].privilege))];
}

/**
 * The fields in this patch an agent may not set without a person agreeing first.
 *
 * Judged on the patch, not on the field list, because a per-value rule can only be read
 * against the value being set. This is what the MCP server calls with the wire payload.
 */
export function sensitiveFields<Field extends string>(
  rules: Record<Field, FieldRule>,
  patch: object,
): Field[] {
  const values = patch as Record<string, unknown>;
  return fieldsIn(rules, patch).filter((field) => needsApproval(rules[field], values[field]));
}

/**
 * A subject's field rules as a table, for review.
 *
 * Rendered from the rules rather than written beside them, so the table cannot say one
 * thing while the code does another. The owner reads one of these per module before it
 * is coded, so a per-value rule names its values here rather than reading as a plain
 * "yes" that overstates what waits for a person.
 */
export function fieldRulesTable(subject: string, rules: Record<string, FieldRule>): string {
  const approval = (rule: FieldRule): string => {
    if (!rule.sensitive) return "no";
    return rule.sensitiveValues ? `only ${rule.sensitiveValues.join(", ")}` : "yes";
  };
  const rows = Object.entries(rules).map(
    ([field, rule]) =>
      `| ${field} | ${rule.privilege} | ${approval(rule)} | ${rule.reason ?? ""} |`,
  );
  return [
    `### ${subject}`,
    "",
    "| field | privilege | needs approval | why |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
