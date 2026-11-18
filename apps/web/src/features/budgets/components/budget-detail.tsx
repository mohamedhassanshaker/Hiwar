"use client";

import { useAgents } from "@/components/shared/directory";
import { DataTable, KpiRow } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { AgentAv, Who } from "@/components/ui/avatar";
import { Bar } from "@/components/ui/metrics";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import type { Budget, BudgetDetail } from "@/features/budgets/types";
import { useAwp } from "@/hooks/use-awp";
import { formatDay } from "@/i18n";
import { bLbl, bTone2, perAr } from "@/i18n/vocabulary";
import { type Go } from "@/lib/routes";
import { ACTION } from "./budget-form";

/** The colour a usage bar takes at a given percentage of the limit. */
export const pctCol = (p: number) => (p > 90 ? "var(--icon-danger)" : p > 75 ? "var(--icon-warning)" : "var(--action-primary-bg)");

/** A budget window's dates, reading "no end date" when it has none. */
export function Period({ b }: { b: Budget }) {
  const { t } = useAwp();
  return (
    <span className="awp-mono awp-small">
      {b.from} → {b.to || t("no end date", "بلا تاريخ انتهاء")}
    </span>
  );
}

/**
 * One agent's budget: limit, spend and forecast this period, the per-period spend and run
 * charts, the period history with the latest event each period raised, and the change log.
 * Renders nothing when the budget's agent is not in the directory.
 */
