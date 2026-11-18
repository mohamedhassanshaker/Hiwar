import { fieldRulesTable, type FieldRule } from "@/lib/field-rules";

import type { UpdateProjectInput } from "./schema";

/**
 * The field rules of a project: what each editable field needs, and whether an agent may
 * set it without a person agreeing first.
 *
 * The same two questions the reference module asks. The **privilege** applies to whoever
 * asks, the console included; **sensitivity** is only about an agent acting unattended,
 * because a person clicking Save is already the decision.
 *
 * A project is where sensitivity, who may work in it and what its agents may call are
 * decided, so most of this table is sensitive: everything in the project — its rooms, its
 * files, its artifacts — takes the project's own policy, and widening it widens theirs.
 */
export const PROJECT_FIELD_RULES: Record<ProjectField, FieldRule> = {
  nameEn: { privilege: "projects:write", sensitive: false },
  nameAr: { privilege: "projects:write", sensitive: false },
  status: { privilege: "projects:write", sensitive: false },
  sensitivity: {
    privilege: "projects:write",
    sensitive: true,
    reason: "Every room, file and artifact in the project takes its sensitivity, so lowering it widens who may read them.",
  },
  requireReviewerNotAuthor: {
    privilege: "projects:write",
    sensitive: true,
    reason: "Turning this off lets the person who did the work be the one who reviews it.",
  },
  allowedConnectors: {
    privilege: "projects:write",
    sensitive: true,
    reason: "The list decides which connectors an agent may call inside the project, and it is replaced whole.",
  },
  allowedAgents: {
    privilege: "projects:write",
    sensitive: true,
    reason: "The list decides which agents may be given work in the project, and it is replaced whole.",
  },
  approvalRules: {
    privilege: "projects:write",
    sensitive: true,
    reason: "These are the actions a human has to approve inside the project; a rule dropped here is a gate removed.",
  },
};

export type ProjectField =
  | "nameEn"
  | "nameAr"
  | "sensitivity"
  | "status"
  | "requireReviewerNotAuthor"
  | "allowedConnectors"
  | "allowedAgents"
  | "approvalRules";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateProjectInput): ProjectField[] {
  return (Object.keys(PROJECT_FIELD_RULES) as ProjectField[]).filter((field) => field in patch);
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateProjectInput): ProjectField[] {
  return fieldsIn(patch).filter((field) => PROJECT_FIELD_RULES[field].sensitive);
}

/** The module's field rules as a table, for review. */
export function projectFieldRulesTable(): string {
  return fieldRulesTable("project", PROJECT_FIELD_RULES);
}
