"use client";

import Link from "next/link";
import { useState } from "react";

import { Dialog } from "@/components/dialog";
import type { PlanLimits } from "@/db/schema";
import { salesAction } from "./actions";

type Plan = "starter" | "growth" | "business" | "enterprise";

const CARDS: Record<Plan, { name: string; tag: string; features: (string | [string, "planned"])[] }> = {
  starter: { name: "Starter", tag: "For a small business with one site", features: ["1 agent and 1 deployment", "2 seats", "300 AI conversations a month", "Knowledge base in Arabic and English", "Live inbox, takeover and handback", "Core analytics and audit log"] },
  growth: { name: "Growth", tag: "For a growing business with several sites", features: ["5 agents and 5 deployments", "10 seats", "2,000 AI conversations a month", "Custom HTTP tools with confirmation", ["Copilot mode: the AI drafts, you approve", "planned"], ["Webhooks and public API", "planned"]] },
  business: { name: "Business", tag: "For larger teams", features: ["20 agents and 20 deployments", "30 seats", "10,000 AI conversations a month", "Advanced analytics and quality review", "Priority support", ["Single sign-on", "planned"], ["Scheduled reports", "planned"]] },
  enterprise: { name: "Enterprise", tag: "For regulated or high-volume teams", features: ["Custom limits", ["Regional data hosting", "planned"], "SLA and security review", "Dedicated support", ["White label", "planned"]] },
};

const ROWS: [string, (p: Plan, l: PlanLimits) => string][] = [
  ["Agents", (p, l) => (p === "enterprise" ? "Custom" : String(l.agents))],
  ["Deployments (sites)", (p, l) => (p === "enterprise" ? "Custom" : String(l.deployments))],
  ["Seats", (p, l) => (p === "enterprise" ? "Custom" : String(l.seats))],
  ["AI conversations a month", (p, l) => (p === "enterprise" ? "Custom" : l.aiConversations.toLocaleString("en-US"))],
  ["Model access", (_, l) => (l.models.length === 3 ? "All models" : l.models.length === 2 ? "Fast and standard" : "Fast")],
  ["Takeover and handback", () => "Included"],
  ["Tools and guardrails", (_, l) => (l.httpTools ? "Plus HTTP tools" : "Built-in tools")],
  ["Analytics", (p) => (p === "business" || p === "enterprise" ? "Advanced" : "Core")],
  ["Audit log and exports", () => "Included"],
  ["Support", (p) => ({ starter: "Help centre", growth: "Email", business: "Priority", enterprise: "SLA" })[p]],
];

