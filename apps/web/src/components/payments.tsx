"use client";

import { useState } from "react";

import { Dialog } from "@/components/dialog";
import { FormDialog, SampleNote, Seg, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

type Method = { id: number; mark: string; n: string; d: string };

/**
 * Payment methods and billing details of an organization (Payments board, BIL-002). Sample data:
 * the live card is managed on Plan and usage through the payment provider.
 */
export function Payments({ orgName }: { orgName: string }) {
  const [methods, setMethods] = useState<Method[]>([
    { id: 0, mark: "VISA", n: "Visa ending 4242", d: "Expires 05/28 · subscription, packs and overage" },
    { id: 1, mark: "INV", n: "Bank transfer by invoice", d: "Yearly plans only · pay within 30 days" },
  ]);
  const [def, setDef] = useState(0);
  const [expired, setExpired] = useState(false);
  const [type, setType] = useState<"card" | "bank">("card");
  const [details, setDetails] = useState({ legal: `${orgName} LLC`, trn: "100 2345 6789 0003", addr: "Business Bay, Dubai, UAE", mail: "finance@example.com" });
  const dlg = useDialog<"add" | "remove" | "details">();
  const rm = methods.find((m) => m.id === dlg.ctx<number>());
  return (
    <div className="col gap-16">
      <SampleNote />
      <label className="row gap-4 sm"><input type="checkbox" checked={expired} onChange={(e) => setExpired(e.target.checked)} /> Show the expired default card</label>
      <section className="card">
        <div className="card-h">
          <div className="t"><h2 className="card-t">Payment methods</h2><p className="card-d">How {orgName} pays for its subscription, conversation packs and overage</p></div>
          <button className="btn outline sm" onClick={() => dlg.show("add")}><i className="i i-plus" /> Add payment method</button>
        </div>
        <div className="card-c">
          {expired && (
            <div className="alert danger" role="alert">
              <span className="col gap-0"><span className="b">Your default card has expired</span><span className="sm">Add or replace a card so the month-end invoice doesn’t fail. We try again on day 1, 3 and 7.</span></span>
            </div>
          )}
          {methods.map((m) => {
            const isDef = m.id === def;
            const exp = expired && m.id === 0;
            return (
              <div key={m.id} className="row between">
                <div className="row gap-8">
                  <span className="badge outline mono">{m.mark}</span>
                  <span className="col gap-0"><span className="b sm">{m.n}</span><span className="xs muted">{m.d}</span></span>
                  {isDef && <span className="badge soft">Default</span>}
                  {exp && <span className="badge danger">Expired</span>}
                </div>
                <div className="row gap-4">
                  {!isDef && !exp && <button className="btn ghost sm" onClick={() => { setDef(m.id); toast(`${m.n} is now your default.`); }}>Make default</button>}
                  {exp && <button className="btn outline sm" onClick={() => dlg.show("add")}>Replace</button>}
                  <button className="btn ghost sm" aria-label={`Remove ${m.n}`} onClick={() => dlg.show("remove", m.id)}>Remove</button>
                </div>
              </div>
            );
          })}
          <p className="xs muted"><i className="i i-lock" aria-hidden /> Card details go straight to our payment provider. Hiwar never sees or stores your full card number.</p>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h3 className="card-t">What this pays for</h3></div>
        <div className="card-c sm">
          <span><b>Subscription</b> · monthly or yearly</span>
          <span><b>Conversation packs</b> · AI conversations that last 12 months</span>
          <span><b>Overage</b> · only if turned on · added to the month-end invoice</span>
        </div>
      </section>
      <section className="card">
        <div className="card-h">
          <div className="t"><h3 className="card-t">Billing details</h3><p className="card-d">Printed on every VAT invoice</p></div>
          <button className="btn outline sm" onClick={() => dlg.show("details")}><i className="i i-pencil" /> Edit</button>
        </div>
        <div className="card-c">
          <dl className="kv sm">
            {[["Legal name", details.legal], ["Tax registration number", details.trn], ["Address", details.addr], ["Invoices sent to", details.mail]].map(([k, v]) => (
              <div key={k} className="row between"><dt className="muted">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      <Dialog
        open={dlg.is("add")}
        title="Add payment method"
        description="Card or bank transfer"
        onClose={dlg.close}
        footer={<><button className="btn outline" onClick={dlg.close}>Cancel</button><button className="btn" onClick={() => {
          if (type === "card") {
            const id = Math.max(...methods.map((m) => m.id)) + 1;
            setMethods([...methods, { id, mark: "VISA", n: "Visa ending 1111", d: "Expires 09/29" }]);
            setDef(id);
            setExpired(false);
            toast("Card ending 1111 added and set as default.");
          } else toast("Bank transfer turned on. Invoices go to the billing email.");
          dlg.close();
        }}>Save</button></>}
      >
        <Seg label="Payment type" options={[["card", "Card"], ["bank", "Bank transfer"]] as const} value={type} onChange={setType} />
        {type === "card" ? (
          <>
            <span className="xs muted"><i className="i i-lock" aria-hidden /> Secure form from our payment provider</span>
            <div className="field"><label className="label" htmlFor="cn">Card number</label><input id="cn" className="input" defaultValue="4111 1111 1111 1111" autoComplete="cc-number" /></div>
            <div className="grid g3">
              <div className="field"><label className="label" htmlFor="ce">Expiry</label><input id="ce" className="input" defaultValue="09 / 29" autoComplete="cc-exp" /></div>
              <div className="field"><label className="label" htmlFor="cv">Security code</label><input id="cv" className="input" defaultValue="•••" autoComplete="cc-csc" /></div>
              <div className="field"><label className="label" htmlFor="cnm">Name on card</label><input id="cnm" className="input" defaultValue={details.legal} autoComplete="cc-name" /></div>
            </div>
            <label className="row gap-8 sm"><input type="checkbox" defaultChecked /> Make this my default payment method</label>
          </>
        ) : (
          <>
            <div className="alert info sm">Pay by bank transfer: we send a VAT invoice with our bank details. Pay within 30 days and use the invoice number as the reference. Available on yearly plans.</div>
            <div className="field"><label className="label" htmlFor="fe">Send invoices to</label><input id="fe" className="input" defaultValue={details.mail} /></div>
          </>
        )}
      </Dialog>
      <Dialog
        open={dlg.is("remove")}
        title={dlg.ctx<number>() === def ? "Choose another default first" : "Remove this payment method?"}
        description={dlg.ctx<number>() === def ? "Renewals and the month-end invoice use your default. Make another method the default, then remove this one." : `${rm?.n ?? ""} will be removed. Past payments and invoices aren’t affected.`}
        onClose={dlg.close}
        footer={
          dlg.ctx<number>() === def ? (
            <button className="btn" onClick={dlg.close}>OK</button>
          ) : (
            <>
              <button className="btn outline" onClick={dlg.close}>Cancel</button>
              <button className="btn destructive" onClick={() => { setMethods(methods.filter((m) => m.id !== rm?.id)); dlg.close(); toast("Removed."); }}>Remove</button>
            </>
          )
        }
      />
      <FormDialog
        open={dlg.is("details")}
        title="Billing details"
        description="Changes apply to the next invoice"
        confirm="Save"
        onClose={dlg.close}
        fields={[
          { name: "legal", label: "Legal name", value: details.legal, required: true },
          { name: "trn", label: "Tax registration number", value: details.trn, hint: "15 digits for the UAE" },
          { name: "addr", label: "Address", value: details.addr, required: true },
          { name: "mail", label: "Invoices sent to", type: "email", value: details.mail, required: true },
        ]}
        onSubmit={(v) => {
          if (v.trn && v.trn.replace(/\s/g, "").length !== 15) return { error: "A UAE tax registration number has 15 digits." };
          setDetails({ legal: v.legal, trn: v.trn, addr: v.addr, mail: v.mail });
          return "Billing details saved. They apply to the next invoice.";
        }}
      />
    </div>
  );
}
