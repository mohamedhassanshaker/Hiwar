"use client";

import { useEffect, useState, useTransition } from "react";

import { usePeople } from "@/components/shared/directory";
import { DECOMPOSITIONS } from "@/db/schema/enums";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { listOrgUnitChoices } from "@/features/organisation/actions";
import { createProject } from "@/features/projects/actions";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";
import { CodeField } from "@/components/shared/forms";
import { useTr } from "@/components/shared/status-tags";

/**
 * S-20: the New Project dialog. Takes a name, owner, sensitivity, org unit, description and a
 * key suggested from the name, creates the project in Backlog through `createProject`, and
 * opens it. A refusal is shown in the dialog.
 */
export function NewProjectModal({ onClose }: ModalProps) {
  const { t, nm, why } = useAwp();
  const people = usePeople();
  const [units, setUnits] = useState<string[]>([]);
  const tr = useTr();
  const go = useGo();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(people[0]?.id ?? "");
  const [unit, setUnit] = useState("");
  const [sensitivity, setSensitivity] = useState("Internal");
  const [description, setDescription] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void listOrgUnitChoices().then((choices) => {
      const names = choices.map((choice) => choice.nameEn);
      setUnits(names);
      setUnit((current) => current || names[0] || "");
    });
  }, []);

  // `UC-20.2-04`: without a name there is no key either, because the key is suggested from
  // it, so Create has nothing to make a project from.
  const ready = name.trim() !== "" && key !== "" && owner !== "";

  const create = () =>
    start(async () => {
      setError(null);
      try {
        orThrow(await createProject({
          key,
          nameEn: name,
          nameAr: name,
          orgUnit: unit || units[0] || "",
          ownerPersonId: owner,
          sensitivity,
          status: "Backlog",
          requireReviewerNotAuthor: false,
          descriptionEn: description,
          descriptionAr: description,
        }));
        onClose();
        // `UC-20.2-01`: the new project opens on its detail page.
        go("projects", { open: key });
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <Modal
      title={t("New Project", "مشروع جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Create project", "إنشاء المشروع")} disabled={pending || !ready} onClick={create} />
        </>
      }
    >
      <Field label={t("Name", "الاسم")}>
        <input
          className="awp-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("e.g. Customer Onboarding", "مثال: تهيئة المتعاملين")}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Owner", "المستخدم")}>
          <PopSelect className="awp-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{nm(p)}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t("Sensitivity", "التصنيف")}>
          <PopSelect className="awp-input" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
            {["Public", "Internal", "Confidential", "Restricted"].map((x) => (
              <option key={x} value={x}>
                {tr(x)}
              </option>
            ))}
          </PopSelect>
        </Field>
      </div>
      <Field label={t("Org unit", "الوحدة التنظيمية")}>
        <PopSelect className="awp-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {units.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Description", "الوصف")}>
        <textarea className="awp-input" style={{ height: 72, padding: 12 }} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {/* `UC-20.2-02`: the key is suggested from the name and may be edited. */}
      <CodeField label={t("Project key", "مفتاح المشروع")} from={name} mode="key" onChange={setKey} />
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * The New request type dialog. Creates nothing itself: it closes and hands the name, code,
 * category and decomposition to `onCreateRequestType`, which opens the designer.
 */
export function NewRequestTypeModal({ onClose, onCreateRequestType }: ModalProps) {
  const { t } = useAwp();
  const [n, setN] = useState("");
  // `UC-27.2-02`: what the form shows is what is created — the category, the decomposition
  // and the code as the person left it, not a fixed Finance/None and the name's own key.
  const [category, setCategory] = useState("Finance");
  const [decomposition, setDecomposition] = useState("None");
  const [code, setCode] = useState("");
  return (
    <Modal
      title={t("New request type", "نوع طلب جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Create and configure steps", "إنشاء وإعداد الخطوات")}
            disabled={n.trim() === ""}
            onClick={() => {
              onClose();
              onCreateRequestType?.({ name: n.trim(), code, categoryEn: category, decomposition });
            }}
          />
        </>
      }
    >
      <Field label={t("Name", "الاسم")}>
        <input className="awp-input" value={n} onChange={(e) => setN(e.target.value)} placeholder={t("e.g. Training Request", "مثال: طلب تدريب")} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Category", "الفئة")}>
          <PopSelect className="awp-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Finance", "Procurement", "Customer", "HR", "IT"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t("Decomposition", "التجزئة")}>
          <PopSelect className="awp-input" value={decomposition} onChange={(e) => setDecomposition(e.target.value)}>
            {DECOMPOSITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </PopSelect>
        </Field>
      </div>
      <CodeField label={t("Type code", "رمز النوع")} from={n} mode="key" onChange={setCode} />
    </Modal>
  );
}
