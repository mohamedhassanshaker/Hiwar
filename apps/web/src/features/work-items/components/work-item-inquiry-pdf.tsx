"use client";

import { ReportFilters, ReportFrame, ReportSection, ReportTable } from "@/components/shared/report-frame";
import { useTr } from "@/components/shared/status-tags";
import { useAwp } from "@/hooks/use-awp";
import { formatDay } from "@/i18n";
import { queryOf } from "@/lib/inquiry";
import { hrefOf } from "@/lib/routes";
import type { WorkItemInquiryForm } from "../inquiry";
import type { Letterhead } from "@/types/letterhead";
import type { WorkItemInquiryRow } from "../types";

/**
 * D388: a Work items report as a document — the filters it was run with, how many items match,
 * and the table of them (up to 2000), to print or save as PDF.
 */
export function WorkItemInquiryPdf({
  form,
  rows,
  total,
  generatedAt,
  letterhead,
}: {
  form: WorkItemInquiryForm;
  rows: WorkItemInquiryRow[];
  total: number;
  generatedAt: string;
  letterhead: Letterhead;
}) {
  const { t, lang, aName } = useAwp();
  const tr = useTr();
  const who = (id: string) => (id === "none" ? t("Unassigned", "غير مُسند") : id ? aName(id) : "");
  const range = (from: string, to: string) => (from || to ? `${from || "…"} – ${to || "…"}` : "");
  const filters: [string, string][] = [
    [t("Title or key", "العنوان أو المفتاح"), form.q],
    [t("Project", "المشروع"), form.project],
    [t("Type", "النوع"), form.type && tr(form.type)],
    [t("Status", "الحالة"), form.status && tr(form.status)],
    [t("Priority", "الأولوية"), form.priority && tr(form.priority)],
    [t("Assignee", "المُسند إليه"), who(form.assignee)],
    [t("Reviewer", "المراجع"), who(form.reviewer)],
    [t("Request key", "مفتاح الطلب"), form.request],
    [t("Level", "المستوى"), form.level === "top" ? t("Items only", "البنود فقط") : form.level === "sub" ? t("Sub-items only", "البنود الفرعية فقط") : ""],
    [t("Due", "الاستحقاق"), range(form.dueFrom, form.dueTo)],
    [t("Created", "الإنشاء"), range(form.from, form.to)],
    [t("Open only", "المفتوحة فقط"), form.open ? t("Yes", "نعم") : ""],
    [t("Overdue only", "المتأخرة فقط"), form.overdue ? t("Yes", "نعم") : ""],
  ];
  const day = (iso: string | null) => (iso ? formatDay(lang, new Date(iso)) : "—");
  return (
    <ReportFrame
      letterhead={letterhead}
      title={t("Work items report", "تقرير بنود العمل")}
      subject={t(`${total} work items`, `${total} بند عمل`)}
      generatedAt={generatedAt}
      orientation="landscape"
      back={{ label: t("Back to the inquiry", "العودة إلى الاستعلام"), href: `${hrefOf("workItemsReport")}?${queryOf(form)}` }}
    >
      <ReportSection title={t("Filters", "المرشحات")}>
        <ReportFilters filters={filters} none={t("None: every work item you see.", "لا شيء: كل بنود العمل التي تراها.")} />
      </ReportSection>
      <ReportSection title={t("Work items", "بنود العمل")}>
        <p className="awp-report-count" style={{ marginBottom: 8 }}>
          {total > rows.length ? t(`${total} work items match; the first ${rows.length} are listed.`, `يطابق ${total} بنداً؛ مُدرج أول ${rows.length}.`) : t(`${total} work items match.`, `يطابق ${total} بنداً.`)}
        </p>
        <ReportTable
          noWrap={[0, 2, 3, 4, 5, 8, 9, 10, 11]}
          widths={{ 1: "28%", 6: "11%", 7: "11%" }}
          headings={[
            t("Key", "المفتاح"),
            t("Title", "العنوان"),
            t("Project", "المشروع"),
            t("Type", "النوع"),
            t("Status", "الحالة"),
            t("Priority", "الأولوية"),
            t("Assignee", "المُسند إليه"),
            t("Reviewer", "المراجع"),
            t("Request", "الطلب"),
            t("Parent", "الأصل"),
            t("Due", "الاستحقاق"),
            t("Created", "الإنشاء"),
          ]}
          rows={rows.map((row) => [
            row.key,
            t(row.titleEn, row.titleAr),
            row.projectKey,
            tr(row.type),
            tr(row.status),
            tr(row.priority),
            row.assignee ? aName(row.assignee) : t("Unassigned", "غير مُسند"),
            row.reviewer ? aName(row.reviewer) : "—",
            row.requestKey ?? "—",
            row.parentKey ?? "—",
            day(row.dueAt),
            day(row.createdAt),
          ])}
          empty={t("No work item matches these filters.", "لا يوجد بند عمل يطابق هذه المرشحات.")}
        />
      </ReportSection>
    </ReportFrame>
  );
}
