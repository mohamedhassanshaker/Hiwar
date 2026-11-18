"use client";

import { useCallback, useState, useTransition } from "react";

import type { OrgUnitRow } from "@/features/organisation/types";
import { Btn } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { CodeField } from "@/components/shared/forms";
import { usePeople } from "@/components/shared/directory";
import { createOrgUnit, editOrgUnit } from "@/features/organisation/actions";
import { useAwp } from "@/hooks/use-awp";

/** S-42: the org unit modals, New and Edit, which share the name, parent and lead fields. */

export type OrgUnitOption = { id: string; nameEn: string; nameAr: string; code: string };

type UnitValues = { nameEn: string; nameAr: string; parent: string; lead: string };

/** The unit and every unit under it: none of them may become its parent (`UC-42.1-03`). */
export function branchOf(units: OrgUnitRow[], id: string): Set<string> {
  const branch = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit.parentId && branch.has(unit.parentId) && !branch.has(unit.id)) {
        branch.add(unit.id);
        grew = true;
      }
    }
  }
  return branch;
}

/** The names, the parent and the optional lead, as both modals show them. */
function UnitFields({
  values,
  parents,
  onChange,
}: {
  values: UnitValues;
  parents: OrgUnitOption[];
  onChange: (patch: Partial<UnitValues>) => void;
}) {
  const { t } = useAwp();
  const people = usePeople();
  return (
    <>
      <Field label={t("Name (English)", "الاسم (إنجليزي)")}>
        <input className="awp-input" value={values.nameEn} onChange={(event) => onChange({ nameEn: event.target.value })} />
      </Field>
      <Field label={t("Name (Arabic)", "الاسم (عربي)")}>
        <input className="awp-input" dir="rtl" value={values.nameAr} onChange={(event) => onChange({ nameAr: event.target.value })} />
      </Field>
      <Field label={t("Parent", "الوحدة الأم")}>
        <PopSelect className="awp-input" value={values.parent} onChange={(event) => onChange({ parent: event.target.value })}>
          <option value="">{t("None — a top-level unit", "بدون — وحدة رئيسية")}</option>
          {parents.map((option) => (
            <option key={option.id} value={option.id}>{t(option.nameEn, option.nameAr)}</option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Lead (optional)", "القائد (اختياري)")}>
        <PopSelect className="awp-input" value={values.lead} onChange={(event) => onChange({ lead: event.target.value })}>
          <option value="">{t("No lead", "بدون قائد")}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{t(person.name, person.nameAr)}</option>
          ))}
        </PopSelect>
      </Field>
    </>
  );
}

/** A refusal from the server, shown on the form. */
function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{text}</p>;
}

/** `UC-42.1-02`: the New org unit modal, with the code suggested from the name (`COM-13`). */
export function NewOrgUnitModal({ options, onClose }: { options: OrgUnitOption[]; onClose: () => void }) {
  const { t, why } = useAwp();
  const [values, setValues] = useState<UnitValues>({ nameEn: "", nameAr: "", parent: "", lead: "" });
  const [code, setCode] = useState("");
  // Stable, so CodeField's effect runs on a value change and not on every render.
  const onCode = useCallback((next: string) => setCode(next), []);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await createOrgUnit({
        code,
        nameEn: values.nameEn.trim(),
        nameAr: values.nameAr.trim(),
        parentOrgUnitId: values.parent || null,
        leadPersonId: values.lead || null,
      });
      // `UC-42.1-03`: a duplicate code comes back as a message on the form, not a crash.
      if (result.ok) onClose();
      else setProblem(why(result));
    });

  const ready = values.nameEn.trim() && values.nameAr.trim() && code.trim();

  return (
    <Modal
      title={t("New org unit", "وحدة تنظيمية جديدة")}
      onClose={onClose}
      dirty={Boolean(values.nameEn || values.nameAr || values.parent || values.lead)}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Create org unit", "إنشاء وحدة")} disabled={!ready || pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <UnitFields values={values} parents={options} onChange={(patch) => setValues({ ...values, ...patch })} />
        <CodeField from={values.nameEn} onChange={onCode} />
        <Problem text={problem} />
      </div>
    </Modal>
  );
}

/**
 * `UC-42.1`: edit an existing unit. Only the fields that changed are sent, so an untouched
 * parent is not a move. The code is the unit's identity and is not editable.
 */
export function EditOrgUnitModal({
  unit,
  units,
  options,
  onClose,
}: {
  unit: OrgUnitRow;
  units: OrgUnitRow[];
  options: OrgUnitOption[];
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const initial: UnitValues = { nameEn: unit.nameEn, nameAr: unit.nameAr, parent: unit.parentId ?? "", lead: unit.lead };
  const [values, setValues] = useState<UnitValues>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const branch = branchOf(units, unit.id);
  const parents = options.filter((option) => !branch.has(option.id));
  const patch = {
    ...(values.nameEn.trim() !== initial.nameEn ? { nameEn: values.nameEn.trim() } : {}),
    ...(values.nameAr.trim() !== initial.nameAr ? { nameAr: values.nameAr.trim() } : {}),
    ...(values.parent !== initial.parent ? { parentOrgUnitId: values.parent || null } : {}),
    ...(values.lead !== initial.lead ? { leadPersonId: values.lead || null } : {}),
  };
  const changed = Object.keys(patch).length > 0;
  const ready = changed && values.nameEn.trim() && values.nameAr.trim();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await editOrgUnit({ id: unit.id, expectedVersion: unit.version, ...patch });
      if (result.ok) onClose();
      else setProblem(why(result));
    });

  return (
    <Modal
      title={t("Edit org unit", "تعديل الوحدة التنظيمية")}
      onClose={onClose}
      dirty={changed}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Save changes", "حفظ التغييرات")} disabled={!ready || pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <UnitFields values={values} parents={parents} onChange={(next) => setValues({ ...values, ...next })} />
        <Problem text={problem} />
      </div>
    </Modal>
  );
}
