"use client";

import { useState, useTransition } from "react";

import { replayRun } from "@/features/agents/actions";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-52.1-06`: replay a run, or replay it from one of its steps.
 *
 * Replaying the whole run repeats what happened. Starting part-way is a person deciding the
 * earlier steps were right, so that case asks for a reason — the trail should say why they
 * thought so, not only that someone did it.
 */
export function ReplayModal({
  runKey,
  stepCount,
  onClose,
  onReplayed,
}: {
  runKey: string;
  stepCount: number;
  onClose: () => void;
  onReplayed: (key: string) => void;
}) {
  const { t, why } = useAwp();
  const [fromStep, setFromStep] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const partial = fromStep !== "";

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await replayRun({
        key: runKey,
        fromStep: partial ? Number(fromStep) : null,
        reason: reason.trim() || undefined,
      });
      if (result.ok) onReplayed(result.key);
      else setProblem(why(result));
    });

  return (
    <Modal
      title={t("Replay this run", "إعادة تشغيل العملية")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Replay", "إعادة التشغيل")}
            disabled={pending || (partial && !reason.trim())}
            onClick={submit}
          />
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <p className="awp-small awp-muted" style={{ margin: 0 }}>
          {t(
            "A new run is started and linked to this one. This run is left exactly as it is.",
            "تبدأ عملية جديدة مرتبطة بهذه. وتبقى هذه العملية كما هي تماماً.",
          )}
        </p>
        <Field label={t("From step", "من الخطوة")}>
          <PopSelect className="awp-input" value={fromStep} onChange={(e) => setFromStep(e.target.value)}>
            <option value="">{t("The whole run", "العملية كاملة")}</option>
            {Array.from({ length: stepCount }, (_, index) => (
              <option key={index} value={index}>{t(`Step ${index + 1}`, `الخطوة ${index + 1}`)}</option>
            ))}
          </PopSelect>
        </Field>
        {partial && (
          <Field label={t("Reason", "السبب")} hint={t("Required when the earlier steps are kept.", "مطلوب عند الإبقاء على الخطوات السابقة.")}>
            <input className="awp-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
      </div>
    </Modal>
  );
}
