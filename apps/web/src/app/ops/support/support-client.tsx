"use client";

import { useState, type ReactNode } from "react";

import { FormDialog, SampleNote, Status, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

const ROLES: [string, string[]][] = [
  ["Platform admin", ["All", "With customer consent", "View", "View", "All", "All"]],
  ["Support operator", ["View", "With customer consent", "No", "No", "No", "No"]],
  ["Usage reviewer", ["No", "No", "No", "No", "All", "No"]],
  ["Finance", ["Billing", "No", "All", "No", "No", "No"]],
  ["Safety team", ["View", "Flagged extracts", "No", "All", "No", "No"]],
  ["AI operations", ["View", "No", "No", "No", "No", "All"]],
  ["Read-only analyst", ["Totals", "No", "Totals", "No", "Totals", "Totals"]],
];

function Queue({ title, lead, items }: { title: string; lead: string; items: [string, string, "ok" | "warn" | "bad" | "ai" | "mut", string][] }) {
  return (
    <aside className="card">
      <div className="card-h">
        <div className="t">
          <h3 className="card-t">{title}</h3>
          <p className="card-d">{lead}</p>
        </div>
      </div>
      <div className="card-c">
        {items.map(([n, d, tone, s]) => (
          <div key={n} className="row top gap-8">
            <Status tone={tone}>{s}</Status>
            <div className="col gap-0">
              <span className="sm b">{n}</span>
              <span className="xs muted">{d}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** O-Support functions without a backend (OPS-008). The real consented-access list is `access`. */
export function SupportClient({ access }: { access: ReactNode }) {
  const [tab, setTab] = useState<"tickets" | "access" | "disputes" | "ai" | "safety" | "abuse" | "roles">("tickets");
  const [jit, setJit] = useState<"none" | "pend" | "ok">("none");
  const [appeal, setAppeal] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [alerted, setAlerted] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [asFinance, setAsFinance] = useState(false);
  const dlg = useDialog<"note" | "keep" | "change" | "close" | "source" | "unblock">();

  return (
    <>
      <Tabs
        label="Support sections"
        value={tab}
        onChange={setTab}
        tabs={[
          ["tickets", "Tickets"],
          ["access", "Support access"],
          ["disputes", "Usage disputes"],
          ["ai", "AI problems"],
          ["safety", "Safety team"],
          ["abuse", "Abuse and review"],
          ["roles", "Internal roles"],
        ]}
      />
      {tab === "access" && access}
      {tab !== "access" && <SampleNote />}

      {tab === "tickets" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <span className="xs muted">#4821 · from Noura Al Suwaidi (Owner) · Gulf Bites Restaurants · Growth plan</span>
                <h2 className="card-t">Widget does not open on our Safari checkout page</h2>
              </div>
              <span className="badge warning">First response due in 2 h 40 m</span>
            </div>
            <div className="card-c">
              <p className="sm">Visitors on iOS Safari 18 see the launcher, but the panel stays closed on /checkout. Noura sees every update on this ticket in Help.</p>
              <div className="card soft">
                <div className="card-c">
                  <span className="b sm">Short-term access</span>
                  <span className="sm">Support reaches customer data only through time-limited, read-only access the Owner or an Admin grants. Every page viewed is in their audit log.</span>
                  <div className="row gap-8">
                    <select className="select" aria-label="Length"><option>2 hours</option><option>24 hours</option></select>
                    <select className="select" aria-label="Scope"><option>Deployments and settings · read only</option><option>Including conversations · read only</option></select>
                    <button className="btn outline sm" disabled={jit !== "none"} onClick={() => setJit("pend")}>Request access</button>
                  </div>
                  {jit === "pend" && (
                    <div className="row gap-8 sm">
                      <span className="badge warning">Waiting for Noura</span> She gets a request to approve in Team and security.
                      <button className="btn ghost sm" onClick={() => setJit("ok")}>Sample: Noura approves</button>
                    </div>
                  )}
                  {jit === "ok" && (
                    <span className="sm"><span className="badge success">Given until 13:22</span> Every page you open is logged and visible to Noura.</span>
                  )}
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="rp">Reply to Noura</label>
                <textarea id="rp" className="textarea" defaultValue="Thanks Noura. Safari blocks the panel when the page sets a strict frame policy; a fix is going out today." />
              </div>
            </div>
            <div className="card-f">
              <button className="btn outline" onClick={() => dlg.show("note")}>Internal note</button>
              <button className="btn" onClick={() => toast("Update sent to Noura.")}>Send update</button>
            </div>
          </section>
          <div className="col gap-16">
            <Queue
              title="Queue"
              lead="Sent from Help in the control panel"
              items={[
                ["P1 #4833 Desert Bank · write tool failing", "Due in 40 m", "bad", "P1"],
                ["P2 #4821 Gulf Bites · widget on Safari", "Due in 2 h 40 m", "warn", "P2"],
                ["P3 #4830 Marina Realty · overage invoice", "Due tomorrow", "mut", "P3"],
              ]}
            />
            <div className="card soft"><div className="card-c sm"><span className="b">Response targets</span>Set per plan in Plans and prices: from 1 working hour (Enterprise) to 2 working days (Starter).</div></div>
          </div>
        </div>
      )}

      {tab === "disputes" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <span className="xs muted">{appeal ? "UD-2207 · appeal · Gulf Bites Restaurants" : "UD-2207 · Gulf Bites Restaurants · October invoice, disputed 3 Nov"}</span>
                <h2 className="card-t">142 AI conversations counted during a bot attack</h2>
                <p className="card-d">{appeal ? "Appeal reason: “The first decision ignored that the visitors never typed a word; the widget opened automatically.”" : "Reason: “These conversations came from one IP range in 10 minutes and our team never saw a real question.”"}</p>
              </div>
              <span className={appeal ? "badge info" : "badge warning"}>{appeal ? "Final decision due 26 Nov" : "Due 19 Nov · 3 working days left"}</span>
            </div>
            <div className="card-c">
              <label className="row gap-4 sm"><input type="checkbox" checked={appeal} onChange={(e) => setAppeal(e.target.checked)} /> Show the appeal to a second reviewer</label>
              {appeal && <div className="alert info sm">Another reviewer decided this dispute on 14 Nov (credit refused). The Owner appealed once. You weren’t involved in the first decision, and your decision is final.</div>}
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Check</th><th scope="col">Metering</th><th scope="col">Evidence</th></tr></thead>
                  <tbody>
                    <tr><td>Visitor messages</td><td>142 conversations with at least one AI reply</td><td>138 had one message, “hi”</td></tr>
                    <tr><td>Source</td><td>Counted per deployment</td><td>One network range, 10 minutes</td></tr>
                    <tr><td>Abuse rule</td><td>Rate limit triggered after 60</td><td>82 counted before the limit</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="field">
                <label className="label" htmlFor="udc">Comment to the Owner (required)</label>
                <textarea id="udc" className="textarea" defaultValue={appeal ? "We checked again: 138 conversations came from automated traffic before our rate limit applied. We credit 138 AI conversations on the November invoice." : "Conversations count when the agent replies. 82 were counted before the rate limit applied, so they stay counted."} />
              </div>
            </div>
            <div className="card-f">
              <span className="sm muted grow">Every decision lists the metering record per conversation.</span>
              <button className="btn outline" onClick={() => dlg.show("keep")}>Keep the count</button>
              <button className="btn" onClick={() => dlg.show("change")}>Credit conversations</button>
            </div>
          </section>
          <div className="col gap-16">
            <Queue
              title="Dispute queue"
              lead="Owners dispute counted AI conversations · 5 working days"
              items={[
                ["UD-2207 Gulf Bites · bot attack", appeal ? "Appeal · second reviewer" : "Due 19 Nov", appeal ? "ai" : "warn", appeal ? "Appeal" : "Open"],
                ["UD-2211 Oasis Clinics · test conversations", "Due 21 Nov", "mut", "Open"],
                ["UD-2190 Najd Logistics · duplicate widget", "Decided 13 Nov · 40 credited", "ok", "Done"],
                ["UD-2185 Riyadh Motors · handover counted", "Appeal decided 12 Nov · final", "ok", "Done"],
              ]}
            />
            <div className="card soft"><div className="card-c sm"><span className="b">How disputes work</span>Raised within 30 days of the invoice, with a reason. A Usage reviewer decides within 5 working days. The Owner can appeal once, to a second reviewer, whose decision is final.</div></div>
          </div>
        </div>
      )}

      {tab === "ai" && (
        <section className="card">
          <div className="card-h">
            <div className="t">
              <span className="xs muted">Problem AI-0192 · 7 reports from 3 organizations</span>
              <h2 className="card-t">Agents built from “E-commerce order status” v3.2 quote the old 14-day returns window</h2>
            </div>
            <Status tone={hidden ? "mut" : "bad"}>{hidden ? "Template paused platform-wide" : "Open"}</Status>
          </div>
          <div className="card-c">
            <div className="grid g4 sm">
              <div className="col gap-0"><span className="xs muted">Prompt version</span><span className="mono">agent-v31</span></div>
              <div className="col gap-0"><span className="xs muted">Model route</span><span>Standard · Arabic first</span></div>
              <div className="col gap-0"><span className="xs muted">Source</span><span className="mono">templates/ecommerce v3.2</span></div>
              <div className="col gap-0"><span className="xs muted">First report</span><span>4 Nov 09:12</span></div>
            </div>
            <div className="col gap-8 sm">
              <div>“The agent told a customer returns close after 14 days; our policy is 30.” · Najd Logistics</div>
              <div>“Thumbs down on answer: wrong return window” · visitor feedback, Marina Realty</div>
            </div>
          </div>
          <div className="card-f">
            <button className="btn destructive" disabled={hidden} onClick={() => { setHidden(true); toast("Template paused. New agents can’t copy it until a fixed version is published."); }}>Pause template platform-wide</button>
          </div>
        </section>
      )}

      {tab === "safety" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <span className="xs muted">Safety team · 24/7 · flagged by the safety filter</span>
                <h2 className="card-t">Visitor message suggests a person may be at risk</h2>
                <p className="card-d">Oasis Clinics · widget on oasisclinics.ae · 15 Nov 02:14</p>
              </div>
              <Status tone={alerted ? "warn" : "bad"}>{alerted ? "Owner alerted" : "Urgent"}</Status>
            </div>
            <div className="card-c">
              <div className="card soft"><div className="card-c sm"><span className="xs muted">Message extract · only what the filter flagged and the 2 messages around it</span>“I took more of my pills than the doctor said. Can someone call me?”</div></div>
              <p className="sm muted">Flagged content isn’t shown to anyone else at Hiwar. If someone may be at risk, alert the organization’s Owner; they get only what they need to act.</p>
              <div className="alert danger sm"><span className="b">Risk of immediate danger?</span> Follow the market’s emergency steps: UAE 999 and the organization’s on-call contact.</div>
              <div className="field">
                <label className="label" htmlFor="sfn">Actions taken (logged)</label>
                <textarea id="sfn" className="textarea" defaultValue="Read the extract. The agent handed over and showed the emergency number. Risk looks possible, not immediate." />
              </div>
            </div>
            <div className="card-f">
              <span className="sm muted grow">Every view is logged.</span>
              <button className="btn outline" onClick={() => dlg.show("close")}>Close: no risk</button>
              <button className="btn" disabled={alerted} onClick={() => { setAlerted(true); toast("Oasis Clinics Owner alerted by email and phone. The message itself isn’t shared."); }}>Alert the Owner</button>
            </div>
          </section>
          <Queue
            title="Safety queue"
            lead="Every organization · flagged visitor messages and concerns reported by staff"
            items={[
              ["Oasis Clinics · widget conversation", "Flagged 02:14 · safety filter", alerted ? "warn" : "bad", alerted ? "Alerted" : "Urgent"],
              ["Gulf Bites · concern reported by Omar (Support)", "Reported 14 Nov · with 3 linked messages", "warn", "Open"],
              ["Marina Realty · widget conversation", "Flagged 13 Nov · threat towards staff", "mut", "Reviewed"],
              ["Riyadh Motors · widget conversation", "Closed 12 Nov · no risk found", "ok", "Closed"],
            ]}
          />
        </div>
      )}

      {tab === "abuse" && (
        <div className="col gap-16">
          <section className="card">
            <div className="card-h"><h2 className="card-t">Abuse detection</h2><span className="badge danger">1 active</span></div>
            <div className="card-c">
              <div className="row top gap-8">
                <i className="i i-ban" aria-hidden />
                <div className="col gap-4 grow">
                  <span className="b">Bot conversations blocked</span>
                  <span className="sm">412 widget conversations in 6 minutes from one network range on gulfbites.ae. Rate limit triggered; conversations from this source are blocked and not counted.</span>
                  <div className="row gap-8">
                    <button className="btn outline sm" onClick={() => dlg.show("source")}>View source</button>
                    <button className="btn ghost sm" onClick={() => dlg.show("unblock")}>Unblock</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2 className="card-t">Account locks</h2></div>
            <div className="card-c">
              <div className="row between">
                <div className="col gap-0"><span className="b">m.saleh@example.com</span><span className="sm muted">23 failed sign-ins from 4 countries · owner told by email · unlocks by resetting the password</span></div>
                <Status tone="bad">Locked</Status>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-h"><div className="t"><h2 className="card-t">Review queue</h2><p className="card-d">Visitor messages flagged in several organizations</p></div></div>
            <div className="card-c">
              <div className="sm">“Earn AED 5,000 a week from home, message me on…” · flagged in 5 organizations</div>
              <div className="row gap-8">
                <button className="btn outline sm" disabled={removed} onClick={() => setRemoved(true)}>Block and add to shared filter</button>
                <button className="btn ghost sm" onClick={() => toast("Message allowed in all 5 organizations.")}>Allow</button>
              </div>
              {removed && <span className="sm">Blocked in 5 organizations; wording added to the shared filter.</span>}
            </div>
          </section>
        </div>
      )}

      {tab === "roles" && (
        <>
          <label className="row gap-4 sm"><input type="checkbox" checked={asFinance} onChange={(e) => setAsFinance(e.target.checked)} /> Sample: Tariq (Finance) tries to open Gulf Bites conversations</label>
          {asFinance && (
            <div className="alert danger" role="alert">
              <span className="b">Access refused</span> The Finance role sees subscriptions, payments and the ledger only. Customer data is reached only through short-term access the customer grants.
            </div>
          )}
          <section className="card">
            <div className="card-h"><div className="t"><h2 className="card-t">Internal roles</h2><p className="card-d">Lowest access needed · 2-step sign-in for everyone · every action is logged</p></div></div>
            <div className="card-c table-wrap">
              <table className="table">
                <thead>
                  <tr>{["Role", "Organizations", "Customer data", "Payments", "Safety flags", "Usage disputes", "AI capabilities"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {ROLES.map(([n, c]) => (
                    <tr key={n}>
                      <td className="b">{n}</td>
                      {c.map((t, i) => <td key={i} className={t === "No" ? "muted sm" : t === "All" ? "b sm" : "sm"}>{t}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <FormDialog open={dlg.is("note")} title="Internal note" description="Only Hiwar staff can see this" confirm="Save note" onClose={dlg.close} fields={[{ name: "n", label: "Note", type: "textarea", required: true }]} onSubmit={() => "Internal note saved."} />
      <FormDialog open={dlg.is("keep")} title="Keep the count?" description="The Owner gets your comment and the metering record. They can appeal once to a second reviewer." confirm="Keep the count" onClose={dlg.close} fields={[]} onSubmit={() => "Decision sent to the Owner by email."} />
      <FormDialog open={dlg.is("change")} title="Credit conversations?" description="The credit appears on the next invoice and the decision shows who decided." confirm="Credit" onClose={dlg.close} fields={[{ name: "n", label: "AI conversations to credit", type: "number", value: "138", required: true }]} onSubmit={(v) => `${v.n} AI conversations credited and the decision sent to the Owner.`} />
      <FormDialog open={dlg.is("close")} title="Close with no risk found?" description="The case closes with your note. It stays in the safety log." confirm="Close case" onClose={dlg.close} fields={[{ name: "r", label: "Reason (logged)", type: "textarea", required: true, value: "Read the extract and the following messages; the visitor confirmed they had called the clinic and were fine." }]} onSubmit={() => "Case closed. Your reason is in the safety log."} />
      <FormDialog open={dlg.is("source")} title="Blocked source" description="412 widget conversations in 6 minutes" confirm="Done" onClose={dlg.close} fields={[]} onSubmit={() => "Source details closed."}>
        <dl className="kv sm">
          <div className="row between"><dt className="muted">Network range</dt><dd className="mono">185.220.xx.0/24</dd></div>
          <div className="row between"><dt className="muted">Action</dt><dd>Conversations blocked for 24 hours, not counted</dd></div>
        </dl>
      </FormDialog>
      <FormDialog open={dlg.is("unblock")} title="Unblock this source?" description="Conversations from this range are allowed again and count as usual." confirm="Unblock" onClose={dlg.close} fields={[]} onSubmit={() => "Source unblocked."} />
    </>
  );
}
