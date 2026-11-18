"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAgents, usePeople } from "@/components/shared/directory";
import { useProjOpts } from "@/components/shared/forms";
import { Sel } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { useTr } from "@/components/shared/status-tags";
import { Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopDate } from "@/components/ui/pop-select";
import * as D from "@/ds";
import { WORK_ITEM_STATUSES, WORK_ITEM_TYPES, PRIORITIES } from "@/db/schema/enums";
import { useAwp } from "@/hooks/use-awp";
import { queryOf } from "@/lib/inquiry";
import { hrefOf } from "@/lib/routes";
import { WORK_ITEM_INQUIRY_FIELDS, type WorkItemInquiryForm } from "../inquiry";

/** The empty form: every filter off. */
const NO_FILTERS = Object.fromEntries(WORK_ITEM_INQUIRY_FIELDS.map((field) => [field, ""])) as WorkItemInquiryForm;

/**
 * D388: the Work items report. Every filter the work items carry, and Show report, which opens
 * the report of the items that match (up to 2000) to print or save as PDF. The filters stay in the
 * address, so the form comes back as it was.
 */
export function WorkItemInquiry({ form }: { form: WorkItemInquiryForm }) {
  const { t, nm } = useAwp();
  const tr = useTr();
  const router = useRouter();
  const principals = [...usePeople(), ...useAgents()].map((x) => [x.id, nm(x)] as [string, string]);
  const projOpts = useProjOpts();
  const [draft, setDraft] = useState(form);
  const set = (field: keyof WorkItemInquiryForm) => (value: string) => setDraft((current) => ({ ...current, [field]: value === "any" ? "" : value }));
  const show = (next: WorkItemInquiryForm) => router.push(`${hrefOf("workItemsReportPdf")}?${queryOf(next)}`);
  const any = (label: string): [string, string] => ["any", label];
  const choice = (field: keyof WorkItemInquiryForm, label: string, opts: [string, string][]) => (
    <Field label={label}>
      <Sel value={draft[field] || "any"} onChange={set(field)} w={400} opts={opts} />
    </Field>
  );
  const date = (field: keyof WorkItemInquiryForm, label: string) => (
    <Field label={label}>
      <PopDate className="awp-input" value={draft[field]} onChange={(event) => set(field)(event.target.value)} />
    </Field>
  );
  const flag = (field: keyof WorkItemInquiryForm, label: string) => (
    <label className="awp-row" style={{ gap: 8, alignSelf: "end", minHeight: 40 }}>
      <input type="checkbox" checked={draft[field] === "1"} onChange={(event) => set(field)(event.target.checked ? "1" : "")} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="awp-page">
      <PageHead title={t("Work items report", "تقرير بنود العمل")} sub={t("Choose the filters, then show the report to print or save as PDF.", "اختر المرشحات، ثم اعرض التقرير لطباعته أو حفظه بصيغة PDF.")} />
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            show(draft);
          }}
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
        >
          <Field label={t("Title or key", "العنوان أو المفتاح")}>
            <input className="awp-input" value={draft.q} onChange={(event) => set("q")(event.target.value)} />
          </Field>
          <Field label={t("Project", "المشروع")}>
            <Sel value={draft.project || "any"} onChange={set("project")} opts={projOpts()} w={400} />
          </Field>
          {choice("type", t("Type", "النوع"), [any(t("Any type", "أي نوع")), ...WORK_ITEM_TYPES.map((type) => [type, tr(type)] as [string, string])])}
          {choice("status", t("Status", "الحالة"), [any(t("Any status", "أي حالة")), ...WORK_ITEM_STATUSES.map((status) => [status, tr(status)] as [string, string])])}
          {choice("priority", t("Priority", "الأولوية"), [any(t("Any priority", "أي أولوية")), ...PRIORITIES.map((priority) => [priority, tr(priority)] as [string, string])])}
          {choice("assignee", t("Assignee", "المُسند إليه"), [any(t("Anyone", "أي شخص")), ["none", t("Unassigned", "غير مُسند")], ...principals])}
          {choice("reviewer", t("Reviewer", "المراجع"), [any(t("Anyone", "أي شخص")), ...principals])}
          <Field label={t("Request key", "مفتاح الطلب")}>
            <input className="awp-input" value={draft.request} onChange={(event) => set("request")(event.target.value.trim())} dir="ltr" />
          </Field>
          {choice("level", t("Level", "المستوى"), [any(t("Items and sub-items", "البنود والبنود الفرعية")), ["top", t("Items only", "البنود فقط")], ["sub", t("Sub-items only", "البنود الفرعية فقط")]])}
          {date("dueFrom", t("Due from", "الاستحقاق من"))}
          {date("dueTo", t("Due to", "الاستحقاق إلى"))}
          {date("from", t("Created from", "الإنشاء من"))}
          {date("to", t("Created to", "الإنشاء إلى"))}
          {flag("open", t("Open only", "المفتوحة فقط"))}
          {flag("overdue", t("Overdue only", "المتأخرة فقط"))}
          <div className="awp-row" style={{ gap: 12, alignSelf: "end", minHeight: 40 }}>
            <button type="submit" className="awp-btn awp-btn-primary">
              <D.Button type="default" size="sm" state="default" label={t("Show report", "عرض التقرير")} />
            </button>
            <Lnk
              onClick={() => {
                setDraft(NO_FILTERS);
                router.replace(hrefOf("workItemsReport"));
              }}
            >
              {t("Clear", "مسح")}
            </Lnk>
          </div>
        </form>
      </Card>
    </div>
  );
}