export function PricingClient({ trial, plans }: { trial: { days: number; conversations: number }; plans: { plan: Plan; monthly: string | null; yearly: string | null; overage: string | null; limits: PlanLimits }[] }) {
  const [yearly, setYearly] = useState(false);
  const [faq, setFaq] = useState(0);
  const [sales, setSales] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const rate = (p: Plan) => plans.find((x) => x.plan === p)?.overage ?? "";
  const FAQ: [string, string][] = [
    ["What counts as an AI conversation?", "A conversation in which the AI replied at least once. Replies from your team are free. Usage shows AI conversations, tokens by model, tool calls and storage, per agent and per deployment."],
    [
      "What happens when I reach a limit?",
      `You choose. By default the widget shows your fallback message and routes the chat to a person. Your team can always keep replying. You can also continue with overage up to a monthly cap you set: AED ${rate("starter")} (Starter), AED ${rate("growth")} (Growth) or AED ${rate("business")} (Business) per extra AI conversation.`,
    ],
    ["Is my data used to train models?", "No. Customer data is not used to train models, and model providers are set to no-retention where available."],
    ["Can I try it first?", `Yes. ${trial.days} days with Growth features and ${trial.conversations} AI conversations, no card needed.`],
    ["Do you support Arabic?", "Yes. The assistant detects the visitor language and replies in it, including Gulf, Egyptian and Levantine Arabic and mixed text. The widget supports right-to-left."],
  ];

  return (
    <div className="wrap">
      <section className="col gap-12" style={{ paddingTop: 56, alignItems: "center", textAlign: "center" }}>
        <h1 className="h-sec">Plans that grow with your conversations</h1>
        <p className="lead" style={{ maxWidth: 720 }}>
          Every plan includes agents, a knowledge base, deployments with the embeddable widget, the live inbox with takeover and handback, core analytics and an audit log. Limits and model access are what change.
        </p>
        <div className="row gap-8 sm">
          <span>Pay monthly</span>
          <button role="switch" aria-checked={yearly} aria-label="Pay yearly" className={yearly ? "switch on" : "switch"} onClick={() => setYearly(!yearly)} />
          <span>Pay yearly</span>
        </div>
        <p className="xs muted">
          Prices exclude 5% VAT. <span className="badge">Planned</span> features are on the roadmap, not in the first release.
        </p>
      </section>

      <section className="grid g4" style={{ marginTop: 32 }}>
        {plans.map(({ plan, monthly, yearly: perYear }) => {
          const c = CARDS[plan];
          const popular = plan === "growth";
          return (
            <div key={plan} className="card p-20 col gap-12" style={popular ? { borderColor: "#4338ca", boxShadow: "0 0 0 2px #4338ca" } : undefined}>
              <div className="row between">
                <b className="h3">{c.name}</b>
                {popular && <span className="badge">Most chosen</span>}
              </div>
              <span className="sm muted">{c.tag}</span>
              <div className="row gap-4" style={{ alignItems: "baseline" }}>
                <span className="num">{plan === "enterprise" ? "Custom" : `AED ${Number(yearly ? perYear : monthly).toLocaleString("en-US")}`}</span>
                <span className="sm muted">{plan === "enterprise" ? "yearly contract" : yearly ? "a year, billed once" : "a month"}</span>
              </div>
              {plan === "enterprise" ? (
                <button className="btn outline" onClick={() => setSales(true)}>Talk to us</button>
              ) : (
                <Link className={popular ? "btn" : "btn outline"} href="/sign-up">Start free</Link>
              )}
              <ul className="col gap-6" style={{ listStyle: "none", padding: 0 }}>
                {c.features.map((f) => {
                  const [text, planned] = Array.isArray(f) ? f : [f, null];
                  return (
                    <li key={text} className="row gap-6 sm nw" style={{ alignItems: "flex-start" }}>
                      <i className="i i-check s14 c-success" style={{ marginTop: 3 }} />
                      <span>
                        {text} {planned && <span className="badge">Planned</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="sec" aria-labelledby="cmp">
        <h2 className="h-sec" id="cmp">Compare plans</h2>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Included</th>
                {plans.map((p) => (
                  <th key={p.plan} scope="col">{CARDS[p.plan].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {plans.map((p) => (
                    <td key={p.plan}>{value(p.plan, p.limits)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec" aria-labelledby="pf">
        <h2 className="h-sec" id="pf">Questions</h2>
        <div className="col gap-8" style={{ marginTop: 16, maxWidth: 820 }}>
          {FAQ.map(([q, a], i) => (
            <div key={q} className="card">
              <button className="row between p-16 w-full" style={{ border: 0, background: "none", cursor: "pointer", textAlign: "start" }} aria-expanded={faq === i} onClick={() => setFaq(faq === i ? -1 : i)}>
                <b>{q}</b>
                <i className={`i ${faq === i ? "i-chev-u" : "i-chev-d"}`} />
              </button>
              {faq === i && <p className="p-16 sm" style={{ paddingTop: 0 }}>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <Dialog
        open={sales}
        title="Talk to us about Enterprise"
        onClose={() => setSales(false)}
        footer={
          sent ? (
            <button className="btn" onClick={() => setSales(false)}>Close</button>
          ) : (
            <>
              <button className="btn outline" onClick={() => setSales(false)}>Cancel</button>
              <button className="btn" disabled={!form.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) || !form.company} onClick={async () => {
                const r = await salesAction(form);
                if (r.ok) setSent(true);
              }}>
                Send
              </button>
            </>
          )
        }
      >
        {sent ? (
          <p role="status">Our team will email you within 1 working day to talk about limits, hosting and an SLA.</p>
        ) : (
          <>
            {(
              [
                ["name", "Name"],
                ["email", "Work email"],
                ["company", "Company"],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className="field">
                <label className="label" htmlFor={`s-${k}`}>{l}</label>
                <input id={`s-${k}`} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div className="field">
              <label className="label" htmlFor="s-msg">Message</label>
              <textarea id="s-msg" className="textarea" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
