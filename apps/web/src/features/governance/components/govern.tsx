"use client";

import { useState, useTransition } from "react";

import { DataTable } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { downloadText } from "@/lib/download";
import { useGo, type ScreenId } from "@/lib/routes";
import { exportAudit } from "@/features/governance/actions";
import type { AuditRow, LogRow } from "@/features/governance/types";
import type { ServerPage } from "@/lib/paging";
import { useAwp } from "@/hooks/use-awp";
import { formatTime } from "@/i18n";

/**
 * `UC-73.1-06`: which screen holds an audited object, where one exists.
 *
 * A map rather than a guess from the label: the entry records a type, and only some types
 * are things a person can open. A type that is absent here is still named in the table —
 * the entry is about it either way — it simply is not a link.
 */
const AUDIT_OBJECT_SCREEN: Record<string, ScreenId | undefined> = {
  Person: "people",
  Role: "people",
  OrgUnit: "units",
  Agent: "agents",
  AgentVersion: "agents",
  Settings: "settings",
  FeatureFlag: "settings",
  BrandingAsset: "settings",
  SystemState: "system",
  Project: "projects",
  WorkItem: "tasks",
  Request: "requests",
  RequestType: "requests",
  ScheduledWorkItem: "routines",
  Artifact: "artifacts",
  ProjectFile: "files",
  Approval: "inbox",
  AgentQuestion: "inbox",
  Budget: "budgets",
  // A run opens from its agent, which is where the run viewer is reached from.
  Run: "agents",
};

/** S-73: the append-only record of what was changed, approved, published or refused. */
export function Audit({
  rows,
  page,
  actor,
  period,
  action,
}: {
  rows: AuditRow[];
  page: ServerPage;
  actor: string;
  period: string;
  action: string;
}) {
  const { t, lang } = useAwp();
  const filter = useFilterQuery();
  const go = useGo();
  const [draftAction, setDraftAction] = useState(action);
  const [exporting, startExport] = useTransition();

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("Govern", "الحوكمة")}
        title={t("Audit log", "سجل الإجراءات")}
        sub={t("Append-only record of configuration, permissions, approvals, publishes, secret access, exports and logins.", "سجل إلحاقي فقط للإعدادات والأذونات والاعتمادات والنشر والوصول للأسرار والتصدير وتسجيل الدخول.")}
      >
        <Btn
          type="secondary"
          label={exporting ? t("Exporting…", "جارٍ التصدير…") : t("Export", "تصدير")}
          icon="Download04"
          disabled={exporting}
          onClick={() =>
            startExport(async () => {
              // `UC-73.1-03`: the same filter the screen is showing, so the file matches
              // what was reviewed. The export is audited on the server.
              const csv = await exportAudit({ actor, period, action });
              downloadText(`audit-${period}.csv`, csv);
            })
          }
        />
      </PageHead>
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <Chips
          value={actor}
          onChange={(id) => filter.set("actor", id)}
          items={[{ id: "all", label: t("All actors", "كل الفاعلين") }, { id: "human", label: t("People", "الأشخاص") }, { id: "agent", label: t("Agents", "الوكلاء") }]}
        />
        <Chips
          value={period}
          onChange={(id) => filter.set("period", id)}
          items={[
            { id: "all", label: t("Any time", "أي وقت") },
            { id: "24h", label: t("Last 24 hours", "آخر ٢٤ ساعة") },
            { id: "7d", label: t("Last 7 days", "آخر ٧ أيام") },
            { id: "30d", label: t("Last 30 days", "آخر ٣٠ يوماً") },
            { id: "90d", label: t("Last 90 days", "آخر ٩٠ يوماً") },
          ]}
        />
        <Field label={t("Action", "الإجراء")}>
          <input
            className="awp-input"
            value={draftAction}
            placeholder={t("e.g. settings:", "مثال settings:")}
            aria-label={t("Filter by action", "تصفية حسب الإجراء")}
            onChange={(event) => setDraftAction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") filter.set("action", draftAction.trim());
            }}
            onBlur={() => filter.set("action", draftAction.trim())}
          />
        </Field>
      </div>
      <Card pad={false}>
        <DataTable
          rows={rows}
          server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
          cols={[
            { h: t("Time", "الوقت"), r: (r) => <span className="awp-mono">{formatTime(lang, new Date(r.at))}</span> },
            { h: t("Actor", "الفاعل"), r: (r) => (<div className="awp-row">{r.actor ? <Who id={r.actor} s={24} /> : null}{r.actorLabel}</div>) },
            { h: t("Action", "الإجراء"), r: (r) => <span className="awp-mono">{r.action}</span> },
            {
              h: t("Object", "الكائن"),
              // `UC-73.1-06`: the object's own screen, for the types that have one. A type
              // with no screen is still named, because the entry is about it either way.
              r: (r) => {
                const screen = AUDIT_OBJECT_SCREEN[r.objectType];
                const label = r.objectLabel ?? r.objectType;
                return screen ? (
                  <Lnk onClick={() => go(screen)}>
                    <span className="awp-mono awp-small">{label}</span>
                  </Lnk>
                ) : (
                  <span className="awp-mono awp-small">{label}</span>
                );
              },
            },
            { h: t("Outcome", "النتيجة"), r: (r) => <Tg tone={r.outcome === "Allowed" ? "success" : "danger"} label={t(r.outcome, r.outcome === "Allowed" ? "مسموح" : "مرفوض")} /> },
            { h: t("Detail", "التفاصيل"), r: (r) => <span className="awp-small awp-muted">{r.detail}</span> },
          ]}
        />
        {!rows.length && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
            {actor !== "all" || period !== "all" || action ? (
              <>
                {t("No audit entries match these filters.", "لا توجد سجلات تطابق هذه المرشحات.")}{" "}
                <button className="awp-chip" onClick={filter.clear}>{t("Clear", "مسح")}</button>
              </>
            ) : (
              t("Nothing has been audited yet.", "لم يُسجَّل شيء بعد.")
            )}
          </p>
        )}
      </Card>
    </div>
  );
}

