"use client";

import { useAgents } from "@/components/shared/directory";
import { DataTable } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { PopSelect } from "@/components/ui/pop-select";
import { type Run } from "@/features/agents/types";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { formatDay, formatTime } from "@/i18n";
import type { ServerPage } from "@/lib/paging";
import { useGo } from "@/lib/routes";
import { RUN_PERIODS } from "../run-periods";
import { nextRunSort, type RunSort, type RunSortColumn } from "../run-sort";
import { RunTag } from "./run-tag";

/** The Runs screen's filters as the address holds them: an agent code or empty, a period in hours (0 is any time). */
export type RunListFilters = { agent: string; period: number };

/**
 * D383: every agent's runs, filtered on the server by agent and period, a page at a time, in the
 * order the address names (newest first by default). Pressing a column header sorts by it, and
 * pressing it again turns the order round. A row opens the run viewer.
 */
export function RunList({ rows, page, filters, sort }: { rows: Run[]; page: ServerPage; filters: RunListFilters; sort: RunSort }) {
  const { t, lang, nm, aed } = useAwp();
  const go = useGo();
  const filter = useFilterQuery();
  const agents = useAgents();
  const agentName = (code: string) => {
    const agent = agents.find((candidate) => candidate.id === code);
    return agent ? nm(agent) : code;
  };

  /** A column header that sorts the list by `column`, with an arrow on the column in use. */
  const header = (column: RunSortColumn, en: string, ar: string) => {
    const active = sort.column === column;
    const next = nextRunSort(sort, column);
    return (
      <button
        type="button"
        className="awp-lnk"
        aria-label={active ? t(`${en}, sorted ${sort.dir === "asc" ? "ascending" : "descending"}`, `${ar}، مرتّب ${sort.dir === "asc" ? "تصاعديًا" : "تنازليًا"}`) : t(en, ar)}
        onClick={() => filter.assign({ sort: next.column, dir: next.dir })}
      >
        {t(en, ar)}
        {active && <span aria-hidden="true">{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    );
  };

  return (
    <div className="awp-page">
      <PageHead
        title={t("Runs", "العمليات")}
        sub={t("Every agent's runs. Open one to see its timeline.", "عمليات كل الوكلاء. افتح إحداها لترى خطها الزمني.")}
      />
      <Card pad={false}>
        <div className="awp-row" style={{ padding: "10px 20px", flexWrap: "wrap", gap: 12, borderBottom: "1px solid var(--border-divider)" }}>
          <PopSelect
            className="awp-input"
            style={{ width: 240 }}
            value={filters.agent}
            onChange={(event) => filter.set("agent", event.target.value)}
            aria-label={t("Agent", "الوكيل")}
          >
            <option value="">{t("All agents", "كل الوكلاء")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {nm(agent)}
              </option>
            ))}
          </PopSelect>
          <PopSelect
            className="awp-input"
            style={{ width: 180 }}
            value={String(filters.period)}
            onChange={(event) => filter.set("period", event.target.value === "0" ? "" : event.target.value)}
            aria-label={t("Started", "البدء")}
          >
            {RUN_PERIODS.map(([hours, en, ar]) => (
              <option key={hours} value={String(hours)}>
                {t(en, ar)}
              </option>
            ))}
          </PopSelect>
          <span style={{ flex: 1 }} />
          <span className="awp-small awp-muted">{t(`${page.total} runs`, `${page.total} عملية`)}</span>
        </div>
        <DataTable
          onRow={(run) => go("run", { agent: run.agent, id: run.id })}
          rows={rows}
          rowKey={(run) => run.id}
          server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
          empty={t("No runs match these filters.", "لا توجد عمليات تطابق هذه المرشحات.")}
          cols={[
            {
              h: t("Run", "العملية"),
              r: (run) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{t(run.goal, run.goalAr)}</div>
                  <div className="awp-small awp-muted awp-mono">
                    {run.id} · {run.by}
                  </div>
                </div>
              ),
            },
            { h: header("agent", "Agent", "الوكيل"), r: (run) => agentName(run.agent) },
            { h: header("status", "Status", "الحالة"), r: (run) => <RunTag s={run.st} waitingOn={run.waitingOn} /> },
            {
              h: header("started", "Started", "البدء"),
              r: (run) => (
                <span className="awp-mono">
                  {formatDay(lang, new Date(run.at))} {formatTime(lang, new Date(run.at))}
                </span>
              ),
            },
            {
              h: header("duration", "Duration", "المدة"),
              end: true,
              r: (run) => (run.durationMs === null ? "—" : `${(run.durationMs / 1000).toFixed(1)}s`),
            },
            { h: header("cost", "Cost", "التكلفة"), end: true, r: (run) => aed(run.cost) },
          ]}
        />
      </Card>
    </div>
  );
}
