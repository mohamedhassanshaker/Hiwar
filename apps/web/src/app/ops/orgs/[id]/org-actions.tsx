"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { LIMIT_LABEL } from "@/lib/plan-limits";
import { extendAction, reactivateAction, setPlanAction, suspendAction } from "../../actions";

type Plan = "trial" | "starter" | "growth" | "business" | "enterprise";

/** OPS-001 FR-003: every action needs a reason and is recorded. */
export function OrgActions({ orgId, status, plan }: { orgId: string; status: string; plan: Plan }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [nextPlan, setNextPlan] = useState<Plan>(plan);
  const [custom, setCustom] = useState({ aiConversations: 50000, agents: 50, deployments: 50, seats: 100, storageGb: 50 });
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? ok : (r.error ?? "Failed."));
      if (r.ok) {
        setReason("");
        router.refresh();
      }
    });
  return (
    <section className="card p-20 col gap-12">
      <h2 className="h2">Actions</h2>
      <div className="field">
        <label className="label" htmlFor="why">Reason (required)</label>
        <input id="why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="row gap-8">
        {(status === "trial" || status === "trial_ended") && (
          <>
            <label className="sr-only" htmlFor="days">Days</label>
            <input id="days" type="number" min={1} max={30} className="input" style={{ width: 90 }} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            <button className="btn outline sm" disabled={!reason || pending} onClick={() => run(() => extendAction(orgId, days, reason), `Trial extended by ${days} days.`)}>
              Extend trial
            </button>
          </>
        )}
        {status === "suspended" ? (
          <button className="btn outline sm" disabled={!reason || pending} onClick={() => run(() => reactivateAction(orgId, reason), "Reactivated.")}>Reactivate</button>
        ) : (
          <button className="btn destructive sm" disabled={!reason || pending} onClick={() => run(() => suspendAction(orgId, reason), "Suspended. The Owner was emailed.")}>Suspend</button>
        )}
      </div>
      <div className="row gap-8">
        <label className="sr-only" htmlFor="np">Plan</label>
        <select id="np" className="select" style={{ width: 180 }} value={nextPlan} onChange={(e) => setNextPlan(e.target.value as Plan)}>
          {["trial", "starter", "growth", "business", "enterprise"].map((p) => (
            <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <button className="btn outline sm" disabled={!reason || pending} onClick={() => run(() => setPlanAction(orgId, nextPlan, nextPlan === "enterprise" ? custom : null, reason), "Plan set.")}>
          Set plan
        </button>
      </div>
      {nextPlan === "enterprise" && (
        <div className="grid g5">
          {LIMIT_LABEL.map(([k, l]) => (
            <div key={k} className="field">
              <label className="label" htmlFor={`cl-${k}`}>{l}</label>
              <input id={`cl-${k}`} type="number" className="input" value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
