"use client";

import { useState, useTransition } from "react";

import { useAgents, useMay } from "@/components/shared/directory";
import { LiveRegion } from "@/components/shared/live-region";
import { cancelRun, deleteRun } from "@/features/agents/actions";
import { PageHead } from "@/components/shared/page-head";
import { Bar, Kpi } from "@/components/ui/metrics";
import type { RunStep } from "@/features/agents/types";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import type { RunDetail } from "@/features/agents/types";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";
import { LiveRunSteps } from "./live-run-steps";
import { RunTag } from "./run-tag";
import { ReplayModal } from "./replay-modal";

/** The icon each kind of run step carries in the timeline. */
const STEP_ICON: Record<string, string> = {
  Start: "TouchInteraction02",
  Model: "Notebook",
  Tool: "Invoice01",
  Skill: "File01",
  Verify: "TickCircle",
  Approval: "SecurityPassword",
  Question: "Chat",
  Handoff: "ArrowRight01Round",
};

/**
 * D300: what one step did, in full. A tool step carries `{arguments, result}` as JSON, shown as
 * the two blocks a person checks; any other step is its text.
 */
function StepBody({ step }: { step: RunStep }) {
  const { t } = useAwp();
  let call: { arguments?: unknown; result?: unknown } | null = null;
  if (step.k === "Tool") {
    try {
      call = JSON.parse(step.d) as { arguments?: unknown; result?: unknown };
    } catch {
      call = null;
    }
  }
  const block = (value: unknown) => (
    <pre className="awp-mono awp-small" style={{ margin: 0, padding: 10, borderRadius: 8, background: "var(--surface-sunken)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflow: "auto" }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
  if (!call) return <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{step.d || "—"}</div>;
  return (
    <div className="awp-col" style={{ gap: 8 }}>
      <b className="awp-small">{t("Arguments", "المدخلات")}</b>
      {block(call.arguments ?? {})}
      <b className="awp-small">{t("Result", "النتيجة")}</b>
      {block(call.result ?? "—")}
    </div>
  );
}

/** S-52 before any agent has run: the screen says so rather than answering 404. */
export function NoRuns() {
  const { t } = useAwp();
  const go = useGo();
  return (
    <div className="awp-page">
      <PageHead crumb={<Lnk onClick={() => go("agents")}>{t("Agents", "الوكلاء")}</Lnk>} title={t("Agent runs", "عمليات الوكلاء")} />
      <Card>
        <p className="awp-muted" style={{ margin: 0 }} role="status">
          {t("No agent has run yet.", "لم يعمل أي وكيل بعد.")}
        </p>
      </Card>
    </div>
  );
}

/**
 * S-52: one run, its status, figures and step timeline, kept live from the run's event stream.
 * Offers the Phoenix trace to holders of `logs:read`, and Replay, Cancel (a running or waiting
 * run) and Delete (a finished run) to holders of `agents:invoke`; the server decides who may
 * cancel or delete. Says how many tool calls the timeline cannot list (D300).
 */
export function RunViewer({ detail, phoenixOrigin }: { detail: RunDetail; phoenixOrigin: string }) {
  const { t, nm, why } = useAwp();
  const go = useGo();
  const agents = useAgents();
  const may = useMay();
  // D300: the steps open in place; the Tool calls figure narrows the timeline to the tool steps.
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [toolsOnly, setToolsOnly] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const a = agents.find((x) => x.id === detail.run.agent);
  const steps = toolsOnly ? detail.steps.filter((x) => x.k === "Tool") : detail.steps;
  // A run that finished before its steps were recorded (D300) counts calls it cannot show.
  const unrecorded = detail.toolCallCount - detail.steps.filter((x) => x.k === "Tool").length;
  const finished = !["Queued", "Running", "Waiting"].includes(detail.run.st);
  const tokens = detail.tokensIn + detail.tokensOut;
  const toggle = (seq: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  return (
    <div className="awp-page">
      {/* `UC-52.1-04`: "the timeline and KPIs update as steps complete" — the same live
          pattern the dashboard, a room and the inbox already use. */}
      <LiveRegion path={`/api/sse/runs/${detail.runId}`} />
      <PageHead
        crumb={
          <span className="awp-row" style={{ gap: 6 }}>
            <Lnk onClick={() => go("agents")}>{t("Agents", "الوكلاء")}</Lnk>/
            <Lnk onClick={() => go("agents", { agent: detail.run.agent })}>{a ? nm(a) : detail.run.agent}</Lnk>/
            <Lnk onClick={() => go("agents", { agent: detail.run.agent, tab: "runs" })}>{t("Agent run list", "قائمة عمليات الوكيل")}</Lnk>
          </span>
        }
        title={<span className="awp-mono" style={{ fontSize: 26, fontFamily: "inherit" }}>{detail.run.id}</span>}
        sub={`${t(detail.run.goal, detail.run.goalAr)} · ${a ? nm(a) : ""} ${a?.ver ?? ""}`}
      >
        <RunTag s={detail.run.st} waitingOn={detail.run.waitingOn} />
        {/* `UC-52.1-07`: the trace is the detailed record of the run, and `UC-52.1-08`
            hides it from someone who may not read the service logs either. */}
        {detail.traceId && may("logs:read") && (
          <Btn
            type="secondary"
            label={t("Open trace", "فتح التتبع")}
            onClick={() => window.open(`${phoenixOrigin}/projects/awp/traces/${detail.traceId}`, "_blank", "noopener")}
          />
        )}
        {may("agents:invoke") && (
          <Btn type="secondary" label={t("Replay", "إعادة التشغيل")} onClick={() => setReplaying(true)} />
        )}
        {/* `UC-52.1-11`: a finished run has nothing to cancel, so it is not offered. */}
        {(detail.run.st === "Running" || detail.run.st === "Waiting") && may("agents:invoke") && (
          <Btn
            type="danger"
            label={t("Cancel run", "إلغاء العملية")}
            disabled={busy}
            onClick={() => setCancelling(true)}
          />
        )}
        {/* D300: a finished run, with what is its own; who may is who may cancel it (D295). */}
        {finished && may("agents:invoke") && (
          <Btn type="danger" label={t("Delete run", "حذف العملية")} disabled={busy} onClick={() => setDeleting(true)} />
        )}
      </PageHead>
      {problem && (
        <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
          {problem}
        </p>
      )}
      {cancelling && (
        <Modal
          title={t("Cancel this run?", "إلغاء هذه العملية؟")}
          onClose={() => setCancelling(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Keep running", "متابعة")} onClick={() => setCancelling(false)} />
              <Btn
                type="danger"
                label={t("Cancel run", "إلغاء العملية")}
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setProblem(null);
                    const result = await cancelRun({ key: detail.run.id });
                    if (result.ok) setCancelling(false);
                    else setProblem(why(result));
                  })
                }
              />
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {t(
              "The run stops after its current step. Anything it has already done stays done.",
              "تتوقف العملية بعد خطوتها الحالية. ويبقى ما أنجزته كما هو.",
            )}
          </p>
        </Modal>
      )}
      {deleting && (
        <Modal
          title={t("Delete this run?", "حذف هذه العملية؟")}
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Btn type="secondary" label={t("Keep it", "إبقاؤها")} onClick={() => setDeleting(false)} />
              <Btn
                type="danger"
                label={t("Delete run", "حذف العملية")}
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setProblem(null);
                    const result = await deleteRun({ key: detail.run.id });
                    if (!result.ok) {
                      setProblem(why(result));
                      setDeleting(false);
                      return;
                    }
                    go("agents", { agent: detail.run.agent, tab: "runs" });
                  })
                }
              />
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {t(
              "The run is removed with its steps, approvals and questions. What it produced, such as messages and artifacts, stays. This cannot be undone.",
              "تُحذف العملية مع خطواتها وموافقاتها وأسئلتها. ويبقى ما أنتجته، كالرسائل والمخرجات. لا يمكن التراجع عن ذلك.",
            )}
          </p>
        </Modal>
      )}
      {replaying && (
        <ReplayModal
          runKey={detail.run.id}
          stepCount={detail.steps.length}
          onClose={() => setReplaying(false)}
          onReplayed={(key) => {
            setReplaying(false);
            go("run", { agent: detail.run.agent, id: key });
          }}
        />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: 16 }}>
        <Kpi
          label={t("Duration", "المدة")}
          value={detail.run.durationMs === null ? t("running", "جارية") : `${(detail.run.durationMs / 1000).toFixed(1)}s`}
          note={detail.waitingSeconds > 0 ? t(`+ ${Math.round(detail.waitingSeconds / 60)}m waiting`, `+ ${Math.round(detail.waitingSeconds / 60)}د انتظار`) : undefined}
        />
        <Kpi
          label={t("Tokens", "الرموز")}
          value={tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)}
          note={detail.cacheHitPct === null ? undefined : t(`${detail.cacheHitPct}% cache hit`, `${detail.cacheHitPct}٪ من الذاكرة المؤقتة`)}
        />
        <button
          type="button"
          aria-pressed={toolsOnly}
          title={toolsOnly ? t("Show every step", "عرض كل الخطوات") : t("Show only the tool calls", "عرض استدعاءات الأدوات فقط")}
          onClick={() => setToolsOnly(!toolsOnly)}
          style={{ all: "unset", cursor: "pointer", display: "grid", borderRadius: 16, outline: toolsOnly ? "2px solid var(--border-selected)" : undefined }}
        >
          <Kpi
            label={t("Tool calls", "استدعاءات الأدوات")}
            value={detail.toolCallCount}
            note={
              detail.approvalsWaiting > 0
                ? t(`${detail.approvalsWaiting} needs approval`, `${detail.approvalsWaiting} يحتاج اعتماد`)
                : toolsOnly
                  ? t("Showing only the tool calls", "تُعرض استدعاءات الأدوات فقط")
                  : t("Show their details", "عرض تفاصيلها")
            }
          />
        </button>
      </div>
      <Card title={toolsOnly ? t("Tool calls", "استدعاءات الأدوات") : t("Timeline", "المخطط الزمني")} pad={false}>
        {finished && unrecorded > 0 && (
          <p className="awp-small awp-muted" role="note" style={{ margin: 0, padding: "12px 20px", borderBottom: "1px solid var(--border-divider)" }}>
            {t(
              `${unrecorded} of this run's ${detail.toolCallCount} tool calls were not recorded step by step, so they are not listed here: the run finished before runs kept their timeline.`,
              `لم تُسجَّل ${unrecorded} من استدعاءات الأدوات الـ${detail.toolCallCount} لهذه العملية خطوة بخطوة، لذا لا تظهر هنا: انتهت العملية قبل أن تحفظ العمليات مخططها الزمني.`,
            )}
          </p>
        )}
        {steps.map((x) => {
          const shown = open.has(x.seq);
          return (
            <div key={x.seq} style={{ borderBottom: "1px solid var(--border-divider)" }}>
              <button
                type="button"
                aria-expanded={shown}
                onClick={() => toggle(x.seq)}
                style={{ width: "100%", border: 0, background: shown ? "var(--surface-brand-subtle)" : "transparent", padding: "12px 20px", display: "flex", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "start", color: "inherit", font: "inherit" }}
              >
                <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: x.status === "Waiting" ? "var(--feedback-warning-bg)" : "var(--surface-sunken)", flexShrink: 0 }}>
                  <Ic n={STEP_ICON[x.k] ?? "Notebook"} c={x.status === "Waiting" ? "var(--icon-warning)" : "var(--icon-secondary)"} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {x.t}
                    {x.status !== "Done" && <span className="awp-small awp-muted"> · {x.status}</span>}
                  </div>
                  {!shown && (
                    <div className="awp-small awp-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {x.d}
                    </div>
                  )}
                </div>
                <div className="awp-small awp-muted" style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                  {x.ms === null ? t("waiting", "انتظار") : `${(x.ms / 1000).toFixed(2)}s`}
                </div>
                <span style={{ display: "inline-flex", transform: shown ? "rotate(180deg)" : undefined }}><Ic n="ChevronDown" s={16} c="var(--icon-secondary)" /></span>
              </button>
              {shown && (
                <div style={{ padding: "4px 20px 16px 68px" }}>
                  <StepBody step={x} />
                  {x.hooks.length > 0 && (
                    <p className="awp-small awp-muted" style={{ margin: "8px 0 0" }}>
                      {t("Hooks", "الخطافات")}: {x.hooks.join(", ")}
                    </p>
                  )}
                  {x.status === "Waiting" && (
                    <div className="awp-row" style={{ marginTop: 12, gap: 10 }}>
                      <Btn label={t("Open in Inbox", "فتح في صندوق الوارد")} onClick={() => go("inbox")} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* The service records steps only when a run ends, so a running run's timeline comes from its live stream. */}
        {!steps.length && !finished && <LiveRunSteps runId={detail.runId} toolsOnly={toolsOnly} />}
        {!steps.length && finished && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
            {toolsOnly
              ? detail.toolCallCount > 0
                ? t("No tool call of this run was recorded step by step.", "لم يُسجَّل أي استدعاء أداة لهذه العملية خطوة بخطوة.")
                : t("This run called no tool.", "لم تستدعِ هذه العملية أي أداة.")
              : t("This run has no recorded steps.", "لا توجد خطوات مسجلة لهذه العملية.")}
          </p>
        )}
      </Card>
      {detail.context.length > 0 && (
        <Card title={t("Context composition", "تكوين السياق")}>
          <Bar h={14} parts={detail.context.map((c) => ({ v: c.share, c: c.colour }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 14 }}>
            {detail.context.map((c) => (
              <div key={c.en} className="awp-row" style={{ fontSize: 13 }}>
                <span className="awp-dot" style={{ background: c.colour }} />
                <span style={{ flex: 1 }}>{t(c.en, c.ar)}</span>
                <span className="awp-muted">{c.share}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
