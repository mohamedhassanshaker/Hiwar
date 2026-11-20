"use client";

import { useState } from "react";

import { DataTable, FormDialog, SampleNote, Seg, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";
import { FEATURES, PLAN_KEYS, PLAN_NAMES } from "@/mock/tenants";

const COST = [
  ["Fast model", "Input and output tokens", "per million tokens", "0.55", "2.20"],
  ["Standard model", "Input and output tokens", "per million tokens", "3.70", "14.70"],
  ["Advanced model", "Input and output tokens", "per million tokens", "11.00", "44.00"],
  ["Embeddings", "Knowledge preparation and search", "per million tokens", "0.07", "—"],
  ["Website crawl", "One crawled page", "per page", "0.004", "—"],
];
const PACKS: [string, string, number, boolean][] = [
  ["500 AI conversations", "Starter and Growth", 450, true],
  ["2,000 AI conversations", "Growth and Business", 1590, true],
  ["10,000 AI conversations", "Business", 6900, false],
];
/** [plan, overage price, default cap, maximum cap] in AED */
const OVERAGE: [string, string, string, string][] = [
  ["Starter", "1.00", "300", "3,000"],
  ["Growth", "0.80", "1,000", "10,000"],
  ["Business", "0.60", "3,000", "50,000"],
  ["Enterprise", "Contract", "Contract", "Contract"],
];
const SAR = 1.02;

/** O-Plans functions without a backend: markets, comparison, cost list, packs, overage and publish choices (OPS-006). */
export function PlansExtras() {
  const [mkt, setMkt] = useState<"AED" | "SAR">("AED");
  const [packs, setPacks] = useState(PACKS);
  const [who, setWho] = useState(1);
  const dlg = useDialog<"pack" | "publish" | "plan">();
  const money = (v: string | number) => {
    const n = typeof v === "number" ? v : Number(v.replace(/,/g, ""));
    if (Number.isNaN(n)) return String(v);
    const x = mkt === "SAR" ? n * SAR : n;
    return `${mkt} ${x.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 3 : 0 })}`;
  };
  const APPLY = [
    ["New customers only", "Current subscribers keep their version of the plan"],
    ["New customers now, current customers at renewal", "Owners get 30 days’ notice by email"],
    ["Everyone now", "Only for fixes and changes that add features"],
  ];
  return (
    <>
      <div className="row between">
        <h2 className="h2">Markets, comparison and add-ons</h2>
        <div className="row gap-8">
          <Seg label="Market" options={[["AED", "UAE · AED"], ["SAR", "KSA · SAR"]] as const} value={mkt} onChange={setMkt} />
          <button className="btn outline" onClick={() => dlg.show("plan")}>
            <i className="i i-plus" /> New plan
          </button>
          <button className="btn" onClick={() => dlg.show("publish")}>Publish changes</button>
        </div>
      </div>
      <SampleNote />
      {mkt === "SAR" && <p className="sm"><span className="badge warning">SAR draft</span> KSA prices are a draft until published; they follow the AED prices at 1.02 and round to the nearest riyal.</p>}

      <section className="card">
        <div className="card-h">
          <div className="t">
            <h3 className="card-t">Compare features</h3>
            <p className="card-d">What each plan includes. Organizations can get changes on top of their plan from the Organizations page. Human handover and Arabic are on every plan.</p>
          </div>
        </div>
        <div className="card-c table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {PLAN_KEYS.map((k) => <th key={k} scope="col">{PLAN_NAMES[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.key}>
                  <td>
                    <div className="b">{f.name}</div>
                    <div className="xs muted">{f.desc}</div>
                  </td>
                  {f.plan.map((v, i) => (
                    <td key={i} className={v === false ? "sm muted" : "sm"}>
                      <i className={`i ${v === false ? "i-minus" : "i-check"}`} aria-hidden /> {v === false ? "Off" : v === true ? "Included" : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <div className="t">
            <h3 className="card-t">Model cost price list</h3>
            <p className="card-d">What one unit of each model costs Hiwar. Used for the cost per turn and the margin on Cost and health. Customers see AI conversations, never model cost.</p>
          </div>
          <button className="btn outline sm" onClick={() => toast("Cost price list saved as a draft. Publish it with a plan change to apply it.")}>Save as draft</button>
        </div>
        <div className="card-c table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Unit</th>
                <th scope="col">Input (AED)</th>
                <th scope="col">Output (AED)</th>
              </tr>
            </thead>
            <tbody>
              {COST.map(([n, d, u, a, b]) => (
                <tr key={n}>
                  <td>
                    <div className="b">{n}</div>
                    <div className="xs muted">{d}</div>
                  </td>
                  <td className="sm">{u}</td>
                  <td><input className="input" style={{ width: 100 }} aria-label={`${n} input cost`} defaultValue={a} /></td>
                  <td>{b === "—" ? "—" : <input className="input" style={{ width: 100 }} aria-label={`${n} output cost`} defaultValue={b} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid g2">
        <section className="card">
          <div className="card-h">
            <div className="t">
              <h3 className="card-t">AI conversation packs</h3>
              <p className="card-d">Prepaid AI conversations on top of the plan, prices in {mkt} before VAT. Pack conversations last 12 months and are spent after the included ones.</p>
            </div>
            <button className="btn outline sm" onClick={() => dlg.show("pack")}>
              <i className="i i-plus" /> Add pack
            </button>
          </div>
          <div className="card-c">
            <DataTable
              rows={packs}
              noun="conversation packs"
              rowKey={(r) => r[0]}
              pageSize={10}
              columns={[
                { key: "n", label: "Pack", text: (r) => r[0], sort: (r) => Number(r[0].replace(/\D/g, "")), render: (r) => r[0] },
                { key: "f", label: "For", text: (r) => r[1], render: (r) => <span className="sm">{r[1]}</span> },
                { key: "p", label: "Price", className: "r", text: (r) => money(r[2]), sort: (r) => r[2], render: (r) => <span className="tnum">{money(r[2])}</span> },
                { key: "s", label: "Status", text: (r) => (r[3] ? "On sale" : "Draft"), render: (r) => <span className={r[3] ? "badge success" : "badge secondary"}>{r[3] ? "On sale" : "Draft"}</span> },
              ]}
            />
          </div>
        </section>
        <section className="card">
          <div className="card-h">
            <div className="t">
              <h3 className="card-t">Overage</h3>
              <p className="card-d">Off by default; the Owner turns it on and sets a monthly cap. Billed after the month on the invoice. Notices at 50%, 80% and 100% of the cap.</p>
            </div>
          </div>
          <div className="card-c table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Per AI conversation</th>
                  <th scope="col">Default cap</th>
                  <th scope="col">Maximum cap</th>
                </tr>
              </thead>
              <tbody>
                {OVERAGE.map(([n, p, d, m]) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td className="tnum">{money(p)}</td>
                    <td className="tnum">{money(d)}</td>
                    <td className="tnum">{money(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card soft">
        <div className="card-c">
          <span className="b">How limits work for every plan</span>
          <div className="grid g2 sm">
            <div><span className="b">AI conversations</span> Included conversations refresh each month and don’t roll over. Spending order: included, then pack conversations, then overage if the Owner turned it on.</div>
            <div><span className="b">At the limit</span> Without overage, widgets warn at 80%, then answer with the offline message and offer a person until the month resets or the Owner adds a pack.</div>
            <div><span className="b">Members and storage</span> New members can’t be invited and new files can’t be added until the Owner changes plan or removes some.</div>
            <div><span className="b">Organization changes</span> An organization can get extra limits or features on top of its plan, for good or until an end date. Every change is logged.</div>
          </div>
        </div>
      </section>

      <FormDialog
        open={dlg.is("pack")}
        title="Add an AI conversation pack"
        description={`Added as a draft for the ${mkt} market`}
        confirm="Add pack"
        onClose={dlg.close}
        fields={[
          { name: "size", label: "AI conversations", type: "number", value: "5000", required: true },
          { name: "price", label: `Price in ${mkt} (before VAT)`, type: "number", value: "3600", required: true },
          { name: "for", label: "For", type: "select", options: ["Starter and Growth", "Growth and Business", "Business", "All plans"] },
        ]}
        onSubmit={(v) => {
          const size = Number(v.size);
          if (!(size > 0)) return { error: "Enter a number of AI conversations above 0." };
          setPacks([...packs, [`${size.toLocaleString("en-US")} AI conversations`, v.for, Number(v.price), false]]);
          return `New pack added as a draft for the ${mkt} market.`;
        }}
      />
      <FormDialog
        open={dlg.is("plan")}
        title="New plan"
        description="Starts as a draft copied from an existing plan"
        confirm="Create draft"
        onClose={dlg.close}
        fields={[
          { name: "name", label: "Plan name", value: "Growth Plus", required: true },
          { name: "from", label: "Copy features from", type: "select", options: PLAN_KEYS.map((k) => PLAN_NAMES[k]), value: "Growth" },
          { name: "price", label: `Monthly price in ${mkt} (before VAT)`, type: "number", value: "1299" },
          { name: "billing", label: "Billing", type: "select", options: ["Monthly or yearly", "Monthly", "Yearly contract, invoiced"] },
        ]}
        onSubmit={(v) => `${v.name} saved as a draft. Nothing changes for subscribers yet.`}
      />
      <FormDialog
        open={dlg.is("publish")}
        title="Publish plan changes?"
        description="Every publish is saved in the plan history and shown on the Pricing page and in Plan and usage."
        confirm="Publish"
        onClose={dlg.close}
        fields={[]}
        onSubmit={() => `Plan changes published. ${APPLY[who][0]}.`}
      >
        <fieldset className="col gap-8">
          <legend className="label">Who gets the changes</legend>
          {APPLY.map(([l, d], i) => (
            <label key={l} className="row top gap-8">
              <input type="radio" name="who" checked={who === i} onChange={() => setWho(i)} />
              <span className="col gap-0">
                <span className="sm b">{l}</span>
                <span className="xs muted">{d}</span>
              </span>
            </label>
          ))}
          <span className="xs muted">Changes made just for one organization stay in place.</span>
        </fieldset>
      </FormDialog>
    </>
  );
}
