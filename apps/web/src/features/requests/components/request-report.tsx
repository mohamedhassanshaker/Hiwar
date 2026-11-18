"use client";

import { ReportFacts, ReportFrame, ReportSection, ReportTable } from "@/components/shared/report-frame";
import { useTr } from "@/components/shared/status-tags";
import { useAwp } from "@/hooks/use-awp";
import { formatDay, formatTime, type Lang } from "@/i18n";
import { hrefOf } from "@/lib/routes";
import type { RequestReport } from "../service";
import type { Letterhead } from "@/types/letterhead";
import type { RequestReportNode } from "../types";

/** A date and time in the reader's language, or "—". */
const when = (lang: Lang, iso: string | null | undefined) => (iso ? `${formatDay(lang, new Date(iso))}, ${formatTime(lang, new Date(iso))}` : "—");

/** The requests below `parent`, each with the ones below it (D388: sub-requests at every depth). */
function SubTree({ parent, nodes }: { parent: string; nodes: RequestReportNode[] }) {
  const { t, lang } = useAwp();
  const tr = useTr();
  const children = nodes.filter((node) => node.parentKey === parent);
  if (children.length === 0) return null;
  return (
    <ul className="awp-report-tree">
      {children.map((node) => (
        <li key={node.key}>
          <b className="awp-mono">{node.key}</b> · {t(node.titleEn, node.titleAr)} — {t(node.typeEn, node.typeAr)} · {tr(node.status)}
          {node.stepEn ? ` · ${t(node.stepEn, node.stepAr)}` : ""} · {when(lang, node.submittedAt)}
          <SubTree parent={node.key} nodes={nodes} />
        </li>
      ))}
    </ul>
  );
}

/** D388: one request as a report, to read, print or save as PDF. */
export function RequestReportView({ report, letterhead }: { report: RequestReport; letterhead: Letterhead }) {
  const { t, lang, aName } = useAwp();
  const tr = useTr();
  const { request: r, detail: d } = report;
  const step = d.steps[d.currentStep];
  const fieldLabel = (key: string) => {
    const field = d.fields.find((candidate) => candidate.key === key);
    return field ? t(field.labelEn, field.labelAr) : key;
  };
  return (
    <ReportFrame
      letterhead={letterhead}
      title={t("Request report", "تقرير الطلب")}
      subject={`${r.k} · ${t(r.t, r.tAr)}`}
      generatedAt={report.generatedAt}
      back={{ label: t("Back to the request", "العودة إلى الطلب"), href: hrefOf("requests", { open: r.k }) }}
    >
      <ReportSection title={t("Request", "الطلب")}>
        <ReportFacts
          facts={[
            [t("Key", "المفتاح"), r.k],
            [t("Request type", "نوع الطلب"), report.type ? t(report.type.n, report.type.nAr) : r.ty],
            [t("Project", "المشروع"), r.p],
            [t("Requester", "مقدم الطلب"), r.by === "ext" ? t("External contact", "جهة خارجية") : aName(r.by)],
            [t("Status", "الحالة"), tr(r.st)],
            [t("Current step", "الخطوة الحالية"), step ? t(step.n, step.nAr) : "—"],
            [t("Channel", "القناة"), `${r.ch} · ${r.mode === "agent" ? t("agentic", "تفاعلي") : t("form", "نموذج")}`],
            [t("Submitted", "التقديم"), when(lang, r.submittedAt)],
            [t("Due", "الاستحقاق"), d.dueAt ? `${when(lang, d.dueAt)}${d.slaAtRisk ? ` · ${t("at risk", "معرضة للخطر")}` : ""}` : "—"],
            [t("Parent request", "الطلب الأصل"), d.parent ?? "—"],
          ]}
        />
      </ReportSection>
      <ReportSection title={t("Description", "الوصف")}>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t(d.descEn || r.t, d.descAr || r.tAr)}</p>
      </ReportSection>
      <ReportSection title={t("Form", "النموذج")}>
        <ReportTable headings={[t("Field", "الحقل"), t("Value", "القيمة")]} rows={d.attributes.map(([key, value]) => [fieldLabel(key), value])} empty={t("No fields.", "لا توجد حقول.")} />
      </ReportSection>
      <ReportSection title={t("Steps", "الخطوات")}>
        <ReportTable
          headings={["#", t("Step", "الخطوة"), t("State", "الحالة")]}
          rows={d.steps.map((s, index) => [
            String(index + 1),
            t(s.n, s.nAr),
            index < d.currentStep ? t("Passed", "مُجتازة") : index === d.currentStep ? t("Current", "الحالية") : t("Ahead", "قادمة"),
          ])}
          empty={t("No steps.", "لا توجد خطوات.")}
        />
      </ReportSection>
      <ReportSection title={t("History", "السجل")}>
        <ReportTable
          noWrap={[0]}
          widths={{ 0: "15%", 1: "22%" }}
          headings={[t("When", "متى"), t("Who", "من"), t("What", "ماذا")]}
          rows={[...d.history].reverse().map((entry) => [when(lang, entry.at), aName(entry.who), t(entry.detailEn, entry.detailAr)])}
          empty={t("Nothing recorded yet.", "لم يُسجَّل شيء بعد.")}
        />
      </ReportSection>
      <ReportSection title={`${t("Sub-requests", "الطلبات الفرعية")} · ${report.tree.length}`}>
        {report.tree.length ? <SubTree parent={r.k} nodes={report.tree} /> : <p className="awp-report-empty">{t("No sub-requests.", "لا توجد طلبات فرعية.")}</p>}
      </ReportSection>
      <ReportSection title={`${t("Work items", "بنود العمل")} · ${report.workItems.length}`}>
        <ReportTable
          noWrap={[0, 1, 3, 6, 7]}
          widths={{ 2: "30%" }}
          headings={[t("Request", "الطلب"), t("Key", "المفتاح"), t("Title", "العنوان"), t("Parent item", "البند الأصل"), t("Assignee", "المُسند إليه"), t("Priority", "الأولوية"), t("Status", "الحالة"), t("Due", "الاستحقاق")]}
          rows={report.workItems.map((item) => [item.requestKey, item.key, t(item.titleEn, item.titleAr), item.parentKey ?? "—", item.assignee ? aName(item.assignee) : t("Unassigned", "غير مُسند"), tr(item.priority), tr(item.status), item.dueAt ? formatDay(lang, new Date(item.dueAt)) : "—"])}
          empty={t("No work items.", "لا توجد بنود عمل.")}
        />
      </ReportSection>
      <ReportSection title={t("Attachments", "المرفقات")}>
        <ReportTable headings={[t("Name", "الاسم"), t("Size", "الحجم")]} rows={d.attachments.map(([name, size]) => [name, size])} empty={t("No attachments.", "لا توجد مرفقات.")} />
      </ReportSection>
      {report.audit && (
        <ReportSection title={t("Audit trail", "التدقيق")}>
          <ReportTable
            noWrap={[0, 2]}
            headings={[t("When", "متى"), t("Who", "من"), t("Action", "الإجراء"), t("Outcome", "النتيجة")]}
            rows={report.audit.map((entry) => [when(lang, entry.at), entry.actorLabel || aName(entry.actor), entry.action, tr(entry.outcome)])}
            empty={t("No audit entries.", "لا توجد قيود تدقيق.")}
          />
        </ReportSection>
      )}
    </ReportFrame>
  );
}
