import {
  fieldRulesTable,
  fieldsIn as listFields,
  sensitiveFields,
  type FieldRule,
} from "@/lib/field-rules";

import type { WorkItemStatus } from "@/db/schema/enums";

import type { UpdateWorkItemInput } from "./schema";

/**
 * The statuses that take work out of the flow: `WORK_ITEM_STATUSES` holds seven, and these
 * are the two nothing is expected to happen under.
 *
 * One list, read twice: it is what an agent needs a person's agreement to move work into,
 * and it is what makes the open sub items under an item a cascade worth naming.
 */
export const TERMINAL_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ["Done", "Cancelled"];

/**
 * The field rules of a work item: what each editable field needs, and whether an agent may
 * set it without a person agreeing first.
 *
 * The **privilege** applies to whoever asks, the console included; **sensitivity** is only
 * about an agent acting unattended, because a person moving a card is already the decision.
 *
 * Only the status is sensitive, and only some of its values are. Retitling work, repricing
 * its urgency or moving its due date is ordinary editing that can be read and undone, and
 * so is moving a card along the board. What a person should see before it stands is an
 * agent reporting its own work finished or abandoned, so the approval is bound to the
 * values that say so rather than to every move of the field.
 */
export const WORK_ITEM_FIELD_RULES: Record<WorkItemField, FieldRule> = {
  titleEn: { privilege: "work_items:write", sensitive: false },
  titleAr: { privilege: "work_items:write", sensitive: false },
  descriptionEn: { privilege: "work_items:write", sensitive: false },
  priority: { privilege: "work_items:write", sensitive: false },
  dueAt: { privilege: "work_items:write", sensitive: false },
  status: {
    privilege: "work_items:write",
    sensitive: true,
    sensitiveValues: TERMINAL_WORK_ITEM_STATUSES,
    reason: "Done and Cancelled are the claim that the work needs nobody else.",
  },
};

export type WorkItemField = "titleEn" | "titleAr" | "descriptionEn" | "priority" | "dueAt" | "status";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateWorkItemInput): WorkItemField[] {
  return listFields(WORK_ITEM_FIELD_RULES, patch);
}

/**
 * The fields in this patch an agent may not set without a person agreeing first.
 *
 * The patch, not the field list: `status` waits for a person when it is being set to a
 * terminal value and runs unattended otherwise.
 */
export function sensitiveFieldsIn(patch: UpdateWorkItemInput): WorkItemField[] {
  return sensitiveFields(WORK_ITEM_FIELD_RULES, patch);
}

/** The module's field rules as a table, for review. */
export function workItemFieldRulesTable(): string {
  return fieldRulesTable("work_item", WORK_ITEM_FIELD_RULES);
}
