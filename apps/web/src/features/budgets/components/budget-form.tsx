"use client";

import { useState, useTransition } from "react";

import { useAgents } from "@/components/shared/directory";
import { saveBudget } from "@/features/budgets/actions";
import { Btn, Toggle } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopDate, PopSelect } from "@/components/ui/pop-select";
import type { Budget } from "@/features/budgets/types";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { hardAr, perAr } from "@/i18n/vocabulary";

/** `gov.agent_budget.action_at_100` tokens, as the console writes them. */
export const ACTION: Record<string, [string, string]> = {
  NotifyOnly: ["Notify only", hardAr["Notify only"]],
  SwitchToCheaperAlias: ["Switch to cheaper alias", hardAr["Switch to cheaper alias"]],
  PauseAgent: ["Pause agent", hardAr["Pause agent"]],
};

/**
 * The modal that creates a budget window, or edits `b`, through `saveBudget`. The agent is
 * fixed on an edit, and a cheaper route is sent only for "Switch to cheaper alias". A refusal
 * is shown in the modal; a save toasts and calls `onDone`.
 */
export function BudgetForm({
  b,
  routes,
  onDone,
  onClose,
}: {
  b: Budget | null;
  routes: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, nm, aName, why } = useAwp();
  const agents = useAgents();
  const [x, setX] = useState<Budget>(
    b ?? {
      id: "",
      a: agents[0]?.id ?? "",
      lim: 100,
      per: "Monthly",
      from: new Date().toISOString().slice(0, 10),
      to: null,
      soft: 80,
      hard: "PauseAgent",
      spent: 0,
      status: "Active",
      forecast: 0,
      cheaperRoute: null,
      // A window that does not exist yet has no stored version; the save reads the real
      // one for an edit and inserts for a new one.
      v: 1,
    },
  );
  const [problem, setProblem] = useState<string | null>(null);
  const { say } = useToast();
  const [pending, start] = useTransition();
  const forever = x.to === null;

  const save = () =>
    start(async () => {
      setProblem(null);
      const result = await saveBudget({
        budgetId: x.id || undefined,
        agentCode: x.a,
        limitAed: x.lim,
        period: x.per,
        effectiveFrom: x.from,
        effectiveTo: x.to,
        warnAtPct: x.soft,
        actionAt100: x.hard,
        cheaperRouteAlias: x.hard === "SwitchToCheaperAlias" ? x.cheaperRoute : null,
      });
      if (result.ok) {
        say(t(`The budget for ${aName(x.a)} was saved.`, `حُفظت ميزانية ${aName(x.a)}.`));
        onDone();
      } else setProblem(why(result));
    });

  return (
    <Modal
      title={b ? `${t("Edit budget", "تعديل الميزانية")} · ${aName(b.a)}` : t("New agent budget", "ميزانية وكيل جديدة")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Save budget", "حفظ الميزانية")}
            disabled={pending || !x.from || x.lim <= 0}
            onClick={save}
          />
        </>
      }
    >
      {problem && (
        <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
          {problem}
        </p>
      )}
      <Field label={t("Agent", "الوكيل")}>
        <PopSelect className="awp-input" value={x.a} disabled={!!b} onChange={(e) => setX({ ...x, a: e.target.value })}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{nm(a)}</option>
          ))}
        </PopSelect>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Limit (AED, estimated)", "الحد (د.إ، تقديري)")}>
          <input className="awp-input" type="number" value={x.lim} onChange={(e) => setX({ ...x, lim: +e.target.value })} />
        </Field>
        <Field label={t("Period", "الفترة")}>
          <PopSelect className="awp-input" value={x.per} onChange={(e) => setX({ ...x, per: e.target.value })}>
            {["Daily", "Weekly", "Monthly", "Quarterly"].map((p) => (
              <option key={p} value={p}>{t(p, perAr[p])}</option>
            ))}
          </PopSelect>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Effective from", "ساري من")}>
          <PopDate className="awp-input" value={x.from} onChange={(e) => setX({ ...x, from: e.target.value })} />
        </Field>
        <Field label={t("Effective to", "ساري حتى")}>
          <PopDate className="awp-input" value={x.to || ""} disabled={forever} onChange={(e) => setX({ ...x, to: e.target.value })} />
        </Field>
      </div>
      <div className="awp-row" style={{ gap: 10 }}>
        <Toggle on={forever} onChange={(v) => setX({ ...x, to: v ? null : x.from })} />
        <span>{t("Keep forever (no end date)", "الاحتفاظ دائماً (بلا تاريخ انتهاء)")}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Warn at (%)", "تنبيه عند (٪)")}>
          <input className="awp-input" type="number" value={x.soft} onChange={(e) => setX({ ...x, soft: +e.target.value })} />
        </Field>
        <Field label={t("At 100%", "عند 100٪")}>
          <PopSelect className="awp-input" value={x.hard} onChange={(e) => setX({ ...x, hard: e.target.value })}>
            {Object.entries(ACTION).map(([value, [en, ar]]) => (
              <option key={value} value={value}>{t(en, ar)}</option>
            ))}
          </PopSelect>
        </Field>
      </div>
      {/* `UC-71.1-05`: falling to a cheaper alias needs an alias to fall to. */}
      {x.hard === "SwitchToCheaperAlias" && (
        <Field label={t("Switch to route", "التحويل إلى المسار")}>
          <PopSelect
            className="awp-input awp-mono"
            value={x.cheaperRoute ?? ""}
            aria-label={t("Switch to route", "التحويل إلى المسار")}
            onChange={(e) => setX({ ...x, cheaperRoute: e.target.value || null })}
          >
            <option value="">{t("Choose a route", "اختر مساراً")}</option>
            {routes.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </PopSelect>
        </Field>
      )}
    </Modal>
  );
}
