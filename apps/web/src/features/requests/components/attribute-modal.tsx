"use client";

import { useState } from "react";

import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { addRequestTypeAttribute, updateRequestTypeAttribute } from "@/features/requests/actions";
import { attributeKeyFor } from "@/features/requests/attribute-key";
import { ATTRIBUTE_TYPE_LABELS } from "@/features/requests/attributes";
import type { AttributeDefinition, RequestStep } from "@/features/requests/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { orThrow } from "@/lib/outcome";

/**
 * D304: one form for adding an attribute and for editing one. A choice keeps its stored value
 * when its labels change, so requests that hold it still read it; a new choice's value is its
 * English label. The key of an existing attribute is fixed, because requests store values under it.
 */
export function AttributeModal({
  code,
  attribute,
  attributes,
  steps,
  onClose,
}: {
  code: string;
  /** The attribute edited, or null to add one. */
  attribute: AttributeDefinition | null;
  attributes: AttributeDefinition[];
  steps: RequestStep[];
  onClose: () => void;
}) {
  const { t } = useAwp();
  const [run, pending] = useAction();
  const [form, setForm] = useState(() => ({
    labelEn: attribute?.labelEn ?? "",
    labelAr: attribute?.labelAr ?? "",
    dataType: attribute?.dataType ?? "Text",
    required: attribute?.required ?? false,
    stepName: attribute?.stepName ?? "",
    choices: (attribute?.enumValues ?? []).map((option) => ({ value: option.value as string | null, en: option.labelEn, ar: option.labelAr })),
  }));
  const [dirty, setDirty] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setDirty(true);
    setForm((was) => ({ ...was, ...patch }));
  };
  const setChoice = (index: number, patch: Partial<(typeof form.choices)[number]>) =>
    set({ choices: form.choices.map((choice, at) => (at === index ? { ...choice, ...patch } : choice)) });

  const isList = form.dataType === "Enum";
  const choices = form.choices
    .filter((choice) => choice.en.trim() !== "")
    .map((choice) => ({ value: choice.value ?? choice.en.trim(), labelEn: choice.en.trim(), labelAr: choice.ar.trim() || choice.en.trim() }));
  const repeated = new Set(choices.map((choice) => choice.value)).size !== choices.length;
  const problem =
    form.labelEn.trim() === ""
      ? t("Give the attribute an English label.", "أعطِ السمة تسمية بالإنجليزية.")
      : isList && choices.length === 0
        ? t("A list needs at least one choice.", "تحتاج القائمة إلى خيار واحد على الأقل.")
        : isList && repeated
          ? t("Each choice needs its own English label.", "يحتاج كل خيار إلى تسمية إنجليزية خاصة به.")
          : null;

  const save = () =>
    run(async () => {
      const fields = {
        labelEn: form.labelEn.trim(),
        labelAr: form.labelAr.trim() || form.labelEn.trim(),
        dataType: form.dataType,
        required: form.required,
        enumValues: isList ? choices : null,
        stepName: form.stepName || null,
      };
      if (attribute) {
        orThrow(await updateRequestTypeAttribute({ code, key: attribute.key, ...fields }));
      } else {
        orThrow(await addRequestTypeAttribute({ code, key: attributeKeyFor(fields.labelEn, attributes.map((one) => one.key)), ...fields }));
      }
      onClose();
      return attribute ? t("Attribute saved.", "تم حفظ السمة.") : t("Attribute added.", "تمت إضافة السمة.");
    });

  return (
    <Modal
      w={720}
      title={attribute ? t(`Edit ${attribute.labelEn}`, `تعديل ${attribute.labelAr}`) : t("Add attribute", "إضافة سمة")}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={attribute ? t("Save attribute", "حفظ السمة") : t("Add attribute", "إضافة سمة")} disabled={pending || problem !== null} title={problem ?? undefined} onClick={save} />
        </>
      }
    >
      <div className="awp-col" style={{ gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 12 }}>
          <Field label={t("Label (English)", "التسمية (إنجليزي)")}>
            <input className="awp-input" value={form.labelEn} onChange={(e) => set({ labelEn: e.target.value })} />
          </Field>
          <Field label={t("Label (Arabic)", "التسمية (عربي)")}>
            <input className="awp-input" dir="rtl" value={form.labelAr} onChange={(e) => set({ labelAr: e.target.value })} />
          </Field>
          <Field label={t("Type", "النوع")}>
            <PopSelect className="awp-input" value={form.dataType} onChange={(e) => set({ dataType: e.target.value })} aria-label={t("Type", "النوع")}>
              {ATTRIBUTE_TYPE_LABELS.map(([type, en, ar]) => (
                <option key={type} value={type}>{t(en, ar)}</option>
              ))}
            </PopSelect>
          </Field>
          <Field label={t("Asked on", "يُطلب في")}>
            <PopSelect className="awp-input" value={form.stepName} onChange={(e) => set({ stepName: e.target.value })} aria-label={t("Asked on", "يُطلب في")}>
              <option value="">{t("Request form", "نموذج الطلب")}</option>
              {steps.map((step) => (
                <option key={step.n} value={step.n}>{t(`Step: ${step.n}`, `الخطوة: ${step.nAr}`)}</option>
              ))}
            </PopSelect>
          </Field>
        </div>
        {attribute && (
          <p className="awp-small awp-muted" style={{ margin: 0 }}>
            {t("Key", "المفتاح")}: <span className="awp-mono">{attribute.key}</span>
          </p>
        )}
        <label className="awp-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={form.required} onChange={(e) => set({ required: e.target.checked })} />
          {t("Required", "إلزامي")}
        </label>
        {isList && (
          <div className="awp-col" style={{ gap: 8 }}>
            <span className="awp-small awp-muted">{t("Choices", "الخيارات")}</span>
            {form.choices.map((choice, index) => (
              <div key={index} className="awp-row" style={{ gap: 8 }}>
                <input
                  className="awp-input"
                  value={choice.en}
                  onChange={(e) => setChoice(index, { en: e.target.value })}
                  placeholder={t("Choice in English", "الخيار بالإنجليزية")}
                  aria-label={t(`Choice ${index + 1} in English`, `الخيار ${index + 1} بالإنجليزية`)}
                />
                <input
                  className="awp-input"
                  dir="rtl"
                  value={choice.ar}
                  onChange={(e) => setChoice(index, { ar: e.target.value })}
                  placeholder={t("Choice in Arabic", "الخيار بالعربية")}
                  aria-label={t(`Choice ${index + 1} in Arabic`, `الخيار ${index + 1} بالعربية`)}
                />
                <Btn type="ghost" label={t("Remove", "إزالة")} onClick={() => set({ choices: form.choices.filter((_, at) => at !== index) })} />
              </div>
            ))}
            <div>
              <Btn type="secondary" label={t("Add choice", "إضافة خيار")} onClick={() => set({ choices: [...form.choices, { value: null, en: "", ar: "" }] })} />
            </div>
          </div>
        )}
        {problem && dirty && (
          <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">{problem}</p>
        )}
      </div>
    </Modal>
  );
}
