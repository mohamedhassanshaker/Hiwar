"use client";

import { useState } from "react";

import { DataTable } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Chips } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { useAwp } from "@/hooks/use-awp";
import { formatDate, formatTime } from "@/i18n";
import { useGo } from "@/lib/routes";
import type { ServerPage } from "@/lib/paging";
import type { ConversationRow, ConversationStatus } from "@/features/engage/types";

/** The status of a conversation as a tag, in the console's language. */
export function StatusTag({ status }: { status: ConversationStatus }) {
  const { t } = useAwp();
  const shown: Record<ConversationStatus, [string, string, string]> = {
    Live: ["success", "Agent answering", "الوكيل يجيب"],
    AgentPaused: ["warning", "Taken over", "تولّاها موظف"],
    HandedOff: ["info", "Handed off", "حُوّلت"],
    Ended: ["neutral", "Ended", "انتهت"],
  };
  const [tone, en, ar] = shown[status];
  return <Tg tone={tone} label={t(en, ar)} />;
}

export type ConversationFilters = { period: string; from: string; to: string; deployment: string; status: string; text: string };

/**
 * D342: every visitor conversation, newest first, filtered on the server by period, deployment,
 * status and what was said. A row opens the conversation.
 */
export function Conversations({
  rows,
  page,
  deployments,
  filters,
}: {
  rows: ConversationRow[];
  page: ServerPage;
  deployments: { code: string; nameEn: string; nameAr: string }[];
  filters: ConversationFilters;
}) {
  const { t, lang } = useAwp();
  const filter = useFilterQuery();
  const go = useGo();
  const [text, setText] = useState(filters.text);
  const at = (value: string) => `${formatDate(lang, new Date(value))} ${formatTime(lang, new Date(value))}`;
  const filtered = filters.period !== "all" || filters.from || filters.to || filters.deployment || filters.status !== "all" || filters.text;

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
        title={t("Conversations", "المحادثات")}
        sub={t(
          "Every visitor conversation with an embedded deployment, newest first. Open one to follow it live, take it over from the agent, and hand it back.",
          "كل محادثة لزائر مع نشر مضمّن، الأحدث أولاً. افتح محادثة لمتابعتها مباشرة، وتولَّها بدلاً من الوكيل، ثم أعدها إليه.",
        )}
      />
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <Chips
          value={filters.period}
          onChange={(id) => filter.set("period", id)}
          items={[
            { id: "all", label: t("Any time", "أي وقت") },
            { id: "24h", label: t("Last 24 hours", "آخر ٢٤ ساعة") },
            { id: "7d", label: t("Last 7 days", "آخر ٧ أيام") },
            { id: "30d", label: t("Last 30 days", "آخر ٣٠ يوماً") },
          ]}
        />
        <Field label={t("From", "من")}>
          <input className="awp-input" type="date" value={filters.from} aria-label={t("Started on or after", "بدأت في أو بعد")} onChange={(event) => filter.set("from", event.target.value)} />
        </Field>
        <Field label={t("To", "إلى")}>
          <input className="awp-input" type="date" value={filters.to} aria-label={t("Started on or before", "بدأت في أو قبل")} onChange={(event) => filter.set("to", event.target.value)} />
        </Field>
        <Field label={t("Deployment", "النشر")}>
          <PopSelect className="awp-input" value={filters.deployment} onChange={(event) => filter.set("deployment", event.target.value)}>
            <option value="">{t("All deployments", "كل عمليات النشر")}</option>
            {deployments.map((deployment) => (
              <option key={deployment.code} value={deployment.code}>
                {t(deployment.nameEn, deployment.nameAr || deployment.nameEn)}
              </option>
            ))}
          </PopSelect>
        </Field>
        <Field label={t("Search", "بحث")}>
          <input
            className="awp-input"
            value={text}
            placeholder={t("What was said, or the visitor", "ما قيل، أو الزائر")}
            aria-label={t("Search conversations", "ابحث في المحادثات")}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") filter.set("q", text.trim());
            }}
            onBlur={() => filter.set("q", text.trim())}
          />
        </Field>
      </div>
      <Chips
        value={filters.status}
        onChange={(id) => filter.set("status", id)}
        items={[
          { id: "all", label: t("Every status", "كل الحالات") },
          { id: "Live", label: t("Agent answering", "الوكيل يجيب") },
          { id: "AgentPaused", label: t("Taken over", "تولّاها موظف") },
          { id: "HandedOff", label: t("Handed off", "حُوّلت") },
          { id: "Ended", label: t("Ended", "انتهت") },
        ]}
      />
      <Card pad={false}>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          onRow={(row) => go("conversation", { id: row.id })}
          server={{ ...page, onPage: (next) => filter.set("page", String(next)) }}
          cols={[
            { h: t("Started", "البداية"), r: (row) => <span className="awp-mono">{at(row.startedAt)}</span> },
            { h: t("Deployment", "النشر"), r: (row) => t(row.deploymentNameEn, row.deploymentNameAr || row.deploymentNameEn) },
            {
              h: t("Visitor wrote", "كتب الزائر"),
              r: (row) => <span className="awp-small">{row.firstText ? (row.firstText.length > 80 ? `${row.firstText.slice(0, 80)}…` : row.firstText) : "—"}</span>,
            },
            { h: t("Messages", "الرسائل"), r: (row) => row.messages },
            { h: t("Last activity", "آخر نشاط"), r: (row) => <span className="awp-mono awp-small">{row.lastAt ? at(row.lastAt) : "—"}</span> },
            {
              h: t("Status", "الحالة"),
              r: (row) => (
                <div className="awp-col" style={{ gap: 2 }}>
                  <StatusTag status={row.status} />
                  {row.pausedBy && <span className="awp-small awp-muted">{row.pausedBy}</span>}
                </div>
              ),
            },
            { h: t("Rating", "التقييم"), r: (row) => (row.rating ? `${row.rating} / 5` : "—") },
          ]}
        />
        {!rows.length && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
            {filtered ? (
              <>
                {t("No conversation matches these filters.", "لا توجد محادثة تطابق هذه المرشحات.")}{" "}
                <button className="awp-chip" onClick={filter.clear}>
                  {t("Clear", "مسح")}
                </button>
              </>
            ) : (
              t("No visitor has started a conversation yet.", "لم يبدأ أي زائر محادثة بعد.")
            )}
          </p>
        )}
      </Card>
    </div>
  );
}