export function BudgetDetailView({
  b,
  detail,
  readOnly,
  back,
  onEdit,
  go,
}: {
  b: Budget;
  detail: BudgetDetail | undefined;
  readOnly: boolean;
  back: () => void;
  onEdit: () => void;
  go: Go;
}) {
  const { t, lang, nm, aName, aed } = useAwp();
  const agents = useAgents();
  const a = agents.find((x) => x.id === b.a);
  const periods = detail?.periods ?? [];
  const max = Math.max(1, ...periods.map((x) => Math.max(x.spent, x.limit)));
  const pct = b.lim === 0 ? 0 : (b.spent / b.lim) * 100;
  if (!a) return null;
  return (
    <div className="awp-page">
      <PageHead
        crumb={<Lnk onClick={back}>{t("Govern / Budgets & estimated costs", "الحوكمة / تكاليف تشغيل الذكاء الاصطناعي")}</Lnk>}
        title={<span className="awp-row" style={{ gap: 14 }}><AgentAv a={a} s={44} />{nm(a)}</span>}
        sub={<Period b={b} />}
      >
        <Tg tone={bTone2[b.status]} dot label={t(bLbl[b.status][0], bLbl[b.status][1])} />
        <Btn type="secondary" label={t("Open agent", "فتح الوكيل")} onClick={() => go("agents", { agent: a.id })} />
        {!readOnly && <Btn label={t("Edit budget", "تعديل الميزانية")} onClick={onEdit} />}
      </PageHead>
      <KpiRow
        items={[
          { label: t("Limit", "الحد"), value: aed(b.lim), note: t(b.per, perAr[b.per]) },
          {
            label: t("Estimated spend — this period", "الإنفاق التقديري — هذه الفترة"),
            value: aed(b.spent),
            tone: pct > 90 ? "danger" : pct > 75 ? "warning" : undefined,
            note: `${Math.round(pct)}%`,
          },
          { label: t("Estimated forecast", "التوقع التقديري"), value: aed(b.forecast), tone: b.forecast > b.lim ? "danger" : undefined },
          { label: t("At 100%", "عند 100٪"), value: t(...(ACTION[b.hard] ?? [b.hard, b.hard])) },
        ]}
      />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16 }} className="awp-two">
        <Card title={t("Consumption history (estimated)", "سجل الاستهلاك (تقديري)")}>
          {/* `UC-72.1-08`: a budget created a moment ago has nothing to draw. */}
          {periods.length === 0 && (
            <p className="awp-muted" style={{ margin: 0 }}>
              {t("No history yet.", "لا يوجد سجل بعد.")}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(4px,2vw,16px)", height: 200, paddingTop: 10 }}>
            {periods.map((x, i) => {
              const p = x.limit === 0 ? 0 : (x.spent / x.limit) * 100;
              return (
                <div key={x.startsAt} className="awp-col" style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end", position: "relative" }}>
                  <span className="awp-small" style={{ fontWeight: 500 }}>{Math.round(x.spent)}</span>
                  <div style={{ width: "100%", maxWidth: 44, height: (x.spent / max) * 150, borderRadius: "8px 8px 0 0", background: pctCol(p), opacity: i === periods.length - 1 ? 1 : 0.75 }} title={aed(x.spent)} />
                  <span className="awp-small awp-muted">{formatDay(lang, new Date(x.startsAt))}</span>
                </div>
              );
            })}
          </div>
          <div className="awp-row awp-small awp-muted" style={{ gap: 16, marginTop: 10 }}>
            <span className="awp-row" style={{ gap: 6 }}><span className="awp-dot" style={{ background: "var(--action-primary-bg)" }} />{t("Under 75%", "أقل من 75٪")}</span>
            <span className="awp-row" style={{ gap: 6 }}><span className="awp-dot" style={{ background: "var(--icon-warning)" }} />75–90%</span>
            <span className="awp-row" style={{ gap: 6 }}><span className="awp-dot" style={{ background: "var(--icon-danger)" }} />{t("Over 90%", "أكثر من 90٪")}</span>
          </div>
        </Card>
        <Card title={t("Runs by period", "العمليات حسب الفترة")}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 200 }}>
            {periods.map((x) => {
              const runMax = Math.max(1, ...periods.map((y) => y.runs));
              return (
                <div key={x.startsAt} className="awp-col" style={{ flex: 1, alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
                  <div style={{ width: "100%", height: (x.runs / runMax) * 160, borderRadius: 6, background: "var(--chart-series-1)" }} title={String(x.runs)} />
                  <span className="awp-small awp-muted">{formatDay(lang, new Date(x.startsAt))}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <Card title={t("Period history", "سجل الفترات")} pad={false}>
        <DataTable
          rows={periods.slice().reverse()}
          cols={[
            { h: t("Period", "الفترة"), r: (x) => formatDay(lang, new Date(x.startsAt)) },
            { h: t("Limit", "الحد"), end: true, r: (x) => aed(x.limit) },
            { h: t("Estimated spend", "الإنفاق التقديري"), end: true, r: (x) => aed(x.spent) },
            {
              h: t("Usage", "الاستخدام"),
              r: (x) => {
                const p = x.limit === 0 ? 0 : (x.spent / x.limit) * 100;
                return (
                  <div className="awp-row" style={{ minWidth: 160 }}>
                    <div style={{ flex: 1 }}><Bar h={6} parts={[{ v: Math.min(p, 100), c: pctCol(p) }]} /></div>
                    <span className="awp-small">{Math.round(p)}%</span>
                  </div>
                );
              },
            },
            { h: t("Runs", "العمليات"), end: true, r: (x) => x.runs },
            {
              h: t("Events", "الأحداث"),
              r: (x) =>
                x.event === "HardLimitReached" ? (
                  <Tg tone="danger" label={t("Hard limit reached", "بلغ الحد الصارم")} />
                ) : x.event === "WarningSent" ? (
                  <Tg tone="warning" label={t("Warning sent", "أُرسل تنبيه")} />
                ) : x.event === "ActionApplied" ? (
                  <Tg tone="info" label={t("Action applied", "طُبق الإجراء")} />
                ) : (
                  <span className="awp-muted">—</span>
                ),
            },
          ]}
        />
      </Card>
      <Card title={t("Budget changes", "تغييرات الميزانية")}>
        {(detail?.changes ?? []).map((change) => (
          <div key={change.at} className="awp-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)", gap: 10 }}>
            <span className="awp-mono awp-muted" style={{ width: 92 }}>{formatDay(lang, new Date(change.at))}</span>
            <Who id={change.by} s={22} />
            <span>
              <b>{aName(change.by)}</b> <span className="awp-muted">{t(change.descriptionEn, change.descriptionAr)}</span>
            </span>
          </div>
        ))}
        {!(detail?.changes ?? []).length && <p className="awp-muted awp-small" style={{ margin: 0 }}>{t("No changes recorded.", "لم تُسجَّل تغييرات.")}</p>}
      </Card>
    </div>
  );
}
