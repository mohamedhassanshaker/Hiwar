"use client";

import { useState, useTransition } from "react";

import { useAgents, useProjects, usePeople } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopDate, PopSelect } from "@/components/ui/pop-select";
import { createWorkItem, similarOpenItems } from "@/features/work-items/actions";
import { useAwp } from "@/hooks/use-awp";

/**
 * The New Work Item modal: title, project, type, assignee, reviewer, priority, due date, parent,
 * description and, for a bug, its severity and steps. It names similar open items as the title
 * is typed and warns when the due date is past. Opened on a request (D312) the item belongs to
 * that request and the modal closes; otherwise the new item opens.
 */
export function NewWorkItemModal({ onClose, go, owner }: ModalProps) {
  const { t, nm, why } = useAwp();
  const projects = useProjects();
  const people = usePeople();
  const agents = useAgents();
  const [txt, setTxt] = useState("");
  const [form, setForm] = useState({
    projectKey: projects[0]?.k ?? "",
    type: "Task",
    assignee: "",
    reviewer: people[0]?.id ?? "",
    priority: "Medium",
    dueAt: "",
    description: "",
    parentKey: "",
  });
  const [bug, setBug] = useState({ severity: "Medium", steps: "", expected: "", actual: "" });
  const [similar, setSimilar] = useState<{ key: string; titleEn: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** D312: opened on a request, the item is that request's work, in its project. */
  const requestKey = owner?.type === "Request" ? owner.key : undefined;
  const bugAttributes = form.type === "Bug" ? { ...bug } : undefined;
  // `UC-24.3-09`: a date already past is allowed, and the item is overdue the moment it
  // exists. Saying so before the click is the difference between a choice and a surprise.
  const overdue = form.dueAt !== "" && form.dueAt < new Date().toISOString().slice(0, 10);

  /** `UC-24.3-05`: what else is open in this project that reads like this title. */
  const lookForSimilar = (title: string) => {
    if (!form.projectKey || title.trim().length < 4) {
      setSimilar([]);
      return;
    }
    void similarOpenItems({ projectKey: form.projectKey, title }).then(setSimilar);
  };
  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const result = await createWorkItem({
          projectKey: form.projectKey,
          type: form.type,
          titleEn: txt,
          titleAr: txt,
          descriptionEn: form.description || undefined,
          assignee: form.assignee || undefined,
          reviewer: form.reviewer || undefined,
          priority: form.priority,
          dueAt: form.dueAt || undefined,
          parentKey: form.parentKey || undefined,
          requestKey,
          attributes: form.type === "Bug" ? bugAttributes : undefined,
        });
        // `UC-24.3-07` and `-08`: the reason comes back on the form rather than as a crash.
        if (!result.ok) {
          setError(why(result));
          return;
        }
        onClose();
        // The request lists its new work item; anywhere else the item opens.
        if (!requestKey) go("tasks", { open: result.key });
      } catch (problem) {
        setError(why(problem));
      }
    });
  return (
    <Modal
      title={t("New Work Item", "بند عمل جديد")}
      onClose={onClose}
      dirty={txt.trim().length > 0 || form.description.trim().length > 0}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Create work item", "إنشاء بند العمل")} disabled={pending || !txt.trim()} onClick={submit} />
        </>
      }
    >
      {/* `UC-24.3-05`: an open item that reads like this one, with a way to open it. */}
      {similar.length > 0 && (
        <div role="status" className="awp-small">
          {t("Similar open item:", "بند مفتوح مشابه:")}{" "}
          {similar.map((item) => (
            <button key={item.key} className="awp-lnk" onClick={() => go("tasks", { open: item.key })}>
              {item.key} {item.titleEn}
            </button>
          ))}
        </div>
      )}
      <Field label={t("Title", "العنوان")}>
        <input
          className="awp-input"
          value={txt}
          aria-label={t("Title", "العنوان")}
          onChange={(e) => {
            setTxt(e.target.value);
            lookForSimilar(e.target.value);
          }}
          placeholder={t("e.g. Update vendor list for Q4", "مثال: تحديث قائمة الموردين للربع الرابع")}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {requestKey ? (
          <Field label={t("Request", "الطلب")}>
            <div className="awp-input awp-mono" aria-readonly="true">{requestKey}</div>
          </Field>
        ) : (
          <Field label={t("Project", "المشروع")}>
            <PopSelect className="awp-input" value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })}>
              {projects.map((project) => (
                <option key={project.k} value={project.k}>
                  {project.k} — {t(project.n, project.nAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
        )}
        <Field label={t("Type", "النوع")}>
          <PopSelect className="awp-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="Task">{t("Task", "مهمة")}</option>
            <option value="SubItem">{t("Sub item", "بند فرعي")}</option>
            <option value="Bug">{t("Bug", "خطأ")}</option>
          </PopSelect>
        </Field>
        {/* `UC-24.3-03`: a sub item needs a parent, and takes that parent's project. */}
        {form.type === "SubItem" && (
          <Field label={t("Parent work item", "بند العمل الأصل")}>
            <input
              className="awp-input awp-mono"
              value={form.parentKey}
              aria-label={t("Parent work item", "بند العمل الأصل")}
              placeholder="TSK-2311"
              onChange={(e) => setForm({ ...form, parentKey: e.target.value })}
            />
          </Field>
        )}
        <Field label={t("Assignee", "المُسند إليه")}>
          <PopSelect className="awp-input" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
            <option value="">{t("Unassigned", "غير مُسند")}</option>
            {[...people, ...agents].map((p) => (
              <option key={p.id} value={p.id}>{nm(p)}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t("Priority", "الأولوية")}>
          <PopSelect className="awp-input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="Medium">{t("Medium", "متوسطة")}</option>
            <option value="High">{t("High", "عالية")}</option>
            <option value="Low">{t("Low", "منخفضة")}</option>
          </PopSelect>
        </Field>
        <Field label={t("Due date", "تاريخ الاستحقاق")}>
          <PopDate className="awp-input" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
        </Field>
        <Field label={t("Reviewer", "المراجع")}>
          <PopSelect className="awp-input" value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{nm(p)}</option>
            ))}
          </PopSelect>
        </Field>
      </div>
      <Field label={t("Description", "الوصف")}>
        <textarea className="awp-input" style={{ height: 80, padding: 12 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      {/* `UC-24.3-04`: a bug carries what someone needs to reproduce it. */}
      {form.type === "Bug" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("Severity", "الخطورة")}>
            <PopSelect className="awp-input" value={bug.severity} onChange={(e) => setBug({ ...bug, severity: e.target.value })}>
              {["Low", "Medium", "High", "Critical"].map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </PopSelect>
          </Field>
          <Field label={t("Steps to reproduce", "خطوات إعادة الإنتاج")}>
            <input className="awp-input" value={bug.steps} aria-label={t("Steps to reproduce", "خطوات إعادة الإنتاج")} onChange={(e) => setBug({ ...bug, steps: e.target.value })} />
          </Field>
          <Field label={t("Expected", "المتوقع")}>
            <input className="awp-input" value={bug.expected} aria-label={t("Expected", "المتوقع")} onChange={(e) => setBug({ ...bug, expected: e.target.value })} />
          </Field>
          <Field label={t("Actual", "الفعلي")}>
            <input className="awp-input" value={bug.actual} aria-label={t("Actual", "الفعلي")} onChange={(e) => setBug({ ...bug, actual: e.target.value })} />
          </Field>
        </div>
      )}
      {error && <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">{error}</p>}
      {/* `UC-24.3-09`: allowed, and overdue the moment it exists. */}
      {overdue && (
        <div className="awp-row awp-small" style={{ gap: 8, color: "var(--text-warning)" }} role="status">
          <Ic n="InfoSign" s={16} c="var(--icon-warning)" />
          {t("That due date is in the past, so the item will be overdue.", "تاريخ الاستحقاق في الماضي، لذا سيكون البند متأخراً.")}
        </div>
      )}
    </Modal>
  );
}
