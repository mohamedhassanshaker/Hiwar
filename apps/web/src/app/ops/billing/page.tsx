"use client";

import Link from "next/link";
import { useState } from "react";

import { Dialog } from "@/components/dialog";
import { DataTable, FormDialog, PageHead, SampleNote, Seg, Status, Switch, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

type Tone = "ok" | "warn" | "bad" | "ai" | "mut";
const PLANS = ["Starter", "Growth", "Business", "Enterprise"];
const SUB_STATE: Record<string, [string, Tone]> = {
  act: ["Active", "ok"],
  trial: ["Trial", "ai"],
  due: ["Past due", "bad"],
  ro: ["Read-only", "bad"],
  end: ["Cancels at period end", "mut"],
};
type Sub = { id: string; n: string; plan: number; cycle: "Monthly" | "Yearly" | "Contract"; amount: string; next: string; state: string; pays: string; disc: string; since: string; cap: string };
const SUBS: Sub[] = [
  { id: "SUB-1042", n: "Gulf Bites Restaurants", plan: 1, cycle: "Monthly", amount: "AED 799", next: "1 Dec 2026", state: "act", pays: "Card ending 4242", disc: "None", since: "Mar 2026", cap: "AED 800" },
  { id: "SUB-1077", n: "Riyadh Motors", plan: 2, cycle: "Yearly", amount: "SAR 30,590", next: "15 Dec 2026", state: "act", pays: "Bank transfer · 30 days", disc: "KSA-LAUNCH 10%", since: "Dec 2025", cap: "Off" },
  { id: "SUB-1101", n: "Najd Logistics", plan: 2, cycle: "Monthly", amount: "SAR 3,059", next: "1 Nov 2026", state: "due", pays: "Card ending 7702 · failed", disc: "None", since: "Oct 2025", cap: "SAR 3,000" },
  { id: "SUB-1120", n: "Oasis Clinics", plan: 1, cycle: "Monthly", amount: "AED 799", next: "28 Nov 2026", state: "trial", pays: "No card yet", disc: "None", since: "Nov 2026", cap: "Off" },
  { id: "SUB-1093", n: "Marina Realty", plan: 0, cycle: "Monthly", amount: "AED 199", next: "—", state: "ro", pays: "Card ending 1186 · failed", disc: "None", since: "Sep 2025", cap: "Off" },
  { id: "SUB-1131", n: "Desert Bank", plan: 3, cycle: "Contract", amount: "AED 342,000", next: "1 Apr 2027", state: "act", pays: "Bank transfer · 30 days", disc: "None", since: "Apr 2025", cap: "Contract" },
  { id: "SUB-1150", n: "Al Waha Hotels", plan: 1, cycle: "Yearly", amount: "AED 7,990", next: "30 Nov 2026", state: "end", pays: "Card ending 5530", disc: "WELCOME20 · first month", since: "Nov 2025", cap: "AED 500" },
];
const INV_STATE: Record<string, [string, Tone]> = { paid: ["Paid", "ok"], open: ["Open", "ai"], over: ["Overdue", "bad"], draft: ["Draft", "mut"], void: ["Void", "mut"] };
type Inv = { id: string; sub: number; d: string; due: string; m: "UAE" | "KSA"; total: string; state: string; lines: [string, string, string][]; sub_: string; vat: string; pm: string };
const INVS: Inv[] = [
  { id: "INV-2026-01822", sub: 0, d: "1 Nov 2026", due: "1 Nov 2026", m: "UAE", total: "AED 1,076.25", state: "paid", lines: [["Growth plan · November", "1", "799.00"], ["Overage · October · 226 AI conversations × 0.80", "226", "226.00"]], sub_: "1,025.00", vat: "51.25", pm: "Card ending 4242" },
  { id: "INV-2026-02210", sub: 2, d: "1 Oct 2026", due: "31 Oct 2026", m: "KSA", total: "SAR 3,517.85", state: "over", lines: [["Business plan · October", "1", "3,059.00"]], sub_: "3,059.00", vat: "458.85", pm: "Not paid · grace day 15 of 30" },
  { id: "INV-2026-02231", sub: 1, d: "15 Oct 2026", due: "14 Nov 2026", m: "KSA", total: "SAR 31,660.65", state: "open", lines: [["Business plan · 1 year", "1", "30,590.00"], ["Discount KSA-LAUNCH 10%", "1", "−3,059.00"]], sub_: "27,531.00", vat: "4,129.65", pm: "Not paid yet" },
  { id: "INV-2026-01990", sub: 4, d: "3 Sep 2026", due: "3 Oct 2026", m: "UAE", total: "AED 208.95", state: "over", lines: [["Starter plan · September", "1", "199.00"]], sub_: "199.00", vat: "9.95", pm: "Not paid · grace ended 2 Nov · read-only" },
  { id: "INV-2026-02388", sub: 0, d: "28 Oct 2026", due: "27 Nov 2026", m: "UAE", total: "AED 7,350.00", state: "draft", lines: [["Agent setup workshop (on site)", "2", "7,000.00"]], sub_: "7,000.00", vat: "350.00", pm: "Not sent yet" },
];
type Over = { id: string; c: string; m: string; n: string; p: string; t: string; state: string; d: string };
const OVER: Over[] = [
  { id: "INV-2026-02402", c: "Najd Logistics", m: "October", n: "3,420", p: "SAR 0.61", t: "SAR 2,399.13", state: "open", d: "Due 30 Nov" },
  { id: "INV-2026-02403", c: "Gulf Bites Restaurants", m: "October", n: "226", p: "AED 0.80", t: "AED 189.84", state: "paid", d: "Paid with the November invoice" },
  { id: "INV-2026-02311", c: "Marina Realty", m: "September", n: "58", p: "AED 1.00", t: "AED 60.90", state: "susp", d: "Unpaid after 30-day grace" },
];
const OVER_STATE: Record<string, [string, Tone]> = { open: ["Open", "ai"], paid: ["Paid", "ok"], susp: ["Overage suspended", "warn"], cn: ["Credit note issued", "mut"] };
type Coupon = { code: string; o: string; dur: string; p: string; u: string; e: string };
const COUPONS: Coupon[] = [
  { code: "WELCOME20", o: "20% off the first Growth month", dur: "First payment", p: "Growth", u: "1,240 of 5,000", e: "31 Jan 2027" },
  { code: "PILOT60", o: "60 days of Business for new agencies", dur: "First 60 days", p: "Business", u: "14 of 30", e: "31 Dec 2026" },
  { code: "KSA-LAUNCH", o: "10% off for Saudi businesses", dur: "Forever", p: "All plans", u: "6", e: "—" },
  { code: "RAMADAN27", o: "15% off Growth yearly", dur: "First payment", p: "Growth yearly", u: "0", e: "20 Mar 2027" },
];

/** O-Billing (OPS-010): subscriptions, invoices, overage, credit notes, coupons and billing settings. Sample data. */
export default function OpsBillingPage() {
  const [tab, setTab] = useState<"over" | "subs" | "invs" | "overage" | "cn" | "coupons" | "set">("over");
  const [kind, setKind] = useState("All");
  const [st, setSt] = useState("");
  const [ist, setIst] = useState("");
  const [subState, setSubState] = useState<Record<string, string>>({});
  const [subPlan, setSubPlan] = useState<Record<string, number>>({});
  const [autoRenew, setAutoRenew] = useState<Record<string, boolean>>({});
  const [invState, setInvState] = useState<Record<string, string>>({});
  const [overState, setOverState] = useState<Record<string, string>>({});
  const [couponOn, setCouponOn] = useState<Record<string, boolean>>({ RAMADAN27: false });
  const [sw, setSw] = useState([true, true, true, true, true, false]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [inv, setInv] = useState<Inv | null>(null);
  const [np, setNp] = useState(1);
  const dlg = useDialog<"plan" | "coupon" | "cancel" | "good" | "void" | "paid" | "invoice" | "cap">();

  const stOf = (s: Sub) => subState[s.id] ?? s.state;
  const planOf = (s: Sub) => subPlan[s.id] ?? s.plan;
  const iStOf = (v: Inv) => invState[v.id] ?? v.state;
  const byKind = SUBS.filter((s) => kind === "All" || (kind === "Contracts" ? s.cycle === "Contract" : s.cycle === kind));
  const subs = byKind.filter((s) => !st || stOf(s) === st);
  const cur = sub ?? SUBS[0];
  const ar = autoRenew[cur.id] ?? stOf(cur) !== "end";
  const cn: [string, string, string, string, string, string, Tone][] = [
    ["CN-2026-0091", "INV-2026-00412", "Gulf Bites Restaurants", "Conversation pack refunded within 14 days · none used", "AED 1,522.50", "Refunded", "ok"],
    ["CN-2026-0088", "INV-2026-01490", "Al Waha Hotels", "Charged twice by mistake", "AED 838.95", "Refunded", "ok"],
    ["CN-2026-0083", "INV-2026-02099", "Najd Logistics", "Overage billed at the wrong plan price", "SAR 620.00", "Credit on next invoice", "ai"],
    ...INVS.filter((v) => invState[v.id] === "void").map((v): [string, string, string, string, string, string, Tone] => ["CN-2026-0104", v.id, SUBS[v.sub].n, "Voided by operator", v.total, "Refund pending", "warn"]),
    ...OVER.filter((o) => overState[o.id] === "cn").map((o): [string, string, string, string, string, string, Tone] => ["CN-2026-0105", o.id, o.c, "Overage corrected", o.t, "Credit on next invoice", "ai"]),
  ];

  return (
    <>
      <PageHead title="Subscriptions and billing" lead="Subscriptions, invoices, overage, credit notes and coupons.">
        <Link className="btn outline" href="/ops/plans">Plans and prices</Link>
        <button className="btn" onClick={() => dlg.show("invoice")}><i className="i i-plus" /> New invoice</button>
      </PageHead>
      <Tabs label="Billing sections" value={tab} onChange={setTab} tabs={[["over", "Overview"], ["subs", "Subscriptions"], ["invs", "Invoices"], ["overage", "Overage"], ["cn", "Credit notes"], ["coupons", "Coupons"], ["set", "Settings"]]} />
      <SampleNote />

      {tab === "over" && (
        <>
          <div className="grid g4">
            {[["Monthly recurring income", "AED 1.84 M", "+6.2% vs October"], ["Active subscriptions", "1,912", "1,604 monthly · 302 yearly · 6 contracts"], ["Past due", "AED 38,420", "3 failed payments · 2 overdue invoices"], ["Cancelled this month", "1.9%", "Of monthly subscriptions"]].map(([k, v, d]) => (
              <div key={k} className="card"><div className="card-c"><span className="xs muted">{k}</span><span className="h2">{v}</span><span className="xs muted">{d}</span></div></div>
            ))}
          </div>
          <div className="alert danger row between">
            <div className="col gap-0">
              <span className="b">3 payments failed and 2 invoices are overdue</span>
              <span className="sm">Cards are retried on day 1, 3 and 7. Unpaid organizations get a 30-day grace with full use, then read-only. Unpaid overage suspends overage only.</span>
            </div>
            <button className="btn outline sm" onClick={() => { setTab("subs"); setSt("due"); setKind("All"); }}>See past due</button>
          </div>
          <div className="grid g2">
            <section className="card">
              <div className="card-h"><div className="t"><h2 className="card-t">Renewals in the next 30 days</h2><p className="card-d">Yearly plans: reminders 30 and 7 days before</p></div></div>
              <div className="card-c">
                {[1, 3, 6, 0].map((i) => SUBS[i]).map((r) => (
                  <div key={r.id} className="row between">
                    <div className="col gap-0"><span className="b sm">{r.n}</span><span className="xs muted">{PLANS[planOf(r)]} · {r.cycle} · {r.next}</span></div>
                    <div className="row gap-8"><span className="sm tnum">{r.amount}</span><button className="btn ghost sm" onClick={() => setSub(r)}>Manage</button></div>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <div className="card-h"><div className="t"><h2 className="card-t">Income by stream</h2><p className="card-d">This month, before VAT</p></div></div>
              <div className="card-c">
                {([["Monthly subscriptions", "AED 1.02 M", 55], ["Yearly subscriptions", "AED 0.38 M", 21], ["Enterprise contracts", "AED 0.30 M", 16], ["Conversation packs", "AED 0.10 M", 5], ["Overage", "AED 0.04 M", 3]] as const).map(([l, v, p]) => (
                  <div key={l} className="col gap-4">
                    <div className="row between sm"><span>{l}</span><b>{v}</b></div>
                    <div className="progress" role="progressbar" aria-label={l} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${p}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {tab === "subs" && (
        <section className="card">
          <div className="card-h">
            <Seg label="Billing cycle" options={[["All", "All"], ["Monthly", "Monthly"], ["Yearly", "Yearly"], ["Contracts", "Contracts"]] as const} value={kind} onChange={setKind} />
            <div className="row gap-4" role="group" aria-label="Status">
              {[["", "All"], ["act", "Active"], ["trial", "Trial"], ["due", "Past due"], ["ro", "Read-only"], ["end", "Cancelling"]].map(([k, l]) => (
                <button key={k} className={st === k ? "chip on" : "chip"} aria-pressed={st === k} onClick={() => setSt(k)}>
                  {l} <span className="xs">{byKind.filter((r) => !k || stOf(r) === k).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card-c">
            {subs.length === 0 ? (
              <div className="row between"><span className="sm muted">No subscriptions with this status</span><button className="btn ghost sm" onClick={() => setSt("")}>Show all</button></div>
            ) : (
              <DataTable
                rows={subs}
                noun="subscriptions"
                rowKey={(r) => r.id}
                columns={[
                  { key: "n", label: "Customer", text: (r) => `${r.n} ${r.id}`, render: (r) => <div className="col gap-0"><button className="row-link" onClick={() => setSub(r)}>{r.n}</button><span className="xs muted mono">{r.id}</span></div> },
                  { key: "p", label: "Plan", text: (r) => PLANS[planOf(r)], render: (r) => PLANS[planOf(r)] },
                  { key: "c", label: "Billing", text: (r) => r.cycle, render: (r) => r.cycle },
                  { key: "a", label: "Amount", text: (r) => r.amount, render: (r) => <span className="tnum">{r.amount}</span> },
                  { key: "x", label: "Next bill", text: (r) => r.next, render: (r) => r.next },
                  { key: "s", label: "Status", text: (r) => SUB_STATE[stOf(r)][0], render: (r) => <Status tone={SUB_STATE[stOf(r)][1]}>{SUB_STATE[stOf(r)][0]}</Status> },
                ]}
              />
            )}
          </div>
        </section>
      )}

      {tab === "invs" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h2 className="card-t">Tax invoices</h2><p className="card-d">UAE invoices show 5% VAT and our TRN. Saudi invoices show 15% VAT.</p></div>
            <div className="row gap-4">
              {[["", "All"], ["open", "Open"], ["over", "Overdue"], ["paid", "Paid"], ["draft", "Draft"], ["void", "Void"]].map(([k, l]) => (
                <button key={k} className={ist === k ? "chip on" : "chip"} aria-pressed={ist === k} onClick={() => setIst(k)}>{l}</button>
              ))}
              <button className="btn outline sm" onClick={() => toast("Invoices exported as a CSV file.")}><i className="i i-download" /> Export CSV</button>
            </div>
          </div>
          <div className="card-c">
            <DataTable
              key={ist}
              rows={INVS.filter((v) => !ist || iStOf(v) === ist)}
              noun="invoices"
              rowKey={(r) => r.id}
              columns={[
                { key: "i", label: "Invoice", text: (r) => r.id, render: (r) => <button className="row-link mono" onClick={() => setInv(r)}>{r.id}</button> },
                { key: "c", label: "Customer", text: (r) => SUBS[r.sub].n, render: (r) => SUBS[r.sub].n },
                { key: "d", label: "Issued", text: (r) => r.d, render: (r) => r.d },
                { key: "u", label: "Due", text: (r) => r.due, render: (r) => <span className={iStOf(r) === "over" ? "b c-danger" : ""}>{r.due}</span> },
                { key: "m", label: "Market", text: (r) => r.m, render: (r) => r.m },
                { key: "t", label: "Total incl. VAT", text: (r) => r.total, render: (r) => <span className="tnum">{r.total}</span> },
                { key: "s", label: "Status", text: (r) => INV_STATE[iStOf(r)][0], render: (r) => <Status tone={INV_STATE[iStOf(r)][1]}>{INV_STATE[iStOf(r)][0]}</Status> },
              ]}
              actions={[{ label: "Remind", hidden: (r) => !["open", "over"].includes(iStOf(r)), run: (r) => toast(`Reminder sent to the billing contact for ${r.id}.`) }]}
            />
          </div>
        </section>
      )}

      {tab === "overage" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h2 className="card-t">Overage</h2><p className="card-d">Added to the month-end invoice for every organization that used AI conversations above its allowance: conversations above the allowance × the plan’s overage price, up to the Owner’s cap.</p></div>
            <button className="btn outline sm" onClick={() => toast("Overage lines exported as a CSV file.")}><i className="i i-download" /> Export CSV</button>
          </div>
          <div className="card-c">
            <DataTable
              rows={OVER}
              noun="overage lines"
              rowKey={(r) => r.id}
              columns={[
                { key: "i", label: "Invoice", text: (r) => r.id, render: (r) => <span className="mono">{r.id}</span> },
                { key: "c", label: "Customer", text: (r) => r.c, render: (r) => r.c },
                { key: "m", label: "Month", text: (r) => r.m, render: (r) => r.m },
                { key: "n", label: "AI conversations above allowance", text: (r) => r.n, render: (r) => <span className="tnum">{r.n}</span> },
                { key: "p", label: "Price each", text: (r) => r.p, render: (r) => r.p },
                { key: "t", label: "Total incl. VAT", text: (r) => r.t, render: (r) => <span className="tnum">{r.t}</span> },
                { key: "s", label: "Status", text: (r) => r.state, render: (r) => { const s = overState[r.id] ?? r.state; return <div className="col gap-0"><Status tone={OVER_STATE[s][1]}>{OVER_STATE[s][0]}</Status><span className="xs muted">{overState[r.id] === "susp" ? "Suspended by you" : r.d}</span></div>; } },
              ]}
              actions={[
                { label: "Restore overage", hidden: (r) => (overState[r.id] ?? r.state) !== "susp", run: (r) => { setOverState({ ...overState, [r.id]: "paid" }); toast(`Overage restored for ${r.c} after payment.`); } },
                { label: "Suspend overage", hidden: (r) => (overState[r.id] ?? r.state) !== "open", run: (r) => { setOverState({ ...overState, [r.id]: "susp" }); toast(`Overage suspended for ${r.c}. Included and pack conversations still work.`); } },
                { label: "Credit note", hidden: (r) => ["susp", "cn"].includes(overState[r.id] ?? r.state), run: (r) => { setOverState({ ...overState, [r.id]: "cn" }); toast(`Credit note issued against ${r.id}. The invoice itself is never edited.`); } },
              ]}
            />
            <div className="alert warning sm">Unpaid overage: overage is suspended after the 30-day grace; included and pack conversations keep working. Restore it when the invoice is paid. Overage isn’t refundable; billing errors are corrected with a credit note.</div>
          </div>
        </section>
      )}

      {tab === "cn" && (
        <section className="card">
          <div className="card-h"><div className="t"><h2 className="card-t">Credit notes and refunds</h2><p className="card-d">A paid invoice is never edited. We void it with a credit note and issue a new one.</p></div></div>
          <div className="card-c">
            <DataTable
              rows={cn}
              noun="credit notes"
              rowKey={(r) => r[0] + r[1]}
              columns={[
                { key: "i", label: "Credit note", text: (r) => r[0], render: (r) => <span className="mono">{r[0]}</span> },
                { key: "v", label: "For invoice", text: (r) => r[1], render: (r) => <span className="mono">{r[1]}</span> },
                { key: "c", label: "Customer", text: (r) => r[2], render: (r) => r[2] },
                { key: "r", label: "Reason", text: (r) => r[3], render: (r) => r[3] },
                { key: "a", label: "Amount", text: (r) => r[4], render: (r) => <span className="tnum">{r[4]}</span> },
                { key: "s", label: "Refund", text: (r) => r[5], render: (r) => <Status tone={r[6]}>{r[5]}</Status> },
              ]}
            />
          </div>
        </section>
      )}

      {tab === "coupons" && (
        <section className="card">
          <div className="card-h">
            <div className="t"><h2 className="card-t">Coupons and offers</h2><p className="card-d">Coupons are created only here. Website places them on pages and campaigns. One discount per order, and never below a plan’s minimum price.</p></div>
            <button className="btn" onClick={() => dlg.show("coupon", "new")}><i className="i i-plus" /> New coupon</button>
          </div>
          <div className="card-c">
            <DataTable
              rows={COUPONS}
              noun="coupons"
              rowKey={(r) => r.code}
              columns={[
                { key: "c", label: "Code", text: (r) => r.code, render: (r) => <span className="mono b">{r.code}</span> },
                { key: "o", label: "Offer", text: (r) => r.o, render: (r) => r.o },
                { key: "d", label: "Lasts", text: (r) => r.dur, render: (r) => r.dur },
                { key: "p", label: "Plans", text: (r) => r.p, render: (r) => r.p },
                { key: "u", label: "Used", text: (r) => r.u, render: (r) => r.u },
                { key: "e", label: "Ends", text: (r) => r.e, render: (r) => r.e },
                { key: "on", label: "On", render: (r) => <Switch on={couponOn[r.code] ?? true} label={r.code} onChange={(v) => setCouponOn({ ...couponOn, [r.code]: v })} /> },
              ]}
            />
          </div>
        </section>
      )}

      {tab === "set" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h"><div className="t"><h2 className="card-t">Failed payments</h2><p className="card-d">What happens when a card payment fails</p></div></div>
            <div className="card-c">
              <div className="field">
                <label className="label" htmlFor="rt">Try the card again on</label>
                <select id="rt" className="select"><option>Day 1, 3 and 7</option><option>Day 1, 2, 4 and 8</option><option>Day 3 only</option></select>
              </div>
              <p className="sm">Organizations: 30-day grace with full use, then read-only. Operators can extend the grace with a reason in Organizations.</p>
              {[["Email before renewal", "Reminders 30 and 7 days before a yearly plan renews"], ["Email when a payment fails", "To the Owner and the billing contact"], ["Suspend overage when unpaid", "After the 30-day grace"]].map(([n, d], i) => (
                <div key={n} className="row between"><div className="col gap-0"><span className="sm b">{n}</span><span className="xs muted">{d}</span></div><Switch on={sw[i]} label={n} onChange={(v) => setSw(sw.map((b, j) => (j === i ? v : b)))} /></div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><div className="t"><h2 className="card-t">Invoices and tax</h2><p className="card-d">Used on every invoice we send</p></div></div>
            <div className="card-c">
              <div className="grid g2">
                <div className="field"><label className="label" htmlFor="pre">Invoice number starts with</label><input id="pre" className="input" defaultValue="INV-2026-" /></div>
                <div className="field"><label className="label" htmlFor="nt">Payment terms for bank transfer</label><select id="nt" className="select"><option>30 days</option><option>15 days</option><option>45 days</option><option>On receipt</option></select></div>
              </div>
              <table className="table sm">
                <thead><tr><th scope="col">Market</th><th scope="col">VAT</th><th scope="col">Tax number</th><th scope="col">Currency</th></tr></thead>
                <tbody>
                  <tr><td>United Arab Emirates</td><td>5%</td><td>TRN 100 2345 6789 003</td><td>AED</td></tr>
                  <tr><td>Saudi Arabia</td><td>15%</td><td>VAT 310 1234 5678 0003</td><td>SAR</td></tr>
                </tbody>
              </table>
              {[["Charge or credit part-periods", "When plans change during a period"], ["Allow bank transfer", "Invoice with payment terms instead of a card, for yearly plans and contracts"], ["Send Saudi invoices for e-invoicing clearance", "Clear e-invoices before they’re sent"]].map(([n, d], i) => (
                <div key={n} className="row between"><div className="col gap-0"><span className="sm b">{n}</span><span className="xs muted">{d}</span></div><Switch on={sw[i + 3]} label={n} onChange={(v) => setSw(sw.map((b, j) => (j === i + 3 ? v : b)))} /></div>
              ))}
            </div>
            <div className="card-f"><button className="btn" onClick={() => toast("Billing settings saved. They apply from the next invoice.")}>Save settings</button></div>
          </section>
        </div>
      )}

      <Dialog
        open={!!sub}
        title={cur.n}
        description={`${cur.id} · ${SUB_STATE[stOf(cur)][0]}`}
        onClose={() => setSub(null)}
        footer={
          <>
            <button className="btn destructive" onClick={() => dlg.show("cancel")}>Cancel plan</button>
            <button className="btn" onClick={() => setSub(null)}>Done</button>
          </>
        }
      >
        <dl className="kv sm">
          {[["Plan", PLANS[planOf(cur)]], ["Billing", `${cur.cycle} · ${cur.amount}`], ["Next bill", cur.next], ["Pays by", cur.pays], ["Overage cap", cur.cap], ["Discount", cur.disc], ["Started", cur.since]].map(([k, v]) => (
            <div key={k} className="row between"><dt className="muted">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <div className="row between">
          <div className="col gap-0"><span className="sm b">Renew on its own</span><span className="xs muted">If off, the plan ends on the next bill date</span></div>
          <Switch on={ar} label="Renew on its own" onChange={(v) => { setAutoRenew({ ...autoRenew, [cur.id]: v }); setSubState({ ...subState, [cur.id]: v ? "act" : "end" }); }} />
        </div>
        <div className="row gap-8">
          <button className="btn outline sm" onClick={() => { setNp(planOf(cur)); dlg.show("plan"); }}>Change plan</button>
          <button className="btn outline sm" onClick={() => dlg.show("cap")}>Change overage cap</button>
          <button className="btn outline sm" onClick={() => dlg.show("coupon", "sub")}>Add a discount</button>
          {stOf(cur) === "trial" && <button className="btn outline sm" onClick={() => toast(`Trial for ${cur.n} extended by 14 days.`)}>Extend trial 14 days</button>}
          <button className="btn outline sm" onClick={() => dlg.show("good")}>Grant goodwill conversations</button>
        </div>
        <div className="col gap-4 sm">
          <span className="b">History</span>
          <span>Subscription started on {PLANS[cur.plan]} · {cur.since}</span>
          <span>Last invoice paid · Oct 2026</span>
          <span>Renewal reminder sent · 30 days before renewal</span>
        </div>
        <div className="col gap-4 sm">
          <span className="b">Invoices</span>
          {INVS.filter((v) => SUBS[v.sub].id === cur.id).map((v) => (
            <div key={v.id} className="row between"><span className="mono">{v.id}</span><span>{v.total}</span><Status tone={INV_STATE[iStOf(v)][1]}>{INV_STATE[iStOf(v)][0]}</Status><button className="btn ghost sm" onClick={() => { setSub(null); setInv(v); }}>View</button></div>
          ))}
        </div>
      </Dialog>

      {inv && (
        <Dialog
          open
          title={inv.id}
          description={`Tax invoice · ${INV_STATE[iStOf(inv)][0]}`}
          onClose={() => setInv(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => toast(`${inv.id}.pdf downloaded.`)}><i className="i i-download" /> PDF</button>
              <button className="btn ghost" onClick={() => toast(`${inv.id} emailed again to the billing contact.`)}><i className="i i-mail" /> Email again</button>
              {["open", "over"].includes(iStOf(inv)) && <button className="btn outline" onClick={() => dlg.show("paid")}>Record bank payment</button>}
              {!["void", "draft"].includes(iStOf(inv)) && <button className="btn destructive" onClick={() => dlg.show("void")}>Void with credit note</button>}
            </>
          }
        >
          <div className="row between top sm">
            <div className="col gap-0"><b>Hiwar Technologies FZ-LLC</b><span>Dubai, United Arab Emirates</span><span>TRN 100 2345 6789 003</span></div>
            <div className="col gap-0"><span>Issued {inv.d}</span><span>Due {inv.due}</span></div>
          </div>
          <div className="col gap-0 sm"><span className="muted">Bill to</span><b>{SUBS[inv.sub].n}</b></div>
          <table className="table sm">
            <thead><tr><th scope="col">Item</th><th scope="col" className="r">Qty</th><th scope="col" className="r">Amount</th></tr></thead>
            <tbody>
              {inv.lines.map(([n, q, a]) => <tr key={n}><td>{n}</td><td className="r">{q}</td><td className="r tnum">{a}</td></tr>)}
              <tr><td colSpan={2}>Subtotal</td><td className="r tnum">{inv.sub_}</td></tr>
              <tr><td colSpan={2}>{inv.m === "KSA" ? "VAT 15%" : "VAT 5%"}</td><td className="r tnum">{inv.vat}</td></tr>
              <tr><td colSpan={2} className="b">Total</td><td className="r tnum b">{inv.total}</td></tr>
            </tbody>
          </table>
          <span className="sm">Paid by: {invState[inv.id] === "paid" ? "Bank transfer FT26309ENBD48821" : inv.pm}</span>
        </Dialog>
      )}

      <Dialog
        open={dlg.is("plan")}
        title={`Change plan for ${cur.n}`}
        description="The change starts today. We charge or credit the difference for the days left."
        onClose={dlg.close}
        footer={<><button className="btn outline" onClick={dlg.close}>Cancel</button><button className="btn" onClick={() => { setSubPlan({ ...subPlan, [cur.id]: np }); dlg.close(); toast(np === planOf(cur) ? "Plan not changed." : `${cur.n} moved to ${PLANS[np]}. Their limits update now.`); }}>Change plan</button></>}
      >
        <div role="radiogroup" aria-label="New plan" className="col gap-8">
          {PLANS.slice(0, 3).map((p, i) => (
            <label key={p} className={np === i ? "card sel" : "card"}>
              <span className="card-c row between">
                <span className="row gap-8"><input type="radio" name="np" checked={np === i} onChange={() => setNp(i)} /><span className="b">{p}</span></span>
                <span className="xs muted">{i === planOf(cur) ? "Current plan" : i > planOf(cur) ? "Upgrade" : "Downgrade"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="alert info sm">{np === planOf(cur) ? "No change" : np > planOf(cur) ? "We charge about AED 410 now for the 16 days left." : "We add about AED 320 credit to the next invoice."} Shown on the next invoice as a separate line.</div>
      </Dialog>
      <FormDialog open={dlg.is("cap")} title={`Overage cap for ${cur.n}`} description="Usually set by the Owner in Plan and usage; changed here only at the Owner’s request" confirm="Save cap" onClose={dlg.close}
        fields={[{ name: "cap", label: "Monthly overage cap", value: cur.cap, required: true }, { name: "r", label: "Reason (logged)", value: "Owner asked by email", required: true }]}
        onSubmit={(v) => `Overage cap for ${cur.n} set to ${v.cap}.`} />
      <FormDialog open={dlg.is("coupon")} title={dlg.ctx<string>() === "sub" ? `Add a discount for ${cur.n}` : "New coupon"} description="Codes are not case-sensitive" confirm={dlg.ctx<string>() === "sub" ? "Add discount" : "Create coupon"} onClose={dlg.close}
        fields={[
          { name: "code", label: "Code", value: "RAMADAN27", required: true },
          { name: "type", label: "Discount", type: "select", options: ["15% off", "Fixed amount off", "Free months"] },
          { name: "dur", label: "Lasts", type: "select", options: ["First payment only", "3 months", "Forever"] },
          { name: "plans", label: "Plans", type: "select", options: ["Growth", "All plans", "Conversation packs"] },
          { name: "max", label: "Max uses", value: "2,000" },
          { name: "end", label: "Ends", type: "date", value: "2027-03-20" },
        ]}
        onSubmit={(v) => (dlg.ctx<string>() === "sub" ? `Discount added. It shows on ${cur.n}’s next invoice.` : `Coupon ${v.code.toUpperCase()} created and switched on. Website can now place it on pages.`)} />
      <FormDialog open={dlg.is("cancel")} title={`Cancel ${cur.n}’s plan?`} description={`They keep access until ${cur.next}. No refund for the current period unless you add a credit note.`} confirm="Cancel at period end" destructive onClose={dlg.close}
        fields={[{ name: "r", label: "Reason", type: "select", options: ["Customer asked", "Moved to another plan", "Unpaid for 30 days", "Other"] }]}
        onSubmit={() => { setSubState({ ...subState, [cur.id]: "end" }); setAutoRenew({ ...autoRenew, [cur.id]: false }); return `${cur.n}’s plan will end on ${cur.next}.`; }} />
      <FormDialog open={dlg.is("good")} title={`Grant goodwill AI conversations to ${cur.n}`} description="Added to this month’s allowance as a logged entry." confirm="Grant" onClose={dlg.close}
        fields={[{ name: "n", label: "AI conversations", type: "number", value: "500", required: true }, { name: "r", label: "Reason (required, logged)", type: "textarea", value: "Agent replies were slow in the UAE region on 4 Nov.", required: true }]}
        onSubmit={(v) => `${v.n} goodwill AI conversations granted to ${cur.n}. Logged with your reason.`} />
      {inv && (
        <>
          <FormDialog open={dlg.is("void")} title={`Void ${inv.id}?`} description={`We issue credit note CN-2026-0104 for ${inv.total}. This can’t be undone.`} confirm="Void and issue credit note" destructive onClose={dlg.close} fields={[]}
            onSubmit={() => { setInvState({ ...invState, [inv.id]: "void" }); return `${inv.id} voided. Credit note CN-2026-0104 issued.`; }}>
            <label className="row gap-8 sm"><input type="checkbox" defaultChecked /> Refund the payment to the original method</label>
            <label className="row gap-8 sm"><input type="checkbox" defaultChecked /> Email the customer the credit note</label>
          </FormDialog>
          <FormDialog open={dlg.is("paid")} title="Record a bank payment" description={`For ${inv.id} · ${inv.total}`} confirm="Mark as paid" onClose={dlg.close}
            fields={[{ name: "a", label: "Amount received", value: inv.total, required: true }, { name: "d", label: "Date received", type: "date", value: "2026-11-05", required: true }, { name: "ref", label: "Bank reference", value: "FT26309ENBD48821", required: true }]}
            onSubmit={() => { setInvState({ ...invState, [inv.id]: "paid" }); return `${inv.id} marked as paid. A receipt was emailed.`; }} />
        </>
      )}
      <FormDialog open={dlg.is("invoice")} title="New invoice" description="For one-off work like setup workshops or custom integrations" confirm="Send invoice" onClose={dlg.close}
        fields={[
          { name: "c", label: "Customer", type: "select", options: SUBS.map((s) => s.n) },
          { name: "i", label: "Item", value: "Agent setup workshop (on site)", required: true },
          { name: "q", label: "Quantity", type: "number", value: "2", required: true },
          { name: "p", label: "Price each, before VAT (AED)", type: "number", value: "3500", required: true },
        ]}
        onSubmit={(v) => { const t = Number(v.q) * Number(v.p) * 1.05; return `Invoice INV-2026-02404 for AED ${t.toLocaleString("en-US", { minimumFractionDigits: 2 })} (with 5% VAT) sent to ${v.c}.`; }} />
    </>
  );
}
