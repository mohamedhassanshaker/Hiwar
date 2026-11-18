"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePeople } from "@/components/shared/directory";
import { useProjOpts } from "@/components/shared/forms";
import { Sel } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { useTr } from "@/components/shared/status-tags";
import { Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopDate } from "@/components/ui/pop-select";
import * as D from "@/ds";
import { useAwp } from "@/hooks/use-awp";
import { queryOf } from "@/lib/inquiry";
import { hrefOf } from "@/lib/routes";
import { REQUEST_INQUIRY_FIELDS, type RequestInquiryForm } from "../inquiry";
import type { RequestInquiryOptions, RequestType } from "../types";

/** The empty form: every filter off. */
const NO_FILTERS = Object.fromEntries(REQUEST_INQUIRY_FIELDS.map((field) => [field, ""])) as RequestInquiryForm;

/**
 * D388: the Requests report. Every filter the requests carry, and Show report, which opens the
 * report of the requests that match (up to 2000) to print or save as PDF. The filters stay in the
 * address, so the form comes back as it was.
 */
export function RequestInquiry({ form, options, types }: { form: RequestInquiryForm; options: RequestInquiryOptions; types: RequestType[] }) {
  const { t, nm } = useAwp();
  const tr = useTr();
  const router = useRouter();
  const people = usePeople();
  const projOpts = useProjOpts();
  const [draft, setDraft] = useState(form);
  const set = (field: keyof RequestInquiryForm) => (value: string) => setDraft((current) => ({ ...current, [field]: value === "any" ? "" : value }));
  const show = (next: RequestInquiryForm) => router.push(`${hrefOf("requestsReportPdf")}?${queryOf(next)}`);
  const any = (label: string): [string, string] => ["any", label];

  return (
    <div className="awp-page">
      <PageHead title={t("Requests report", "تقرير الطلبات")} sub={t("Choose the filters, then show the report to print or save as PDF.", "اختر المرشحات، ثم اعرض التقرير لطباعته أو حفظه بصيغة PDF.")} />
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
          <Field label={t("Request type", "نوع الطلب")}>
            <Sel value={draft.type || "any"} onChange={set("type")} w={400} opts={[any(t("Any type", "أي نوع")), ...types.map((type) => [type.c, t(type.n, type.nAr)] as [string, string])]} />
          </Field>
          <Field label={t("Status", "الحالة")}>
            <Sel value={draft.status || "any"} onChange={set("status")} w={400} opts={[any(t("Any status", "أي حالة")), ...options.statuses.map((status) => [status, tr(status)] as [string, string])]} />
          </Field>
          <Field label={t("Current step", "الخطوة الحالية")}>
            <Sel value={draft.step || "any"} onChange={set("step")} w={400} opts={[any(t("Any step", "أي خطوة")), ...options.steps.map(([en, ar]) => [en, t(en, ar)] as [string, string])]} />
          </Field>
          <Field label={t("Requester", "مقدم الطلب")}>
            <Sel value={draft.by || "any"} onChange={set("by")} w={400} opts={[any(t("Any requester", "أي مقدم طلب")), ...people.map((person) => [person.id, nm(person)] as [string, string]), ["ext", t("External contact", "جهة خارجية")]]} />
          </Field>
          <Field label={t("Channel", "القناة")}>
            <Sel value={draft.channel || "any"} onChange={set("channel")} w={400} opts={[any(t("Any channel", "أي قناة")), ...options.channels.map((channel) => [channel, channel] as [string, string])]} />
          </Field>
          <Field label={t("Level", "المستوى")}>
            <Sel value={draft.level || "any"} onChange={set("level")} w={400} opts={[any(t("Requests and sub-requests", "الطلبات والطلبات الفرعية")), ["top", t("Requests only", "الطلبات فقط")], ["sub", t("Sub-requests only", "الطلبات الفرعية فقط")]]} />
          </Field>
          <Field label={t("Submitted from", "التقديم من")}>
            <PopDate className="awp-input" value={draft.from} onChange={(event) => set("from")(event.target.value)} />
          </Field>
          <Field label={t("Submitted to", "التقديم إلى")}>
            <PopDate className="awp-input" value={draft.to} onChange={(event) => set("to")(event.target.value)} />
          </Field>
          <Field label={t("Due from", "الاستحقاق من")}>
            <PopDate className="awp-input" value={draft.dueFrom} onChange={(event) => set("dueFrom")(event.target.value)} />
          </Field>
          <Field label={t("Due to", "الاستحقاق إلى")}>
            <PopDate className="awp-input" value={draft.dueTo} onChange={(event) => set("dueTo")(event.target.value)} />
          </Field>
          <label className="awp-row" style={{ gap: 8, alignSelf: "end", minHeight: 40 }}>
            <input type="checkbox" checked={draft.overdue === "1"} onChange={(event) => set("overdue")(event.target.checked ? "1" : "")} />
            <span>{t("Overdue only", "المتأخرة فقط")}</span>
          </label>
          <div className="awp-row" style={{ gap: 12, alignSelf: "end", minHeight: 40 }}>
            <button type="submit" className="awp-btn awp-btn-primary">
              <D.Button type="default" size="sm" state="default" label={t("Show report", "عرض التقرير")} />
            </button>
            <Lnk
              onClick={() => {
                setDraft(NO_FILTERS);
                router.replace(hrefOf("requestsReport"));
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
