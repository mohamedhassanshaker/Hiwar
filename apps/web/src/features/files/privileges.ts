import { fieldRulesTable, type FieldRule } from "@/lib/field-rules";

import type { UpdateFileInput } from "./schema";

/**
 * The field rules of an artifact or a project file: what each editable field needs, and
 * whether an agent may set it without a person agreeing first.
 *
 * The **privilege** applies to whoever asks, the console included; **sensitivity** is only
 * about an agent acting unattended.
 *
 * The scope of use and its grants are the exception the rest of the catalogue does not
 * have: they decide who may read the file, so they are not offered to an agent at all
 * rather than offered behind an approval. `agentUpdateFileInput` is the patch an agent may
 * send, and it does not carry them. They are listed here because the console edits them
 * through the same write path, and the rules have to say what that path allows.
 */
export const FILE_FIELD_RULES: Record<FileField, FieldRule> = {
  active: { privilege: "files:write", sensitive: false },
  scopeOfUse: {
    privilege: "files:write",
    sensitive: true,
    reason: "The scope of use is who may read the file. Not offered to an agent on any tier.",
  },
  grants: {
    privilege: "files:write",
    sensitive: true,
    reason: "The grants name the people and agents that may read the file, and are replaced whole.",
  },
};

export type FileField = "active" | "scopeOfUse" | "grants";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateFileInput): FileField[] {
  return (Object.keys(FILE_FIELD_RULES) as FileField[]).filter((field) => field in patch);
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateFileInput): FileField[] {
  return fieldsIn(patch).filter((field) => FILE_FIELD_RULES[field].sensitive);
}

/** The module's field rules as a table, for review. */
export function fileFieldRulesTable(): string {
  return fieldRulesTable("file", FILE_FIELD_RULES);
}
