"use client";

import { TurnParts } from "@/features/assistant/components/assistant-activity";
import { useRunParts } from "@/features/assistant/components/use-run-parts";
import { useAwp } from "@/hooks/use-awp";

/**
 * A running run's timeline, drawn from its live stream (UC-52.1-04). The agent service records the run's steps only
 * when the run finishes, so until then the timeline would be empty: this shows each step as it happens, with its
 * result once it returns, and the recorded timeline takes its place when the run ends and the page is re-read.
 * `toolsOnly` follows the timeline's own filter and keeps only the tool calls.
 */
export function LiveRunSteps({ runId, toolsOnly }: { runId: string; toolsOnly: boolean }) {
  const { t } = useAwp();
  const parts = useRunParts(runId);
  const shown = toolsOnly ? parts.filter((part) => part.kind === "steps") : parts;

  return (
    <div data-live-steps style={{ padding: "12px 20px 16px" }}>
      <p className="awp-small awp-muted" style={{ margin: "0 0 8px" }}>
        {t(
          "Live: each step as it happens. The full record, with timings, appears when the run finishes.",
          "مباشر: كل خطوة لحظة حدوثها. يظهر السجل الكامل مع الأزمنة عند انتهاء العملية.",
        )}
      </p>
      {shown.length > 0 && <TurnParts parts={shown} t={t} />}
      <span className="d3a-typing" role="status" aria-label={t("The run is working", "العملية قيد التنفيذ")}>
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
