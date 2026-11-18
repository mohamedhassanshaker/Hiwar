import type { AttributeDefinition } from "./types";

/**
 * What a value has to be to satisfy its attribute (`UC-28.1-03`), the one rule the form, the
 * server, a step's action and the external widget all apply. Values are stored as text: a
 * number as digits, a date as `YYYY-MM-DD`, a list as its option's value, a checkbox as
 * `true` or `false`. A required checkbox has to be ticked.
 */

/** The data types the designer offers, with the control each one is entered with. */
export const ATTRIBUTE_TYPE_LABELS: [type: string, en: string, ar: string][] = [
  ["Text", "Text", "نص"],
  ["LongText", "Long text", "نص طويل"],
  ["Number", "Number", "رقم"],
  ["Money", "Money", "مبلغ"],
  ["Date", "Date", "تاريخ"],
  ["DateTime", "Date and time", "تاريخ ووقت"],
  ["Enum", "List", "قائمة"],
  ["Boolean", "Checkbox", "مربع اختيار"],
];

export type AttributeProblem = { key: string; en: string; ar: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Why `value` does not satisfy `attribute`, or null. `required` overrides the definition's own flag. */
export function attributeProblem(
  attribute: AttributeDefinition,
  value: string | undefined,
  required: boolean = attribute.required,
): AttributeProblem | null {
  const given = (value ?? "").trim();
  const problem = (en: string, ar: string) => ({ key: attribute.key, en: `${attribute.labelEn} ${en}`, ar: `${attribute.labelAr} ${ar}` });
  if (attribute.dataType === "Boolean") {
    if (given !== "" && given !== "true" && given !== "false") return problem("must be ticked or not.", "يجب أن يكون محدداً أو غير محدد.");
    return required && given !== "true" ? problem("has to be ticked.", "يجب تحديده.") : null;
  }
  if (given === "") return required ? problem("is required.", "مطلوب.") : null;
  switch (attribute.dataType) {
    case "Number":
    case "Money":
      return Number.isFinite(Number(given)) ? null : problem("must be a number.", "يجب أن يكون رقماً.");
    case "Date":
      return DAY.test(given) && !Number.isNaN(Date.parse(given)) ? null : problem("must be a date.", "يجب أن يكون تاريخاً.");
    case "DateTime":
      return Number.isNaN(Date.parse(given)) ? problem("must be a date and time.", "يجب أن يكون تاريخاً ووقتاً.") : null;
    case "Enum":
      return (attribute.enumValues ?? []).some((option) => option.value === given)
        ? null
        : problem("must be one of its choices.", "يجب أن يكون أحد خياراته.");
    default:
      return null;
  }
}

/**
 * The first problem among `values` for the attributes asked at `stepName` (null: the request
 * form). Attributes asked elsewhere are checked only for their type when a value is given.
 */
export function attributesProblem(
  attributes: AttributeDefinition[],
  values: Record<string, string>,
  stepName: string | null,
): AttributeProblem | null {
  for (const attribute of attributes) {
    const asked = attribute.stepName === stepName;
    const problem = attributeProblem(attribute, values[attribute.key], asked && attribute.required);
    if (problem) return problem;
  }
  return null;
}

/** A stored value as a person reads it: a list's label, a checkbox as Yes or No. */
export function attributeDisplay(attribute: AttributeDefinition | undefined, value: string): [en: string, ar: string] {
  if (attribute?.dataType === "Boolean") return value === "true" ? ["Yes", "نعم"] : ["No", "لا"];
  const option = attribute?.enumValues?.find((one) => one.value === value);
  return option ? [option.labelEn, option.labelAr] : [value, value];
}
