"use client";

import { useEffect, useState } from "react";

import { useProjOpts } from "@/components/shared/forms";
import { DataTable, FilterBar, Sel } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { exportRecords } from "@/features/home/actions";
import { COLUMN_INDEX as COLI } from "@/features/home/filter";
import type { RecordRow, RecordSet } from "@/features/home/types";
import { useAwp } from "@/hooks/use-awp";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { useAgo } from "@/hooks/use-client-now";
import { formatDay, relativeAge } from "@/i18n";
import { requestStatus, workItemStatus } from "@/i18n/vocabulary";
import type { ServerPage } from "@/lib/paging";
import { useGo, type Go } from "@/lib/routes";

/** Where a row of each drill-down opens (S-11). */
const NAV: Record<string, (row: RecordRow, go: Go) => void> = {
  open: (r, go) => go("tasks", { open: String(r[0]) }),
  runs: (r, go) => go("run", { agent: String(r[2]), id: String(r[0]) }),
  approvals: (r, go) => go("inbox", { sel: String(r[0]) }),
  agentsErr: (r, go) => go("agents", { agent: String(r[2]), tab: "runs" }),
  cost: (r, go) => go("agents", { agent: String(r[2]) }),
  sla: (r, go) => (String(r[0]).startsWith("REQ") ? go("requests", { open: String(r[0]) }) : go("tasks", { open: String(r[0]) })),
};

/** The drill-down's filters as the URL holds them: search text, a project key or `any`, a status or `any`. */
export type RecordFilters = { q: string; project: string; status: string };

/**
 * Renders one page of an S-11 drill-down list with search, project and status filters applied on
 * the server (D349), and an Export button when the person may export, which takes every row the
 * filters match. Clicking a title opens the record on its own screen (`NAV`).
 */
export function Records({ data, page, filters }: { data: RecordSet; page: ServerPage; filters: RecordFilters }) {
  const { t, lang, aed, aName } = useAwp();
  const { now } = useAgo();
  const go = useGo();
  const projOpts = useProjOpts();
  const filter = useFilterQuery();
  const [q, setQ] = useState(filters.q);
  const [exporting, setExporting] = useState(false);

  const H: Record<string, string> = {
    key: t("Key", "المفتاح"),
    title: t("Title", "العنوان"),
    project: t("Project", "المشروع"),
    status: t("Status", "الحالة"),
    who: t("Assignee", "المُسند إليه"),
    due: t("Due", "الاستحقاق"),
    agent: t("Agent", "الوكيل"),
    started: t("Started", "البدء"),
    risk: t("Risk", "المخاطر"),
    amount: t("Estimated cost", "التكلفة التقديرية"),
    left: t("Time left", "الوقت المتبقي"),
  };

  const nav = NAV[data.kind] ?? NAV.sla;
  const hasP = data.cols.includes("project");
  const statuses = data.cols.includes("status") ? data.statuses : [];
  const rows = data.rows;

  // `UC-11.1-07`: "Time left" is a countdown, so it has to be re-rendered while the list
  // stays open rather than frozen at the moment the page was read.
  const ticking = data.cols.includes("left");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick((count) => count + 1), 30_000);
    return () => clearInterval(timer);
  }, [ticking]);

  /** Exports the list, with the filters on screen, through the audited server action and saves it as CSV. */
  async function download() {
    setExporting(true);
    try {
      const csv = await exportRecords({ kind: data.kind, format: "csv", term: filters.q, project: filters.project, status: filters.status });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.kind}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const cell = (c: string, r: RecordRow) => {
    const v = r[COLI[c]];
    if (c === "key") return <span className="awp-mono">{v}</span>;
    if (c === "title") return (<button className="awp-lnk-t" onClick={(e) => { e.stopPropagation(); nav(r, go); }}>{v}</button>);
    if (c === "who" || c === "agent") return v ? (<div className="awp-row"><Who id={String(v)} s={22} />{aName(String(v))}</div>) : <span className="awp-muted">{t("Unassigned", "غير مُسند")}</span>;
    if (c === "project") return <span className="awp-mono">{v}</span>;
    if (c === "amount") return aed(Number(v));
    if (c === "due" || c === "started") return v ? formatDay(lang, new Date(String(v))) : "—";
    if (c === "status") {
      const label = workItemStatus[String(v)] ?? requestStatus[String(v)];
      return label ? t(label[0], label[1]) : v;
    }
    if (c === "left") return v ? <Tg tone="danger" dot label={now ? relativeAge(now, new Date(String(v))) : ""} /> : "—";
    if (c === "risk") return <Tg tone={v === "High" ? "danger" : v === "Low" ? "neutral" : "warning"} label={String(v)} />;
    return v;
  };

  return (
    <div className="awp-page">
      <PageHead crumb={<Lnk onClick={() => go("dashboard")}>{t("Dashboard", "لوحة المعلومات")}</Lnk>} title={t(data.title[0], data.title[1])} sub={t(data.sub[0], data.sub[1])}>
        {data.mayExport && (
          <Btn
            type="secondary"
            label={exporting ? t("Exporting…", "جارٍ التصدير…") : t("Export", "تصدير")}
            icon="Download04"
            disabled={exporting}
            onClick={() => void download()}
          />
        )}
      </PageHead>
      <Card pad={false}>
        <FilterBar>
          <input
            className="awp-input"
            style={{ maxWidth: 280 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") filter.set("q", q.trim());
            }}
            onBlur={() => filter.set("q", q.trim())}
            placeholder={t("Search by key or title", "ابحث بالمفتاح أو العنوان")}
          />
          {hasP && <Sel value={filters.project} onChange={(key) => filter.set("project", key === "any" ? "" : key)} w={240} opts={projOpts()} />}
          {statuses.length > 1 && (
            <Sel
              value={filters.status}
              onChange={(value) => filter.set("status", value === "any" ? "" : value)}
              w={200}
              opts={[["any", t("Any status", "أي حالة")], ...statuses.map((s) => [s, s] as [string, string])]}
            />
          )}
          <span style={{ flex: 1 }} />
          <span className="awp-small awp-muted">{page.total} {t("records", "سجلات")}</span>
        </FilterBar>
        <DataTable
          onRow={(r) => nav(r, go)}
          rows={rows}
          rowKey={(r) => `${r[0]}|${r[2]}`}
          server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
          cols={[...data.cols.map((c) => ({ h: H[c], r: (r: RecordRow) => cell(c, r), end: c === "amount" })), { h: "", end: true, r: (r: RecordRow) => <Lnk onClick={() => nav(r, go)}>{t("Open", "فتح")}</Lnk> }]}
        />
        {!rows.length && <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>{t("No records match.", "لا توجد سجلات مطابقة.")}</p>}
      </Card>
    </div>
  );
}
