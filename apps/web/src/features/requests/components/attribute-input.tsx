"use client";

import { Field } from "@/components/ui/field";
import { PopDate, PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";
import type { AttributeDefinition } from "@/features/requests/types";

/** The control an attribute is entered with, by its data type (D304). Values are text, as stored. */
export function AttributeInput({
  attribute,
  value,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useAwp();
  const label = t(attribute.labelEn, attribute.labelAr);
  switch (attribute.dataType) {
    case "LongText":
      return <textarea className="awp-input" style={{ minHeight: 72, resize: "vertical" }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
    case "Number":
    case "Money":
      return <input className="awp-input" type="number" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
    case "Date":
      return <PopDate className="awp-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
    case "DateTime":
      return <input className="awp-input" type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
    case "Enum":
      return (
        <PopSelect className="awp-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          <option value="">{t("Choose…", "اختر…")}</option>
          {(attribute.enumValues ?? []).map((option) => (
            <option key={option.value} value={option.value}>{t(option.labelEn, option.labelAr)}</option>
          ))}
        </PopSelect>
      );
    case "Boolean":
      return <input type="checkbox" style={{ alignSelf: "flex-start" }} checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} aria-label={label} />;
    default:
      return <input className="awp-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />;
  }
}

/**
 * The attributes a form asks, laid out alike on the request form and in a step's action
 * window: two columns where they fit, and a long text across the whole row (D313).
 */
export function AttributeFields({
  attributes,
  valueOf,
  onChange,
  problemOf,
}: {
  attributes: AttributeDefinition[];
  valueOf: (key: string) => string;
  onChange: (key: string, value: string) => void;
  /** The message to show under a field, or null. */
  problemOf: (attribute: AttributeDefinition) => string | null;
}) {
  const { t } = useAwp();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 12 }}>
      {attributes.map((attribute) => {
        const problem = problemOf(attribute);
        return (
          <div key={attribute.key} style={attribute.dataType === "LongText" ? { gridColumn: "1 / -1" } : undefined}>
            <Field label={t(attribute.labelEn, attribute.labelAr) + (attribute.required ? " *" : "")}>
              <AttributeInput attribute={attribute} value={valueOf(attribute.key)} onChange={(value) => onChange(attribute.key, value)} />
              {/* `UC-28.1-03`: the message is on the field it is about. */}
              {problem && (
                <p className="awp-small" style={{ margin: "4px 0 0", color: "var(--text-danger)" }} role="alert">
                  {problem}
                </p>
              )}
            </Field>
          </div>
        );
      })}
    </div>
  );
}