/** S-74: the service log (SD-4 keeps it in PostgreSQL for installs this size). */
export function Logs({
  rows,
  page,
  services,
  level,
  service,
  runId,
}: {
  rows: LogRow[];
  page: ServerPage;
  services: string[];
  level: string;
  service: string;
  runId: string;
}) {
  const { t, lang } = useAwp();
  const filter = useFilterQuery();
  const [draftRun, setDraftRun] = useState(runId);
  const tone: Record<string, string> = { Info: "info", Warn: "warning", Error: "danger", Debug: "neutral" };
  const filtered = level !== "all" || service !== "all" || runId;

  return (
    <div className="awp-page">
      <PageHead crumb={t("Govern", "الحوكمة")} title={t("Logs", "السجلات")} sub={t("Application and run logs across services.", "سجلات التطبيق والعمليات عبر الخدمات.")} />
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <Chips
          value={level}
          onChange={(id) => filter.set("level", id)}
          items={[{ id: "all", label: t("All levels", "كل المستويات") }, ...["Error", "Warn", "Info", "Debug"].map((l) => ({ id: l, label: l.toUpperCase() }))]}
        />
        <Field label={t("Service", "الخدمة")}>
          <PopSelect className="awp-input" value={service} onChange={(event) => filter.set("service", event.target.value)} aria-label={t("Filter by service", "تصفية حسب الخدمة")}>
            <option value="all">{t("All services", "كل الخدمات")}</option>
            {services.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t("Run", "العملية")}>
          <input
            className="awp-input awp-mono"
            value={draftRun}
            placeholder={t("run id", "معرّف العملية")}
            aria-label={t("Filter by run", "تصفية حسب العملية")}
            onChange={(event) => setDraftRun(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") filter.set("run", draftRun.trim());
            }}
            onBlur={() => filter.set("run", draftRun.trim())}
          />
        </Field>
      </div>
      <Card pad={false}>
        <div style={{ direction: "ltr" }}>
          <DataTable
            rows={rows}
            server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
            cols={[
              { h: "Time", r: (r) => <span className="awp-mono">{formatTime(lang, new Date(r.at))}</span> },
              { h: "Level", r: (r) => <Tg tone={tone[r.level]} label={r.level.toUpperCase()} /> },
              { h: "Service", r: (r) => <span className="awp-mono">{r.service}</span> },
              {
                h: "Run",
                r: (r) =>
                  r.correlationId ? (
                    // `UC-74.1-03`: a run id is the way into that run's own lines.
                    <button className="awp-link awp-mono" onClick={() => { setDraftRun(r.correlationId ?? ""); filter.set("run", r.correlationId ?? ""); }}>
                      {r.correlationId}
                    </button>
                  ) : (
                    <span className="awp-mono">—</span>
                  ),
              },
              { h: "Message", r: (r) => <span className="awp-mono">{r.message}</span> },
            ]}
          />
        </div>
        {!rows.length && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
            {filtered ? (
              <>
                {t("No log lines match these filters.", "لا توجد أسطر سجل تطابق هذه المرشحات.")}{" "}
                <button className="awp-chip" onClick={() => { setDraftRun(""); filter.clear(); }}>{t("Clear", "مسح")}</button>
              </>
            ) : (
              t("No log lines yet.", "لا توجد أسطر سجل بعد.")
            )}
          </p>
        )}
      </Card>
    </div>
  );
}
