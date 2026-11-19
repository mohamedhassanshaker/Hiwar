"use client";

import { useState } from "react";

import { DataTable, FormDialog, SampleNote, Seg, Status, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

type CostRow = { n: string; r: string; a: string; m: string; l: string; cl: string; warn?: boolean };
const GROUPS: Record<"tier" | "purpose" | "channel", { col: string; rows: CostRow[] }> = {
  tier: {
    col: "Model tier",
    rows: [
      { n: "Fast", r: "Included in plans", a: "AED 9,800", m: "—", l: "212,400", cl: "AED 0.05" },
      { n: "Standard", r: "Included in plans", a: "AED 61,300", m: "—", l: "318,900", cl: "AED 0.19" },
      { n: "Advanced", r: "Business and Enterprise", a: "AED 38,100", m: "—", l: "41,200", cl: "AED 0.92", warn: true },
      { n: "Embeddings", r: "Knowledge preparation", a: "AED 4,200", m: "—", l: "—", cl: "—" },
    ],
  },
  purpose: {
    col: "Agent purpose",
    rows: [
      { n: "Support and order status", r: "AED 312,000", a: "AED 51,200", m: "84%", l: "301,000", cl: "AED 0.17" },
      { n: "Bookings", r: "AED 118,000", a: "AED 22,600", m: "81%", l: "142,600", cl: "AED 0.16" },
      { n: "Sales and lead capture", r: "AED 96,400", a: "AED 24,900", m: "74%", l: "88,300", cl: "AED 0.28" },
      { n: "Website FAQ", r: "AED 41,800", a: "AED 14,700", m: "65%", l: "40,600", cl: "AED 0.36", warn: true },
    ],
  },
  channel: {
    col: "Who answered",
    rows: [
      { n: "AI only", r: "Counted", a: "AED 98,100", m: "—", l: "486,000", cl: "AED 0.20" },
      { n: "AI then person", r: "Counted", a: "AED 13,700", m: "—", l: "61,900", cl: "AED 0.22" },
      { n: "Test console", r: "Not counted", a: "AED 1,600", m: "—", l: "24,600", cl: "AED 0.07" },
    ],
  },
};
const SERVICES = ["Control panel", "Widget and its API", "Agent service", "Model provider", "Payments", "Email"];

/** O-Business functions without a backend (OPS-009): cost groupings, overage, incidents, isolation tests. */
export function BusinessExtras() {
  const [tab, setTab] = useState<"cost" | "incident" | "iso">("cost");
  const [grp, setGrp] = useState<"tier" | "purpose" | "channel">("tier");
  const [posted, setPosted] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [leak, setLeak] = useState(false);
  const dlg = useDialog<"summary">();
  const g = GROUPS[grp];
  return (
    <>
      <div className="row between">
        <h2 className="h2">More views</h2>
        <Tabs label="Business views" value={tab} onChange={setTab} tabs={[["cost", "Cost breakdown"], ["incident", "Incidents"], ["iso", "Isolation tests"]]} />
      </div>
      <SampleNote />
      {tab === "cost" && (
        <>
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h3 className="card-t">Model cost and margin · by {g.col.toLowerCase()}</h3>
                <p className="card-d">Monthly totals. Only operators see model cost, and only here.</p>
              </div>
              <Seg label="Group by" options={[["tier", "Model tier"], ["purpose", "Agent purpose"], ["channel", "Who answered"]] as const} value={grp} onChange={setGrp} />
            </div>
            <div className="card-c">
              <DataTable
                key={grp}
                rows={g.rows}
                noun="rows"
                rowKey={(r) => r.n}
                columns={[
                  { key: "n", label: g.col, text: (r) => r.n, render: (r) => <span className="b">{r.n}</span> },
                  { key: "r", label: "Income", text: (r) => r.r, render: (r) => r.r },
                  { key: "a", label: "Model cost", text: (r) => r.a, render: (r) => <span className="tnum">{r.a}</span> },
                  { key: "m", label: "Margin", text: (r) => r.m, render: (r) => (r.warn ? <Status tone="warn">{r.m === "—" ? "Watch" : r.m}</Status> : r.m) },
                  { key: "l", label: "AI conversations", text: (r) => r.l, render: (r) => <span className="tnum">{r.l}</span> },
                  { key: "c", label: "Cost per conversation", text: (r) => r.cl, render: (r) => <span className="tnum">{r.cl}</span> },
                ]}
              />
              {grp === "purpose" && <div className="alert warning sm">Website FAQ agents: cost per conversation is above the 0.30 AED target. Long knowledge bases send more context; review the Starter knowledge limit in Plans and prices.</div>}
            </div>
          </section>
          <section className="card">
            <div className="card-h">
              <div className="t"><h3 className="card-t">Overage · October</h3><p className="card-d">Invoiced with the month-end invoice on 1 Nov</p></div>
            </div>
            <div className="card-c grid g4 sm">
              <div className="col gap-0"><span className="muted">Organizations with overage on</span><b>27</b></div>
              <div className="col gap-0"><span className="muted">Reached their monthly cap</span><b>3</b></div>
              <div className="col gap-0"><span className="muted">Overage billed</span><b>AED 41,870</b></div>
              <div className="col gap-0"><span className="muted">Overage suspended (unpaid)</span><b>1 organization</b></div>
            </div>
          </section>
        </>
      )}
      {tab === "incident" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t"><h3 className="card-t">Problem · Agent replies slow (UAE)</h3><p className="card-d">Started 10:38 · affects 41 organizations</p></div>
              <Status tone={fixed ? "ok" : posted ? "warn" : "bad"}>{fixed ? "Fixed" : posted ? "Update posted" : "Checking"}</Status>
            </div>
            <div className="card-c">
              <div className="field">
                <label className="label" htmlFor="up">Status update</label>
                <textarea id="up" className="textarea" defaultValue="We’re seeing slower agent replies in the UAE region. Traffic has moved to our backup model provider; replies may take a few extra seconds." />
              </div>
              <div className="row gap-8">
                <button className="btn outline" onClick={() => { setPosted(true); toast("Update posted to the Owners and Admins of 41 organizations."); }}>Post update to affected organizations</button>
                <button className="btn" disabled={fixed} onClick={() => setFixed(true)}>Mark fixed</button>
              </div>
              {fixed && (
                <div className="row gap-8">
                  <span className="sm muted">After the fix</span>
                  <button className="btn outline sm" onClick={() => dlg.show("summary")}>Publish problem summary</button>
                  <button className="btn ghost sm" onClick={() => toast("Release notes 1.4.1 published.")}>Publish release notes 1.4.1</button>
                </div>
              )}
            </div>
          </section>
          <aside className="card">
            <div className="card-h"><h3 className="card-t">Service health</h3></div>
            <div className="card-c">
              {SERVICES.map((n) => {
                const bad = n === "Model provider" && !fixed;
                return (
                  <div key={n} className="row between sm">
                    <span>{n}</span>
                    <Status tone={bad ? "warn" : "ok"}>{bad ? "Degraded" : "Operational"}</Status>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      )}
      {tab === "iso" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h3 className="card-t">Organization isolation tests · 6 Nov 02:00</h3><p className="card-d">Every attempt to read one organization’s data from another organization’s session must fail</p></div>
            <div className="row gap-8">
              <Seg label="Nightly run result" options={[["ok", "All blocked"], ["leak", "One leak found"]] as const} value={leak ? "leak" : "ok"} onChange={(v) => setLeak(v === "leak")} />
              <Status tone={leak ? "bad" : "ok"}>{leak ? "Failed · releases blocked" : "Passed"}</Status>
            </div>
          </div>
          <div className="card-c">
            {leak && (
              <div className="alert danger" role="alert">
                <span className="b">Releases blocked</span> 1 cross-organization read succeeded: GET /api/widget/state with another deployment’s key returned a conversation. Fix and re-run before any release.
              </div>
            )}
            <div className="grid g4 sm">
              <div className="col gap-0"><span className="muted">Routes tested</span><b>64</b></div>
              <div className="col gap-0"><span className="muted">Cross-organization attempts</span><b>8,240</b></div>
              <div className="col gap-0"><span className="muted">Blocked</span><b>{leak ? "8,239" : "8,240"}</b></div>
              <div className="col gap-0"><span className="muted">Leaked</span><b className={leak ? "c-danger" : ""}>{leak ? "1" : "0"}</b></div>
            </div>
          </div>
        </section>
      )}
      <FormDialog
        open={dlg.is("summary")}
        title="Publish problem summary"
        description="Shown to affected organizations"
        confirm="Publish"
        onClose={dlg.close}
        fields={[{ name: "s", label: "Summary", type: "textarea", required: true, value: "On 4 Nov between 10:38 and 11:12, agent replies in the UAE took up to 9 seconds. No conversations were lost and none were counted twice." }]}
        onSubmit={() => "Problem summary published."}
      />
    </>
  );
}
