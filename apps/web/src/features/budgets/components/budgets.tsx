"use client";

import { useState, useTransition } from "react";

import { useMay } from "@/components/shared/directory";
import { exportBudgets } from "@/features/budgets/actions";
import { downloadText } from "@/lib/download";
import { DataTable, FilterBar, KpiRow } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { Bar } from "@/components/ui/metrics";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import type { Budget, BudgetCounts, BudgetDetail } from "@/features/budgets/types";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { bLbl, bTone2, perAr } from "@/i18n/vocabulary";
import { useGo, useScreenParams } from "@/lib/routes";
import { BudgetForm } from "./budget-form";
import { pctCol, Period, BudgetDetailView } from "./budget-detail";

/** S-71 and S-72: the agent budgets and one budget's history, which the server reads for the window `?budget=` names (D349). */
export function Budgets({
  budgets,
  details,
  counts,
  routes,
}: {
  budgets: Budget[];
  details: Record<string, BudgetDetail>;
  counts: BudgetCounts;
  routes: string[];
}) {
  const { t, aName, aed } = useAwp();
  const go = useGo();
  const may = useMay();
  // `UC-71.1-09`: a Member may read the budgets and change none of them.
  const readOnly = !may("budgets:write");
  const filter = useFilterQuery();
  const selected = useScreenParams().budget ?? null;
  const setSelected = (id: string | null) => filter.set("budget", id ?? "");
  const [edit, setEdit] = useState<Budget | "new" | null>(null);
  const [f, setF] = useState("all");
  const [, startExport] = useTransition();

  const sel = selected ? (budgets.find((b) => b.id === selected) ?? null) : null;
  const list = budgets.filter((b) => f === "all" || b.status === f);

  /** `UC-71.1-08`: the file says in every column header that the money is an estimate. */
  const exportFile = () =>
    startExport(async () => {
      const { filename, csv } = await exportBudgets();
      downloadText(filename, csv);
    });
  return (
    <>
      {sel ? (
        <BudgetDetailView
          b={sel}
          detail={details[sel.id]}
          readOnly={readOnly}
          back={() => setSelected(null)}
          onEdit={() => setEdit(sel)}
          go={go}
        />
      ) : (
        <div className="awp-page">
          <PageHead
            crumb={t("Govern", "الحوكمة")}
            title={t("Budgets & estimated costs", "تكاليف تشغيل الذكاء الاصطناعي")}
            sub={t("Budgets apply to agents. All costs are estimates based on token usage and list prices.", "تُطبق الميزانيات على الوكلاء. جميع التكاليف تقديرية بناءً على استخدام الرموز وأسعار القائمة.")}
          >
            <Btn type="secondary" label={t("Export", "تصدير")} icon="Download04" onClick={exportFile} />
            {!readOnly && (
              <Btn label={t("New agent budget", "ميزانية وكيل جديدة")} icon="AddCircle" onClick={() => setEdit("new")} />
            )}
          </PageHead>
          <KpiRow
            items={[
              { label: t("Estimated month to date", "التقدير منذ بداية الشهر"), value: aed(counts.monthToDate) },
              { label: t("Agents with a budget", "وكلاء لديهم ميزانية"), value: `${counts.withBudget} / ${counts.agents}` },
              { label: t("Over 90%", "أكثر من 90٪"), value: counts.overNinety, tone: counts.overNinety ? "danger" : undefined },
              { label: t("Ending within 90 days", "تنتهي خلال 90 يوماً"), value: counts.endingSoon },
            ]}
          />
          <Card pad={false}>
            <FilterBar>
              <Chips value={f} onChange={setF} items={[{ id: "all", label: t("All", "الكل") }, { id: "Active", label: t("Active", "نشط") }, { id: "Planned", label: t("Scheduled", "مجدولة") }, { id: "Expired", label: t("Expired", "منتهية") }]} />
            </FilterBar>
            <DataTable
              onRow={(b) => setSelected(b.id)}
              rows={list}
              cols={[
                { h: t("Agent", "الوكيل"), r: (b) => (<button className="awp-row awp-lnk-t" style={{ gap: 8 }} onClick={(e) => { e.stopPropagation(); setSelected(b.id); }}><Who id={b.a} s={26} />{aName(b.a)}</button>) },
                { h: t("Effective", "السريان"), r: (b) => <Period b={b} /> },
                { h: t("Status", "الحالة"), r: (b) => <Tg tone={bTone2[b.status]} dot label={t(bLbl[b.status][0], bLbl[b.status][1])} /> },
                {
                  h: t("Usage this period", "الاستخدام هذه الفترة"),
                  r: (b) => {
                    const p = b.lim === 0 ? 0 : (b.spent / b.lim) * 100;
                    return b.status === "Active" ? (
                      <div className="awp-row" style={{ minWidth: 180 }}>
                        <div style={{ flex: 1 }}><Bar h={6} parts={[{ v: Math.min(p, 100), c: pctCol(p) }]} /></div>
                        <span className="awp-small">{Math.round(p)}%</span>
                      </div>
                    ) : (
                      <span className="awp-muted">—</span>
                    );
                  },
                },
                { h: t("Estimated spend", "الإنفاق التقديري"), end: true, r: (b) => aed(b.spent) },
                { h: t("Limit", "الحد"), end: true, r: (b) => `${aed(b.lim)} / ${t(b.per === "Monthly" ? "mo" : b.per.toLowerCase(), perAr[b.per])}` },
                { h: "", end: true, r: (b) => (<div className="awp-row" style={{ justifyContent: "flex-end", gap: 12 }} onClick={(e) => e.stopPropagation()}><Lnk onClick={() => setSelected(b.id)}>{t("History", "السجل")}</Lnk>{!readOnly && <Lnk onClick={() => setEdit(b)}>{t("Edit", "تعديل")}</Lnk>}</div>) },
              ]}
            />
          </Card>
        </div>
      )}
      {edit && (
        <BudgetForm
          b={edit === "new" ? null : edit}
          routes={routes}
          onDone={() => setEdit(null)}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
