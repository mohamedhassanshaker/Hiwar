"use client";

import { ReportFacts, ReportFrame, ReportSection, ReportTable } from "@/components/shared/report-frame";
import { useTr } from "@/components/shared/status-tags";
import { useAwp } from "@/hooks/use-awp";
import { formatDay, formatTime, type Lang } from "@/i18n";
import { hrefOf } from "@/lib/routes";
import type { WorkItemReport } from "../service";
import type { Letterhead } from "@/types/letterhead";
import type { WorkItemReportFacts } from "../types";

/** A date and time in the reader's language, or "—". */
const when = (lang: Lang, iso: string | null | undefined) => (iso ? `${formatDay(lang, new Date(iso))}, ${formatTime(lang, new Date(iso))}` : "—");

/** The items below `parent`, each with the ones below it (D388: sub-items at every depth). */
function SubItems({ parent, items }: { parent: string; items: WorkItemReportFacts["subItems"] }) {
  const { t, lang, aName } = useAwp();
  const tr = useTr();
  const children = items.filter((item) => item.parentKey === parent);
  if (children.length === 0) return null;
  return (
    <ul className="awp-report-tree">
      {children.map((item) => (
        <li key={item.key}>
          <b className="awp-mono">{item.key}</b> · {t(item.titleEn, item.titleAr)} — {tr(item.status)} · {tr(item.priority)} ·{" "}
          {item.assignee ? aName(item.assignee) : t("Unassigned", "غير مُسند")}
          {item.dueAt ? ` · ${formatDay(lang, new Date(item.dueAt))}` : ""}
          <SubItems parent={item.key} items={items} />
        </li>
      ))}
    </ul>
  );
}

/** D388: one work item as a report, to read, print or save as PDF. */
export function WorkItemReportView({ report, letterhead }: { report: WorkItemReport; letterhead: Letterhead }) {
  const { t, lang, aName } = useAwp();
  const tr = useTr();
  const { item, detail: d, facts: f } = report;
  const who = (id: string) => (id ? aName(id) : "—");
  return (
    <ReportFrame
      letterhead={letterhead}
      title={t("Work item report", "تقرير بند العمل")}
      subject={`${item.k} · ${t(item.t, item.tAr)}`}
      generatedAt={report.generatedAt}
      back={{ label: t("Back to the work item", "العودة إلى بند العمل"), href: hrefOf("tasks", { open: item.k }) }}
    >
      <ReportSection title={t("Work item", "بند العمل")}>
        <ReportFacts
          facts={[
            [t("Key", "المفتاح"), item.k],
            [t("Project", "المشروع"), `${item.p} · ${t(f.projectEn, f.projectAr)}`],
            [t("Type", "النوع"), tr(item.type)],
            [t("Status", "الحالة"), tr(item.st)],
            [t("Priority", "الأولوية"), tr(item.pri)],
            [t("Assignee", "المُسند إليه"), item.who ? aName(item.who) : t("Unassigned", "غير مُسند")],
            [t("Reviewer", "المراجع"), who(f.reviewer)],
            [t("Due", "الاستحقاق"), when(lang, item.dueAt)],
            [t("Request", "الطلب"), f.requestKey ?? "—"],
            [t("Request type", "نوع الطلب"), d.sch],
            [t("Raised from", "مصدره"), d.org ? d.org[0] : t("Created by hand", "أُنشئ يدوياً")],
            [t("Parent item", "البند الأصل"), d.parent ?? "—"],
            [t("Created", "الإنشاء"), `${when(lang, f.createdAt)} · ${who(f.createdBy)}`],
            [t("Last changed", "آخر تعديل"), when(lang, f.updatedAt)],
            [t("Completed", "الإنجاز"), when(lang, f.completedAt)],
            ...(f.blockedEn ? ([[t("Blocked because", "سبب التعطّل"), t(f.blockedEn, f.blockedAr ?? f.blockedEn)]] as [string, string][]) : []),
          ]}
        />
      </ReportSection>
      <ReportSection title={t("Description", "الوصف")}>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t(d.desc ?? "", f.descriptionAr ?? d.desc ?? "") || "—"}</p>
      </ReportSection>
      <ReportSection title={t("Fields", "الحقول")}>
        <ReportTable headings={[t("Field", "الحقل"), t("Value", "القيمة")]} rows={d.at.map(([key, value]) => [key, value])} empty={t("No fields.", "لا توجد حقول.")} />
      </ReportSection>
      <ReportSection title={`${t("Sub-items", "البنود الفرعية")} · ${f.subItems.length}`}>
        {f.subItems.length ? <SubItems parent={item.k} items={f.subItems} /> : <p className="awp-report-empty">{t("No sub-items.", "لا توجد بنود فرعية.")}</p>}
      </ReportSection>
      <ReportSection title={t("History", "السجل")}>
        <ReportTable
          noWrap={[0]}
          widths={{ 0: "15%", 1: "22%" }}
          headings={[t("When", "متى"), t("Who", "من"), t("What", "ماذا")]}
          rows={f.history.map((entry) => [when(lang, entry.at), who(entry.who), t(entry.detailEn, entry.detailAr)])}
          empty={t("Nothing recorded yet.", "لم يُسجَّل شيء بعد.")}
        />
      </ReportSection>
      <ReportSection title={t("Attachments", "المرفقات")}>
        <ReportTable
          headings={[t("Name", "الاسم"), t("Size", "الحجم"), t("Kind", "النوع")]}
          rows={d.attachments.map(([name, size, kind]) => [name, size, kind === "artifact" ? t("Artifact", "مُخرج") : t("Attachment", "مرفق")])}
          empty={t("No attachments.", "لا توجد مرفقات.")}
        />
      </ReportSection>
      {d.comment && (
        <ReportSection title={t("Raised from a comment", "أُنشئ من تعليق")}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.comment.text}</p>
        </ReportSection>
      )}
      {report.audit && (
        <ReportSection title={t("Audit trail", "التدقيق")}>
          <ReportTable
            noWrap={[0, 2]}
            headings={[t("When", "متى"), t("Who", "من"), t("Action", "الإجراء"), t("Outcome", "النتيجة")]}
            rows={report.audit.map((entry) => [when(lang, entry.at), entry.actorLabel || who(entry.actor), entry.action, tr(entry.outcome)])}
            empty={t("No audit entries.", "لا توجد قيود تدقيق.")}
          />
        </ReportSection>
      )}
    </ReportFrame>
  );
}
