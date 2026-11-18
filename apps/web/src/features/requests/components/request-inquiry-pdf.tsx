"use client";

import { ReportFilters, ReportFrame, ReportSection, ReportTable } from "@/components/shared/report-frame";
import { useTr } from "@/components/shared/status-tags";
import { useAwp } from "@/hooks/use-awp";
import { formatDay } from "@/i18n";
import { queryOf } from "@/lib/inquiry";
import { hrefOf } from "@/lib/routes";
import type { RequestInquiryForm } from "../inquiry";
import type { Letterhead } from "@/types/letterhead";
import type { RequestInquiryRow, RequestType } from "../types";

/**
 * D388: a Requests report as a document — the filters it was run with, how many requests match,
 * and the table of them (up to 2000), to print or save as PDF.
 */
export function RequestInquiryPdf({
  form,
  rows,
  total,
  types,
  generatedAt,
  letterhead,
}: {
  letterhead: Letterhead;
  form: RequestInquiryForm;
  rows: RequestInquiryRow[];
  total: number;
  types: RequestType[];
  generatedAt: string;
}) {
  const { t, lang, aName } = useAwp();
  const tr = useTr();
  const typeName = (code: string) => {
    const type = types.find((candidate) => candidate.c === code);
    return type ? t(type.n, type.nAr) : code;
  };
  const filters: [string, string][] = [
    [t("Title or key", "العنوان أو المفتاح"), form.q],
    [t("Project", "المشروع"), form.project],
    [t("Request type", "نوع الطلب"), form.type && typeName(form.type)],
    [t("Status", "الحالة"), form.status && tr(form.status)],
    [t("Current step", "الخطوة الحالية"), form.step],
    [t("Requester", "مقدم الطلب"), form.by === "ext" ? t("External contact", "جهة خارجية") : form.by && aName(form.by)],
    [t("Channel", "القناة"), form.channel],
    [t("Level", "المستوى"), form.level === "top" ? t("Requests only", "الطلبات فقط") : form.level === "sub" ? t("Sub-requests only", "الطلبات الفرعية فقط") : ""],
    [t("Submitted", "التقديم"), form.from || form.to ? `${form.from || "…"} – ${form.to || "…"}` : ""],
    [t("Due", "الاستحقاق"), form.dueFrom || form.dueTo ? `${form.dueFrom || "…"} – ${form.dueTo || "…"}` : ""],
    [t("Overdue only", "المتأخرة فقط"), form.overdue ? t("Yes", "نعم") : ""],
  ];
  const day = (iso: string | null) => (iso ? formatDay(lang, new Date(iso)) : "—");
  return (
    <ReportFrame
      letterhead={letterhead}
      title={t("Requests report", "تقرير الطلبات")}
      subject={t(`${total} requests`, `${total} طلب`)}
      generatedAt={generatedAt}
      orientation="landscape"
      back={{ label: t("Back to the inquiry", "العودة إلى الاستعلام"), href: `${hrefOf("requestsReport")}?${queryOf(form)}` }}
    >
      <ReportSection title={t("Filters", "المرشحات")}>
        <ReportFilters filters={filters} none={t("None: every request you may see.", "لا شيء: كل الطلبات التي يمكنك رؤيتها.")} />
      </ReportSection>
      <ReportSection title={t("Requests", "الطلبات")}>
        <p className="awp-report-count" style={{ marginBottom: 8 }}>
          {total > rows.length ? t(`${total} requests match; the first ${rows.length} are listed.`, `يطابق ${total} طلباً؛ مُدرج أول ${rows.length}.`) : t(`${total} requests match.`, `يطابق ${total} طلباً.`)}
        </p>
        <ReportTable
          noWrap={[0, 3, 5, 7, 8, 9, 10]}
          widths={{ 1: "26%", 2: "15%", 4: "11%", 6: "10%" }}
          headings={[
            t("Key", "المفتاح"),
            t("Title", "العنوان"),
            t("Type", "النوع"),
            t("Project", "المشروع"),
            t("Requester", "مقدم الطلب"),
            t("Status", "الحالة"),
            t("Step", "الخطوة"),
            t("Channel", "القناة"),
            t("Submitted", "التقديم"),
            t("Due", "الاستحقاق"),
            t("Parent", "الأصل"),
          ]}
          rows={rows.map((row) => [
            row.key,
            t(row.titleEn, row.titleAr),
            t(row.typeEn, row.typeAr),
            row.projectKey,
            row.requester === "ext" ? t("External contact", "جهة خارجية") : aName(row.requester),
            tr(row.status),
            t(row.stepEn, row.stepAr) || "—",
            row.channel,
            day(row.submittedAt),
            day(row.dueAt),
            row.parentKey ?? "—",
          ])}
          empty={t("No request matches these filters.", "لا يوجد طلب يطابق هذه المرشحات.")}
        />
      </ReportSection>
    </ReportFrame>
  );
}
