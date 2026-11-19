"use client";

import { useState, useTransition } from "react";

import { Grid, KpiRow } from "@/components/shared/layout";
import { PageHead } from "@/components/shared/page-head";
import { StTag } from "@/components/shared/status-tags";
import { Btn } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { orThrow } from "@/lib/outcome";
import { setAgentsPaused } from "@/features/governance/actions";
import type { SystemState } from "@/features/governance/types";
import { useAwp } from "@/hooks/use-awp";
import { formatTime } from "@/i18n";

/** S-78: how the platform is doing, and the switch that pauses every agent. */
export function SystemPage({ state }: { state: SystemState }) {
  const { t, lang } = useAwp();
  const [paused, setPaused] = useState(state.agentsPaused);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const toggle = (next: boolean) =>
    start(async () => {
      orThrow(await setAgentsPaused({ paused: next }));
      setPaused(next);
      setConfirming(false);
    });
  return (
    <div className="awp-page">
      <PageHead crumb={t("Govern", "الحوكمة")} title={t("System", "النظام")} sub={t("Versions and health of every platform service.", "إصدارات وحالة كل خدمات المنصة.")}>
        {paused ? (
          <Btn label={t("Resume all agents", "استئناف كل الوكلاء")} disabled={pending} onClick={() => toggle(false)} />
        ) : (
          <Btn
            type="danger"
            label={t("Pause all agents", "إيقاف كل الوكلاء")}
            disabled={pending}
            onClick={() => setConfirming(true)}
          />
        )}
      </PageHead>
      {confirming && (
        <Modal
          title={t("Pause all agents?", "إيقاف كل الوكلاء؟")}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={() => setConfirming(false)} />
              <Btn
                type="danger"
                label={t("Pause all agents", "إيقاف كل الوكلاء")}
                disabled={pending}
                onClick={() => toggle(true)}
              />
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {t(
              "Running workflows are drained; new runs are queued. Every agent reads Paused until you resume.",
              "تُستكمل العمليات الجارية وتُوضع العمليات الجديدة في الطابور. يظهر كل وكيل متوقفاً حتى الاستئناف.",
            )}
          </p>
        </Modal>
      )}
      {paused && (
        <div className="awp-card" style={{ padding: 14, background: "var(--feedback-warning-bg)", borderColor: "var(--feedback-warning-border)", color: "var(--feedback-warning-text)" }} role="status">
          {/* D182: pausing writes only the flag, so a run already going reads Running while it drains. */}
          {t(
            "All agents are paused. No new run starts. Runs already going are draining: they finish, and read Running until they do.",
            "جميع الوكلاء متوقفون. لا تبدأ أي عملية جديدة. العمليات الجارية قيد الاستكمال: تنتهي، وتظهر \"قيد التشغيل\" حتى تنتهي.",
          )}
        </div>
      )}
      <KpiRow
        items={[
          { label: t("Active runs", "العمليات النشطة"), value: state.activeRuns },
          { label: t("Queue depth", "عمق الطابور"), value: state.queueDepth },
          { label: t("Open conversations", "المحادثات المفتوحة"), value: state.openConversations },
          { label: t("Dependencies healthy", "التبعيات السليمة"), value: `${state.services.filter((service) => service.status === "Healthy").length} / ${state.services.length}` },
        ]}
      />
      <p className="awp-small awp-muted" style={{ margin: 0 }}>
        {t("Last checked", "آخر فحص")} <span className="awp-mono">{formatTime(lang, new Date(state.checkedAt))}</span>
      </p>
      <Grid min={220}>
        {state.services.map((service) => (
          <div key={service.name} className="awp-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="awp-row">
              <b style={{ flex: 1 }}>{service.name}</b>
              <StTag s={service.status} />
            </div>
            <span className="awp-small awp-muted awp-mono">{service.version ?? "—"}</span>
            {/* `UC-78.1-04`: an unhealthy service says why and when, not just that it is down. */}
            {service.status === "Error" && (
              <span className="awp-small" style={{ color: "var(--feedback-danger-text)" }} role="status">
                {service.detail ?? t("Did not answer.", "لم تستجب.")}
              </span>
            )}
          </div>
        ))}
      </Grid>
    </div>
  );
}
