"use client";

import { useState, useTransition } from "react";

import { simulateStoryline } from "@/features/engage/actions";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { useAwp } from "@/hooks/use-awp";

export type Simulation = Extract<Awaited<ReturnType<typeof simulateStoryline>>, { ok: true }>["value"];

/** `UC-64.1-08`: the designer plays the draft with test variables and a list of replies. */
export function Simulate({
  code,
  result,
  onResult,
  onClose,
}: {
  code: string;
  result: Simulation | null;
  onResult: (one: Simulation) => void;
  onClose: () => void;
}) {
  const { t } = useAwp();
  const [variables, setVariables] = useState("last4=4821");
  const [turns, setTurns] = useState("damaged\nVilla 12, Al Barsha\nyes");
  const [pending, act] = useTransition();

  return (
    <Modal
      w={640}
      title={t("Simulate", "محاكاة") + " · " + code}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
          <Btn
            label={t("Start simulation", "بدء المحاكاة")}
            disabled={pending}
            onClick={() =>
              act(async () => {
                const outcome = await simulateStoryline({
                  code,
                  variables: Object.fromEntries(
                    variables
                      .split("\n")
                      .map((line) => line.split("="))
                      .filter((pair) => pair.length === 2)
                      .map(([name, value]) => [name.trim(), value.trim()]),
                  ),
                  turns: turns.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
                });
                if (outcome.ok) onResult(outcome.value);
              })
            }
          />
        </>
      }
    >
      <Field label={t("Test variables", "متغيرات الاختبار")} hint="name=value">
        <textarea className="awp-input awp-mono" style={{ height: 60, padding: 10 }} value={variables} onChange={(event) => setVariables(event.target.value)} />
      </Field>
      <Field label={t("Visitor replies, one per line", "ردود الزائر، سطر لكل رد")} hint={t("Use fail to take a step's error path.", "استخدم fail لسلوك مسار الخطأ.")}>
        <textarea className="awp-input awp-mono" style={{ height: 80, padding: 10 }} value={turns} onChange={(event) => setTurns(event.target.value)} />
      </Field>
      {result && (
        <div className="awp-col" style={{ gap: 8 }} role="status">
          {result.lines.map((line, index) => (
            <div key={index} className="awp-small">
              <span className="awp-mono awp-muted" style={{ marginInlineEnd: 8 }}>{line.step ?? "—"}</span>
              <b>{line.from}</b>: {line.text}
            </div>
          ))}
          <div className="awp-small awp-muted awp-mono">
            {t("Variables", "المتغيرات")}: {JSON.stringify(result.slots)}
          </div>
          <div className="awp-small awp-muted">
            {t("Outcome", "النتيجة")}: {result.outcome ?? t("still running", "ما زالت جارية")}
          </div>
        </div>
      )}
    </Modal>
  );
}
