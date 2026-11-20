"use client";

import Link from "next/link";
import { useState } from "react";

import { DataTable, FormDialog, PageHead, SampleNote, Status, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

type Entry = { id: string; d: string; a: string; v: string; s: string; neg?: boolean };
const LEDGER: Entry[] = [
  { id: "LE-90211", d: "Payment received (before VAT)", a: "Gulf Bites Restaurants", v: "AED 1,450.00", s: "Settled" },
  { id: "LE-90212", d: "VAT collected", a: "Tax · UAE", v: "AED 72.50", s: "Settled" },
  { id: "LE-90213", d: "Income · conversation packs", a: "Platform income", v: "AED 1,450.00", s: "Settled" },
  { id: "LE-90214", d: "Pack conversations granted (valid 12 months)", a: "Allowance · Gulf Bites", v: "+2,000 AI conversations", s: "Posted" },
];
const REFUND: Entry[] = [
  { id: "LE-91540", d: "Refund in full to customer", a: "Gulf Bites Restaurants", v: "−AED 1,450.00", s: "Posted", neg: true },
  { id: "LE-91541", d: "Reverse pack income", a: "Platform income", v: "−AED 1,450.00", s: "Posted", neg: true },
  { id: "LE-91542", d: "VAT credit note CN-2026-0091", a: "Tax · UAE", v: "−AED 72.50", s: "Posted", neg: true },
  { id: "LE-91543", d: "Remove unspent pack conversations", a: "Allowance · Gulf Bites", v: "−2,000 AI conversations", s: "Posted", neg: true },
];
const ALLOW: [string, string, string, string, string][] = [
  ["AL-55102", "1 Nov", "Monthly refresh: Growth plan", "Plan · Growth", "+2,000"],
  ["AL-55340", "6 Nov", "Pack purchase PAY-77120", "Conversation pack", "+2,000"],
  ["AL-55618", "9 Nov", "Goodwill grant: replies slow on 4 Nov (reason logged)", "Granted by Tariq", "+500"],
  ["AL-55901", "1–14 Nov", "Counted · AI conversations on gulfbites.ae", "Deployment Main site", "−1,214"],
  ["AL-55902", "1–14 Nov", "Counted · AI conversations on order.gulfbites.ae", "Deployment Orders", "−198"],
];
const EVENTS: [string, string, string, string][] = [
  ["evt_3Q…a81", "payment_intent.succeeded", "INV-2026-01822 · Gulf Bites", "Invoice marked paid"],
  ["evt_3Q…c02", "payment_intent.payment_failed", "INV-2026-02210 · Najd Logistics", "Grace started · Owner emailed"],
  ["evt_3Q…f19", "setup_intent.succeeded", "Oasis Clinics", "Card ending 4242 saved"],
  ["evt_3Q…9d4", "charge.dispute.created", "INV-2026-01488 · Al Waha Hotels", "Dispute CB-0017 opened"],
];

/** O-Finance (OPS-011): append-only ledger, allowance entries, payment events, disputes and reports. Sample data. */
export default function FinancePage() {
  const [tab, setTab] = useState<"ledger" | "allow" | "events" | "disputes" | "reports">("ledger");
  const [refunded, setRefunded] = useState(false);
  const dlg = useDialog<"evidence">();
  const allow = refunded ? [...ALLOW, ["AL-56012", "15 Nov", "Pack refunded: unspent pack conversations removed", "Reversal of AL-55340", "−2,000"] as [string, string, string, string, string]] : ALLOW;
  const left = allow.reduce((s, r) => s + Number(r[4].replace(/[+,]/g, "").replace("−", "-")), 0);
  return (
    <>
      <PageHead title="Payments and ledger" lead="The ledger can only be added to. Balances and invoices are never edited; corrections are credit notes and reversals.">
        <Tabs label="Finance sections" value={tab} onChange={setTab} tabs={[["ledger", "Ledger"], ["allow", "Allowance entries"], ["events", "Payment events"], ["disputes", "Card disputes"], ["reports", "Reports"]]} />
      </PageHead>
      <SampleNote />
      {tab === "ledger" && (
        <section className="card">
          <div className="card-h">
            <div className="t">
              <span className="xs muted">Payment PAY-77120 · Gulf Bites Restaurants · conversation pack, 2,000 AI conversations · bought 6 Nov</span>
              <h2 className="card-t">AED 1,450 + AED 72.50 VAT</h2>
            </div>
            <button className="btn outline" disabled={refunded} onClick={() => { setRefunded(true); toast("Refunded in full. Credit note CN-2026-0091 issued."); }}>Refund in full · no pack conversations used</button>
          </div>
          <div className="card-c">
            <DataTable
              rows={refunded ? [...LEDGER, ...REFUND] : LEDGER}
              noun="ledger entries"
              rowKey={(r) => r.id}
              columns={[
                { key: "i", label: "Entry", text: (r) => r.id, render: (r) => <span className="mono">{r.id}</span> },
                { key: "d", label: "Description", text: (r) => r.d, render: (r) => r.d },
                { key: "a", label: "Account", text: (r) => r.a, render: (r) => r.a },
                { key: "v", label: "Amount", text: (r) => r.v, render: (r) => <span className={r.neg ? "tnum c-danger" : "tnum"}>{r.v}</span> },
                { key: "s", label: "Status", text: (r) => r.s, render: (r) => <Status tone={r.neg ? "bad" : "ok"}>{r.s}</Status> },
              ]}
            />
            {refunded && <p className="sm">Refunded in full within 14 days with none of the pack’s conversations used. VAT credit note CN-2026-0091 issued; the 2,000 pack conversations were removed from the allowance by a reversal entry.</p>}
          </div>
        </section>
      )}
      {tab === "allow" && (
        <section className="card">
          <div className="card-h">
            <div className="t">
              <span className="xs muted">AI conversation allowance · Gulf Bites Restaurants</span>
              <h2 className="card-t">{left.toLocaleString("en-US")} AI conversations left this month</h2>
              <p className="card-d">The balance is the sum of its entries: refreshes, packs, grants and counted conversations are added, never edited.</p>
            </div>
            <Link className="btn outline sm" href="/ops/billing">Grant goodwill conversations</Link>
          </div>
          <div className="card-c">
            <DataTable
              rows={allow}
              noun="allowance entries"
              rowKey={(r) => r[0]}
              columns={[
                { key: "i", label: "Entry", text: (r) => r[0], render: (r) => <span className="mono">{r[0]}</span> },
                { key: "t", label: "Date", text: (r) => r[1], render: (r) => r[1] },
                { key: "d", label: "Description", text: (r) => r[2], render: (r) => r[2] },
                { key: "s", label: "Source", text: (r) => r[3], render: (r) => <span className="sm muted">{r[3]}</span> },
                { key: "v", label: "AI conversations", className: "r", text: (r) => r[4], sort: (r) => Number(r[4].replace(/[+,]/g, "").replace("−", "-")), render: (r) => <span className={r[4].startsWith("−") ? "tnum c-danger" : "tnum"}>{r[4]}</span> },
              ]}
            />
            <p className="sm muted">Included conversations refresh on the 1st and don’t roll over. Pack conversations last 12 months and are used after included ones. Overage is billed in money on the month-end invoice, so it doesn’t appear here.</p>
          </div>
        </section>
      )}
      {tab === "events" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h2 className="card-t">Payment provider events</h2><p className="card-d">Signed webhook events from Stripe; each one is applied once.</p></div>
            <Status tone="ok">Webhook verified</Status>
          </div>
          <div className="card-c">
            <DataTable
              rows={EVENTS}
              noun="payment events"
              rowKey={(r) => r[0]}
              columns={[
                { key: "i", label: "Event", text: (r) => r[0], render: (r) => <span className="mono">{r[0]}</span> },
                { key: "t", label: "Type", text: (r) => r[1], render: (r) => <span className="mono sm">{r[1]}</span> },
                { key: "f", label: "For", text: (r) => r[2], render: (r) => r[2] },
                { key: "r", label: "Result", text: (r) => r[3], render: (r) => <span className="sm">{r[3]}</span> },
              ]}
            />
            <p className="sm muted">The provider’s processing fee is recorded in the ledger as a cost line.</p>
          </div>
        </section>
      )}
      {tab === "disputes" && (
        <section className="card">
          <div className="card-h">
            <div className="t">
              <span className="xs muted">Card dispute CB-0017 · card payment from Al Waha Hotels</span>
              <h2 className="card-t">AED 838.95 Growth monthly charged back 40 days after payment</h2>
            </div>
            <Status tone="warn">Recorded</Status>
          </div>
          <div className="card-c">
            <table className="table sm">
              <tbody>
                <tr><td>Amount charged back by the card issuer (VAT included)</td><td className="r tnum">838.95</td></tr>
                <tr><td>Covered by the Hiwar dispute reserve</td><td className="r tnum">− 838.95</td></tr>
                <tr><td>VAT credit note if the dispute is lost</td><td className="r tnum">39.95</td></tr>
              </tbody>
            </table>
            <button className="btn outline" onClick={() => dlg.show("evidence")}>Submit evidence</button>
            <p className="sm muted">Evidence: invoice, sign-in history and AI conversations used. If the dispute is lost the organization moves to read-only after the grace period; its data is kept.</p>
          </div>
        </section>
      )}
      {tab === "reports" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h2 className="card-t">Finance report · October</h2><p className="card-d">Income by stream and VAT due per market. Hiwar earns only from subscriptions, conversation packs and overage.</p></div>
            <button className="btn outline sm" onClick={() => toast("October finance report exported (CSV).")}><i className="i i-download" /> Export</button>
          </div>
          <div className="card-c table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Stream</th><th scope="col" className="r">Income before VAT (AED)</th><th scope="col" className="r">Refunds and credit notes</th><th scope="col" className="r">VAT due · UAE 5%</th><th scope="col" className="r">VAT due · KSA 15%</th></tr></thead>
              <tbody>
                {[["Monthly subscriptions", "1,020,000", "−4,200", "41,800", "32,370"], ["Yearly and contracts", "680,400", "−3,160", "26,900", "21,880"], ["Conversation packs", "96,300", "−1,450", "3,610", "3,610"], ["Overage", "41,870", "−620 (credit note)", "1,560", "1,580"], ["Total", "1,838,570", "−9,430", "73,870", "59,440"]].map((r) => (
                  <tr key={r[0]} className={r[0] === "Total" ? "b" : ""}>{r.map((c, i) => <td key={i} className={i ? "r tnum" : ""}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <p className="sm muted">KSA amounts are converted from SAR at the invoice date. Payment provider fees (AED 18,200) are recorded as cost lines.</p>
          </div>
        </section>
      )}
      <FormDialog open={dlg.is("evidence")} title="Submit dispute evidence" description="Sent to the card issuer through the payment provider" confirm="Submit" onClose={dlg.close} fields={[]} onSubmit={() => "Evidence submitted. The issuer decides within 30 days."}>
        <dl className="kv sm">
          <div className="row between"><dt className="muted">Receipt and tax invoice</dt><dd>INV-2026-01488 · 6 Oct</dd></div>
          <div className="row between"><dt className="muted">Sign-in history</dt><dd>31 sign-ins since payment</dd></div>
          <div className="row between"><dt className="muted">Use</dt><dd>612 AI conversations and 2 live deployments</dd></div>
        </dl>
      </FormDialog>
    </>
  );
}
