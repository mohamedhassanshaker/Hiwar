"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import type { PlanLimits } from "@/db/schema";
import { cardAction, cardSetupAction, changePlanAction, limitsAction, talkToUsAction } from "./actions";

type Plan = "trial" | "starter" | "growth" | "business" | "enterprise";
const ORDER: Plan[] = ["trial", "starter", "growth", "business", "enterprise"];

/** Plan descriptions (BIL-001 FR-023); P2 items carry the Planned badge (D-018). */
const DESCRIPTION: Record<string, { text: string; planned?: string[] }> = {
  starter: { text: "1 agent, 1 deployment, 2 seats, 300 AI conversations" },
  growth: { text: "5 agents and deployments, 10 seats, HTTP tools", planned: ["Copilot mode", "Webhooks"] },
  business: { text: "Higher quotas, advanced analytics, priority support", planned: ["SSO"] },
  enterprise: { text: "Custom limits, SLA, security review", planned: ["Regional hosting"] },
};

interface Props {
  readOnly: boolean;
  plan: Plan;
  planLabel: string;
  status: string;
  trialDaysLeft: number | null;
  scheduled: { plan: string; at: string } | null;
  interval: "month" | "year";
  period: { start: string; end: string };
  meters: { key: string; name: string; used: number; limit: number; unit: string }[];
  overage: { count: number; amountAed: number; rateAed: number };
  limits: { limitBehaviour: "stop_route" | "offline" | "overage"; overageCapAed: number; alertFirst: number; alertSecond: number };
  plans: { plan: Plan; label: string; monthly: string | null; yearly: string | null; overage: string | null; limits: PlanLimits }[];
  invoices: { id: string; number: string; period: string; total: string; status: string }[];
  card: { brand: string; last4: string } | null;
  paymentFailed: boolean;
  providerHosted: boolean;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export function BillingClient(props: Props) {
  const router = useRouter();
  const [interval, setInterval] = useState(props.interval);
  const [limits, setLimits] = useState(props.limits);
  const [changing, setChanging] = useState<Props["plans"][number] | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ro = props.readOnly;
  const ai = props.meters.find((m) => m.key === "ai")!;
  const aiPct = Math.floor((ai.used / Math.max(1, ai.limit)) * 100);
  const trial = props.status === "trial" || props.status === "trial_ended";
  const limitsDirty = JSON.stringify(limits) !== JSON.stringify(props.limits);

  const run = <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, after?: (d?: T) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setProblem(r.error ?? "Something went wrong.");
      setProblem(null);
      after?.(r.data);
      router.refresh();
    });

  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Plan and usage</h1>
          <p className="lead">What you have used this month against your plan. Alerts tell you before you reach a limit.</p>
        </div>
        <div role="group" aria-label="Billing period" className="seg">
          <button type="button" aria-pressed={interval === "month"} className={interval === "month" ? "on" : ""} onClick={() => setInterval("month")}>Monthly</button>
          <button type="button" aria-pressed={interval === "year"} className={interval === "year" ? "on" : ""} onClick={() => setInterval("year")}>Yearly</button>
        </div>
      </div>
      {problem && (
        <p className="note-p c-danger" role="alert">
          {problem}
        </p>
      )}
      {props.status === "trial_ended" && (
        <div className="alert" role="alert">
          <b>Trial ended · choose a plan.</b> Your agents are offline until you choose a plan. Your data is kept for 90 days.
        </div>
      )}
      {props.paymentFailed && (
        <div className="alert" role="alert">
          A payment failed. Update the card to keep new chats running.
        </div>
      )}
      {aiPct >= limits.alertFirst && (
        <div className="alert row between" role="status">
          <div className="col gap-2">
            <b>You have used {aiPct}% of this month&apos;s AI conversations</b>
            <span className="sm">An alert goes to the Owner and Billing roles at {props.limits.alertFirst}% and {props.limits.alertSecond}%. Change this below.</span>
          </div>
          <a className="btn sm" href="#plans">See plans</a>
        </div>
      )}
      <div className="split">
        <div className="wide col gap-16">
          <section className="card p-20 col gap-12" aria-labelledby="usage-h">
            <div className="row between">
              <div className="col gap-2">
                <h2 className="h2" id="usage-h">Usage this period</h2>
                <span className="sm muted">
                  {day(props.period.start)} to {day(new Date(new Date(props.period.end).getTime() - 86_400_000).toISOString())}. Resets on {day(props.period.end)}.
                </span>
              </div>
              <span className="badge">{trial && props.trialDaysLeft !== null ? `Trial · ${props.trialDaysLeft} days left` : `${props.planLabel} plan`}</span>
            </div>
            {props.meters.map((m) => {
              const p = Math.min(100, Math.round((m.used / Math.max(1, m.limit)) * 100));
              const colour = p >= 100 ? "#c8261d" : p >= 80 ? "#f5a524" : "#4338ca";
              return (
                <div key={m.key} className="col gap-4">
                  <div className="row between sm">
                    <span>{m.name}</span>
                    <span className="tnum">
                      {m.used.toLocaleString("en-US")}
                      {m.unit} of {props.plan === "enterprise" ? "custom" : `${m.limit.toLocaleString("en-US")}${m.unit}`}
                    </span>
                  </div>
                  <div className="progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={m.name}>
                    <span style={{ display: "block", height: "100%", width: `${p}%`, background: colour }} />
                  </div>
                </div>
              );
            })}
            {props.overage.count > 0 && (
              <p className="sm">
                {props.overage.count} over · AED {props.overage.amountAed.toFixed(2)} at AED {props.overage.rateAed.toFixed(2)} each
              </p>
            )}
            <p className="note-p">
              Metering records cannot be edited and match your payment provider&apos;s usage. <a href="/analytics">See cost per conversation</a>
            </p>
          </section>

          <section className="card p-20 col gap-12" aria-labelledby="limit-h">
            <h2 className="h2" id="limit-h">When a limit is reached</h2>
            <div className="field">
              <label className="label" htmlFor="hl">Limit behavior</label>
              <select id="hl" className="select" disabled={ro} value={limits.limitBehaviour} onChange={(e) => setLimits({ ...limits, limitBehaviour: e.target.value as Props["limits"]["limitBehaviour"] })}>
                <option value="stop_route">Stop the AI, show the fallback message and route to a person</option>
                <option value="offline">Show offline message</option>
                <option value="overage" disabled={trial}>Continue and bill the overage up to a monthly cap{trial ? " (after the trial)" : ""}</option>
              </select>
              <span className="hint">People can always keep replying, even when the AI limit is used up.</span>
            </div>
            {limits.limitBehaviour === "overage" && (
              <div className="field">
                <label className="label" htmlFor="cap">Monthly overage cap (AED)</label>
                <input id="cap" type="number" min={0} className="input" disabled={ro} value={limits.overageCapAed} onChange={(e) => setLimits({ ...limits, overageCapAed: Math.max(0, Number(e.target.value)) })} />
                <span className="hint">
                  AED {props.plans.find((p) => p.plan === props.plan)?.overage ?? "0.80"} per AI conversation over the plan. At the cap, the AI stops and routes to a person.
                </span>
              </div>
            )}
            <div className="grid g2">
              <div className="field">
                <label className="label" htmlFor="a1">First alert at</label>
                <select id="a1" className="select" disabled={ro} value={limits.alertFirst} onChange={(e) => setLimits({ ...limits, alertFirst: Number(e.target.value) })}>
                  {[70, 80, 90].map((v) => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="a2">Second alert at</label>
                <select id="a2" className="select" disabled={ro} value={limits.alertSecond} onChange={(e) => setLimits({ ...limits, alertSecond: Number(e.target.value) })}>
                  {[95, 100].map((v) => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                </select>
              </div>
            </div>
            {!ro && (
              <button className="btn" style={{ alignSelf: "flex-end" }} disabled={!limitsDirty || pending} onClick={() => run(() => limitsAction(limits), () => toast("Limits and alerts saved."))}>
                Save
              </button>
            )}
          </section>

          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Period</th>
                  <th scope="col" className="r">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {props.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.number}</td>
                    <td>{i.period}</td>
                    <td className="r tnum">AED {i.total}</td>
                    <td>
                      <span className={i.status === "paid" ? "stt ok" : i.status === "failed" ? "stt bad" : "stt warn"}>{i.status === "paid" ? "Paid" : i.status === "failed" ? "Failed" : "Open"}</span>
                    </td>
                    <td className="r">
                      <a className="btn ghost sm" href={`/api/invoices/${i.id}`} onClick={() => toast(`Invoice ${i.number} is downloading.`)}>
                        <i className="i i-download" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
                {props.invoices.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No invoices yet. The first one is issued at the end of your first paid month.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="narrow">
          <section className="card p-20 col gap-12" id="plans" aria-labelledby="plans-h">
            <div className="col gap-2">
              <h2 className="h2" id="plans-h">Choose a plan</h2>
              <span className="sm muted">Prices exclude 5% VAT. Yearly billing costs 10 months.</span>
            </div>
            {props.scheduled && (
              <p className="note-p">
                Scheduled: {props.scheduled.plan} from {day(props.scheduled.at)}.
              </p>
            )}
            {props.plans.map((p) => {
              const current = p.plan === props.plan;
              const higher = ORDER.indexOf(p.plan) > ORDER.indexOf(props.plan);
              const price = p.plan === "enterprise" ? "Custom" : `AED ${Number(interval === "year" ? p.yearly : p.monthly).toLocaleString("en-US")}`;
              const d = DESCRIPTION[p.plan];
              return (
                <div key={p.plan} className="card p-12 col gap-6" style={current ? { background: "#eef0ff", borderColor: "#4338ca" } : undefined}>
                  <div className="row between">
                    <span className="b">{p.label}</span>
                    <span className="b">
                      {price}
                      {p.plan !== "enterprise" && <span className="xs muted"> {interval === "year" ? "a year" : "a month"}</span>}
                    </span>
                  </div>
                  <span className="xs muted">
                    {d.text}
                    {d.planned?.map((x) => (
                      <span key={x}>
                        , {x} <span className="badge">Planned</span>
                      </span>
                    ))}
                  </span>
                  {!ro && (
                    <button
                      className={current ? "btn secondary sm" : higher ? "btn sm" : "btn outline sm"}
                      disabled={current || pending}
                      onClick={() => (p.plan === "enterprise" ? run(() => talkToUsAction(), () => toast("Our team will contact you about limits, regional hosting and an SLA.")) : setChanging(p))}
                    >
                      {current ? "Current plan" : p.plan === "enterprise" ? "Talk to us" : higher || props.plan === "trial" ? "Upgrade" : "Switch"}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
          <section className="card p-20 col gap-12" aria-labelledby="pay-h">
            <h2 className="h2" id="pay-h">Payment</h2>
            {props.card ? (
              <div className="row gap-8">
                <span className="badge">{props.card.brand.toUpperCase()}</span>
                <span>
                  {props.card.brand} ending {props.card.last4}
                </span>
              </div>
            ) : (
              <span className="sm muted">No card yet. Add one to choose a plan.</span>
            )}
            <span className="xs muted">If a payment fails you get a grace period, then new chats pause. Your data stays.</span>
            {!ro && (
              <button
                className="btn outline sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  props.providerHosted
                    ? run(() => cardSetupAction(), (url) => {
                        if (url) window.location.href = url as string;
                      })
                    : setCardOpen(true)
                }
              >
                {props.card ? "Update card" : "Add card"}
              </button>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={changing !== null}
        title={`Change to ${changing?.label ?? ""}`}
        description={
          changing && (ORDER.indexOf(changing.plan) > ORDER.indexOf(props.plan) || props.plan === "trial")
            ? `Applies today: ${changing.label} at ${interval === "year" ? `AED ${changing.yearly} a year` : `AED ${changing.monthly} a month`}, excluding VAT. Limits and alerts update immediately.`
            : `Applies from the next billing period, on ${day(props.period.end)}. Until then you keep ${props.planLabel}.`
        }
        onClose={() => setChanging(null)}
        footer={
          <>
            <button className="btn outline" onClick={() => setChanging(null)}>Cancel</button>
            <button
              className="btn"
              disabled={pending}
              onClick={() =>
                changing &&
                run(() => changePlanAction(changing.plan as "starter" | "growth" | "business", interval), (r) => {
                  const res = r as { immediate: boolean } | undefined;
                  toast(res?.immediate ? `You are now on ${changing.label}. Limits and alerts update immediately.` : "Changes apply from the next billing period.");
                  setChanging(null);
                })
              }
            >
              Confirm
            </button>
          </>
        }
      >
        {problem && <p className="err">{problem}</p>}
      </Dialog>
      <CardDialog open={cardOpen} onClose={() => setCardOpen(false)} onSaved={(brand, last4) => run(() => cardAction(brand, last4), () => {
        setCardOpen(false);
        toast("Card details go to the payment provider. Hiwar never stores a full card number.");
      })} />
    </>
  );
}

/**
 * Stands in for the payment provider's hosted card form in development. Only the brand and
 * the last 4 digits leave this dialog; the full number is never sent to Hiwar.
 */
function CardDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (brand: string, last4: string) => void }) {
  const [number, setNumber] = useState("");
  const digits = number.replace(/\D/g, "");
  const brand = digits.startsWith("4") ? "Visa" : /^5[1-5]/.test(digits) ? "Mastercard" : digits.startsWith("3") ? "Amex" : "Card";
  return (
    <Dialog
      open={open}
      title="Payment card"
      description="Card details go to the payment provider. Hiwar never stores a full card number."
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={digits.length < 13} onClick={() => {
            onSaved(brand, digits.slice(-4));
            setNumber("");
          }}>
            Save card
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="cardno">Card number (payment provider form)</label>
        <input id="cardno" className="input" inputMode="numeric" autoComplete="cc-number" value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
    </Dialog>
  );
}
