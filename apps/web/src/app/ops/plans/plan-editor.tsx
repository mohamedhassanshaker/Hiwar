"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import type { PlanLimits } from "@/db/schema";
import { savePlanAction } from "../actions";

type Plan = "trial" | "starter" | "growth" | "business" | "enterprise";
interface Values {
  monthlyAed: number | null;
  yearlyAed: number | null;
  overageAed: number | null;
  trialDays: number | null;
  limits: PlanLimits;
}

export function PlanEditor({ readOnly, plan, label, version, initial }: { readOnly: boolean; plan: Plan; label: string; version: number; initial: Values }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState("");
  const [applyNow, setApplyNow] = useState(false);
  const [pending, start] = useTransition();
  const num = (value: string) => (value === "" ? null : Number(value));
  const limit = (k: keyof Omit<PlanLimits, "models" | "httpTools">) => (
    <div className="field" key={k}>
      <label className="label" htmlFor={`${plan}-${k}`}>{k}</label>
      <input id={`${plan}-${k}`} type="number" className="input" disabled={readOnly} value={v.limits[k]} onChange={(e) => setV({ ...v, limits: { ...v.limits, [k]: Number(e.target.value) } })} />
    </div>
  );
  return (
    <section className="card p-20 col gap-12">
      <div className="row between">
        <h2 className="h2">{label}</h2>
        <span className="mono muted">v{version}</span>
      </div>
      <div className="grid g4">
        {(
          [
            ["monthlyAed", "Monthly AED"],
            ["yearlyAed", "Yearly AED"],
            ["overageAed", "Overage AED per AI conversation"],
            ["trialDays", "Trial days"],
          ] as const
        ).map(([k, l]) => (
          <div className="field" key={k}>
            <label className="label" htmlFor={`${plan}-${k}`}>{l}</label>
            <input id={`${plan}-${k}`} type="number" step="0.01" className="input" disabled={readOnly} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: num(e.target.value) })} />
          </div>
        ))}
      </div>
      <div className="grid g5">{(["aiConversations", "agents", "deployments", "seats", "storageGb"] as const).map(limit)}</div>
      <div className="row gap-16 sm">
        {(["fast", "standard", "advanced"] as const).map((m) => (
          <label key={m} className="row gap-4">
            <input type="checkbox" disabled={readOnly} checked={v.limits.models.includes(m)} onChange={(e) => setV({ ...v, limits: { ...v.limits, models: e.target.checked ? [...v.limits.models, m] : v.limits.models.filter((x) => x !== m) } })} />
            {m} model
          </label>
        ))}
        <label className="row gap-4">
          <input type="checkbox" disabled={readOnly} checked={v.limits.httpTools} onChange={(e) => setV({ ...v, limits: { ...v.limits, httpTools: e.target.checked } })} /> HTTP tools
        </label>
      </div>
      {!readOnly && (
        <div className="row gap-8">
          <label className="sr-only" htmlFor={`${plan}-reason`}>Reason</label>
          <input id={`${plan}-reason`} className="input" placeholder="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="row gap-4 sm nw">
            <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} /> Apply a limit increase to existing customers now
          </label>
          <button
            className="btn"
            disabled={!reason || pending || JSON.stringify(v) === JSON.stringify(initial)}
            onClick={() =>
              start(async () => {
                const r = await savePlanAction(plan, { ...v, applyLimitIncreaseNow: applyNow, reason });
                toast(r.ok ? `${label} version ${version + 1} saved.` : (r.error ?? "Failed."));
                if (r.ok) router.refresh();
              })
            }
          >
            Save version
          </button>
        </div>
      )}
    </section>
  );
}
