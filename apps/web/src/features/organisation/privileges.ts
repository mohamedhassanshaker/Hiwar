import { fieldRulesTable, type FieldRule } from "@/lib/field-rules";

import type { UpdateOrgUnitInput } from "./schema";

/**
 * The field rules of an org unit: what each editable field needs, and whether an agent may
 * set it without a person agreeing first.
 *
 * The **privilege** applies to whoever asks, the console included; **sensitivity** is only
 * about an agent acting unattended.
 *
 * The parent is the sensitive one. A unit is not only a label: role grants are scoped to
 * org units, and the chart is drawn from the root down, so re-parenting a unit moves
 * everyone and everything under it and changes what those grants reach.
 */
export const ORG_UNIT_FIELD_RULES: Record<OrgUnitField, FieldRule> = {
  nameEn: { privilege: "organisation:write", sensitive: false },
  nameAr: { privilege: "organisation:write", sensitive: false },
  leadPersonId: { privilege: "organisation:write", sensitive: false },
  parentOrgUnitId: {
    privilege: "organisation:write",
    sensitive: true,
    reason: "Re-parenting moves every person, agent, project and child unit under it, and the grants scoped to it follow.",
  },
};

export type OrgUnitField = "nameEn" | "nameAr" | "parentOrgUnitId" | "leadPersonId";

/** The fields a patch actually names, which is what decides what it needs. */
export function fieldsIn(patch: UpdateOrgUnitInput): OrgUnitField[] {
  return (Object.keys(ORG_UNIT_FIELD_RULES) as OrgUnitField[]).filter((field) => field in patch);
}

/** The fields in this patch an agent may not set without a person agreeing first. */
export function sensitiveFieldsIn(patch: UpdateOrgUnitInput): OrgUnitField[] {
  return fieldsIn(patch).filter((field) => ORG_UNIT_FIELD_RULES[field].sensitive);
}

/** The module's field rules as a table, for review. */
export function orgUnitFieldRulesTable(): string {
  return fieldRulesTable("org_unit", ORG_UNIT_FIELD_RULES);
}
