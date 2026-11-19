"use client";

import Link from "next/link";
import { useState } from "react";

import { DataTable, FormDialog, PageHead, SampleNote, Seg, Status, Switch, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";

type Page = { n: string; d: string; url: string; s: string; tone: "ok" | "ai" | "mut"; lang: string; w: string };
const PAGES: Page[] = [
  { n: "Home", d: "Main landing page for every visitor", url: "/", s: "Published", tone: "ok", lang: "English, Arabic", w: "5 Nov · Lina Haddad" },
  { n: "Pricing", d: "Plans, AI conversations, overage and the trial", url: "/pricing", s: "Scheduled · 1 Dec", tone: "ai", lang: "English, Arabic", w: "New prices from 1 Dec · Tariq Saeed" },
  { n: "Brand", d: "Logo, colours and naming for press and partners", url: "/brand", s: "Published", tone: "ok", lang: "English, Arabic", w: "20 Oct · Lina Haddad" },
  { n: "For restaurants", d: "Orders, bookings and menu questions", url: "/restaurants", s: "Published", tone: "ok", lang: "English, Arabic", w: "2 Nov · Lina Haddad" },
  { n: "For clinics", d: "Appointments with sensitive-topic handover", url: "/clinics", s: "Published", tone: "ok", lang: "English, Arabic", w: "28 Oct · Lina Haddad" },
  { n: "For e-commerce", d: "Order status, returns and tool approval", url: "/ecommerce", s: "Draft", tone: "mut", lang: "Arabic missing", w: "6 Nov · Lina Haddad" },
];
const BLOCKS: [string, string, boolean][] = [
  ["Offer banner", "Banner", true],
  ["Hero", "Hero", false],
  ["How it works", "Steps", false],
  ["Live inbox and handover", "Feature list", false],
  ["Customer stories", "Customer list", false],
  ["Simple plans", "Plans", true],
  ["What counts as an AI conversation", "Feature list", false],
  ["Why businesses trust it", "Feature list", false],
  ["Questions", "FAQ", false],
];
const TEXT: Record<string, { en: string[]; ar: string[] }> = {
  Banner: { en: ["New here? 20% off your first Growth month with WELCOME20", "", "See plans", ""], ar: ["جديد هنا؟ خصم ٢٠٪ على أول شهر في خطة النمو مع الرمز WELCOME20", "", "شاهد الخطط", ""] },
  Hero: {
    en: ["AI agents that answer your website visitors, and hand over to your team.", "Build an agent from your own knowledge, install it in minutes, and watch every conversation live.", "Start free", "See plans and prices"],
    ar: ["وكلاء ذكاء اصطناعي يجيبون زوار موقعك، ويسلّمون المحادثة لفريقك.", "ابنِ وكيلًا من معرفتك، وثبّته في دقائق، وتابع كل محادثة مباشرة.", "ابدأ مجانًا", "الأسعار والخطط"],
  },
};
type Feat = { n: string; t: string; w: string; l: string; d: string; v: string; s: string };
const FEATS: Feat[] = [
  { n: "Gulf Bites Restaurants", t: "Customer story · Dubai", w: "Home · customer row", l: "Customer story", d: "1–30 Nov", v: "14,200", s: "96 sign-ups" },
  { n: "Oasis Clinics", t: "Customer story · Abu Dhabi", w: "For clinics · top", l: "Customer story", d: "1–14 Nov", v: "6,850", s: "41 sign-ups" },
  { n: "Restaurant orders and bookings", t: "Agent template", w: "Home · template row", l: "Editor’s pick", d: "Ongoing", v: "11,300", s: "318 sign-ups" },
  { n: "E-commerce order status", t: "Agent template", w: "For e-commerce · top", l: "Editor’s pick", d: "Ongoing", v: "6,050", s: "157 sign-ups" },
];
type Code = { c: string; g: string; pl: string; u: string; e: string; s: string };
const CODES: Code[] = [
  { c: "WELCOME20", g: "20% off the first Growth month", pl: "Website banner · Pricing", u: "1,240 of 5,000", e: "31 Jan 2027", s: "Active" },
  { c: "PILOT60", g: "60 days of Business for new agencies", pl: "For agencies", u: "14 of 30", e: "31 Dec 2026", s: "Active" },
  { c: "KSA-LAUNCH", g: "10% off for Saudi businesses", pl: "KSA campaign", u: "6 · no limit", e: "No end date", s: "Active" },
  { c: "RAMADAN27", g: "15% off Growth yearly", pl: "Scheduled banner · from 20 Feb 2027", u: "0 of 2,000", e: "20 Mar 2027", s: "Scheduled" },
];

/** O-CMS (OPS-007): public website pages, featured items, offers and results. Sample data. */
export default function WebsitePage() {
  const [tab, setTab] = useState<"pages" | "feat" | "offers" | "res">("pages");
  const [editing, setEditing] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [order, setOrder] = useState(BLOCKS.map((_, i) => i));
  const [hidden, setHidden] = useState<Record<number, boolean>>({});
  const [sel, setSel] = useState(1);
  const [size, setSize] = useState<"desktop" | "phone">("desktop");
  const [arMissing, setArMissing] = useState(false);
  const [ended, setEnded] = useState<string[]>([]);
  const dlg = useDialog<"page" | "block" | "sched" | "hist" | "feat" | "code">();
  const cur = BLOCKS[order[sel]];
  const tx = TEXT[cur[1]]?.[lang] ?? (lang === "ar" ? [cur[0], "", "ابدأ الآن", "اعرف المزيد"] : [cur[0], "Section text shown under the heading.", "See more", ""]);
  const swap = (d: number) => {
    const j = sel + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[sel], o[j]] = [o[j], o[sel]];
    setOrder(o);
    setSel(j);
  };

  return (
    <>
      <PageHead title="Website" lead="Pages of hiwar.app in English and Arabic, featured items, offers and what the site brings in.">
        <Tabs label="Website sections" value={tab} onChange={setTab} tabs={[["pages", "Pages"], ["feat", "Featured items"], ["offers", "Offers and coupons"], ["res", "Results"]]} />
        <Link className="btn outline" href="/" target="_blank">
          <i className="i i-external" /> Open website
        </Link>
      </PageHead>
      <SampleNote />

      {tab === "pages" && !editing && (
        <section className="card">
          <div className="card-h">
            <div className="t">
              <h2 className="card-t">Pages</h2>
              <p className="card-d">Every page has an English and an Arabic version. Missing Arabic is flagged.</p>
            </div>
            <button className="btn" onClick={() => dlg.show("page")}>
              <i className="i i-plus" /> New page
            </button>
          </div>
          <div className="card-c">
            <DataTable
              rows={PAGES}
              noun="pages"
              rowKey={(r) => r.n}
              columns={[
                { key: "n", label: "Page", text: (r) => r.n, render: (r) => <div className="col gap-0"><button className="row-link" onClick={() => setEditing(r.n)}>{r.n}</button><span className="xs muted">{r.d}</span></div> },
                { key: "u", label: "Address", text: (r) => r.url, render: (r) => <span className="mono sm">{r.url}</span> },
                { key: "s", label: "Status", text: (r) => r.s, render: (r) => <Status tone={r.tone}>{r.s}</Status> },
                { key: "l", label: "Languages", text: (r) => r.lang, render: (r) => <span className={r.lang.includes("missing") ? "sm b" : "sm"}>{r.lang}</span> },
                { key: "w", label: "Last change", text: (r) => r.w, render: (r) => <span className="sm muted">{r.w}</span> },
              ]}
              actions={[{ label: "Edit", run: (r) => setEditing(r.n) }]}
            />
          </div>
        </section>
      )}

      {tab === "pages" && editing && (
        <>
          <div className="row between">
            <div className="row gap-8">
              <button className="btn ghost sm" onClick={() => setEditing(null)}>
                <i className="i i-chev-l" /> All pages
              </button>
              <span className="b">{editing}</span>
              <Status tone="ok">Published</Status>
              <span className="badge warning">Unpublished changes</span>
            </div>
            <div className="row gap-8">
              <label className="row gap-4 sm">
                <input type="checkbox" checked={arMissing} onChange={(e) => setArMissing(e.target.checked)} /> Show the missing-Arabic state
              </label>
              <Seg label="Language being edited" options={[["en", "English"], ["ar", "العربية"]] as const} value={lang} onChange={setLang} />
            </div>
          </div>
          {arMissing && (
            <div className="alert warning row between" role="alert">
              <div className="col gap-0">
                <span className="b">The “Customer stories” section has no Arabic text yet</span>
                <span className="sm">You can publish, but Arabic visitors won’t see this section until it’s translated.</span>
              </div>
              <button className="btn outline sm" onClick={() => { setArMissing(false); toast("Arabic draft added. Check it before you publish."); }}>Draft Arabic with AI</button>
            </div>
          )}
          <div className="grid g3">
            <section className="card">
              <div className="card-h">
                <div className="t">
                  <h3 className="card-t">Sections</h3>
                  <p className="card-d">Select a section, then move it with the arrows</p>
                </div>
              </div>
              <div className="card-c">
                {order.map((bi, pos) => (
                  <div key={bi} className="row between">
                    <button className={pos === sel ? "chip on" : "chip"} onClick={() => setSel(pos)}>
                      {BLOCKS[bi][0]} {BLOCKS[bi][2] && <span className="badge secondary">Coupon</span>}
                    </button>
                    <Switch on={!hidden[bi]} label={`Show ${BLOCKS[bi][0]}`} onChange={(v) => setHidden({ ...hidden, [bi]: !v })} />
                  </div>
                ))}
                <button className="btn ghost sm" onClick={() => dlg.show("block")}>
                  <i className="i i-plus" /> Add section
                </button>
              </div>
            </section>
            <section className="card">
              <div className="card-h">
                <div className="t">
                  <span className="xs muted">{cur[1]}</span>
                  <h3 className="card-t">{cur[0]}</h3>
                </div>
                <div className="row gap-4">
                  <button className="btn ghost sm" aria-label="Move section up" onClick={() => swap(-1)}><i className="i i-arrow-up" /></button>
                  <button className="btn ghost sm" aria-label="Move section down" onClick={() => swap(1)}><i className="i i-arrow-down" /></button>
                </div>
              </div>
              <div className="card-c" key={`${cur[0]}-${lang}`}>
                <div className="field">
                  <label className="label" htmlFor="bh">Headline</label>
                  <input id="bh" className="input" dir={lang === "ar" ? "rtl" : "ltr"} defaultValue={tx[0]} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="bt">Text</label>
                  <textarea id="bt" className="textarea" dir={lang === "ar" ? "rtl" : "ltr"} defaultValue={tx[1]} />
                </div>
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="b1">Main button</label>
                    <input id="b1" className="input" dir={lang === "ar" ? "rtl" : "ltr"} defaultValue={tx[2]} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="b1l">Goes to</label>
                    <select id="b1l" className="select"><option>Sign up (start free)</option><option>Pricing</option><option>Book a demo form</option></select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="b2">Second button</label>
                    <input id="b2" className="input" dir={lang === "ar" ? "rtl" : "ltr"} defaultValue={tx[3]} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="b2l">Goes to</label>
                    <select id="b2l" className="select"><option>Pricing</option><option>Agent templates</option></select>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="bs">Content source</label>
                  <select id="bs" className="select"><option>{cur[1] === "Customer list" || cur[1] === "Plans" ? "Live data · featured items labelled" : "Written here"}</option><option>Picked by hand</option></select>
                  <span className="hint">Plans and prices come from live data, so the page is always current.</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="ba">Show to</label>
                  <select id="ba" className="select"><option>Everyone</option><option>Visitors in Saudi Arabia</option><option>Visitors who haven’t signed up</option></select>
                </div>
              </div>
            </section>
            <aside className="card">
              <div className="card-h">
                <h3 className="card-t">Preview</h3>
                <Seg label="Preview size" options={[["desktop", "Desktop"], ["phone", "Phone"]] as const} value={size} onChange={setSize} />
              </div>
              <div className="card-c">
                <div className="card soft" style={{ maxWidth: size === "phone" ? 220 : "100%" }} dir={lang === "ar" ? "rtl" : "ltr"}>
                  <div className="card-c">
                    <span className="b">{tx[0]}</span>
                    <span className="sm">{tx[1]}</span>
                    <div className="row gap-4">
                      {tx[2] && <span className="btn sm">{tx[2]}</span>}
                      {tx[3] && <span className="btn outline sm">{tx[3]}</span>}
                    </div>
                  </div>
                </div>
                <Link href="/" target="_blank" className="sm">Open full preview</Link>
                <span className="xs muted">SEO title: Hiwar · AI agents for your website</span>
              </div>
            </aside>
          </div>
          <div className="row end gap-8">
            <span className="sm muted grow">Every publish is saved in the page history and can be rolled back.</span>
            <button className="btn ghost" onClick={() => dlg.show("hist")}>History</button>
            <button className="btn outline" onClick={() => toast("Draft saved. The live page hasn’t changed.")}>Save draft</button>
            <button className="btn outline" onClick={() => dlg.show("sched")}>Schedule</button>
            <button className="btn" onClick={() => toast(`${editing} published in English and Arabic.`)}>Publish</button>
          </div>
        </>
      )}

      {tab === "feat" && (
        <>
          <div className="grid g4">
            {[["Featured items live", "4", "2 customer stories · 2 editor’s picks"], ["Views · Nov", "38,400", "Labelled on every page"], ["Sign-ups", "612", "From featured items this month"], ["Click to sign-up", "3.1%", "Featured items"]].map(([k, v, d]) => (
              <div key={k} className="card"><div className="card-c"><span className="xs muted">{k}</span><span className="h2">{v}</span><span className="xs muted">{d}</span></div></div>
            ))}
          </div>
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Featured items</h2>
                <p className="card-d">Customer stories and agent templates shown in featured rows. Every item is labelled “Customer story” or “Editor’s pick”.</p>
              </div>
              <button className="btn" onClick={() => dlg.show("feat")}><i className="i i-plus" /> Add featured item</button>
            </div>
            <div className="card-c">
              <DataTable
                rows={FEATS.filter((f) => !ended.includes(f.n))}
                noun="featured items"
                rowKey={(r) => r.n}
                columns={[
                  { key: "n", label: "Item", text: (r) => r.n, render: (r) => <div className="col gap-0"><span className="b">{r.n}</span><span className="xs muted">{r.t}</span></div> },
                  { key: "w", label: "Where", text: (r) => r.w, render: (r) => r.w },
                  { key: "l", label: "Label", text: (r) => r.l, render: (r) => <span className="badge outline">{r.l}</span> },
                  { key: "d", label: "Dates", text: (r) => r.d, render: (r) => r.d },
                  { key: "v", label: "Views", text: (r) => r.v, render: (r) => <span className="tnum">{r.v}</span>, className: "r" },
                  { key: "s", label: "Sign-ups from it", text: (r) => r.s, render: (r) => r.s },
                ]}
                actions={[{ label: "End", run: (r) => { setEnded([...ended, r.n]); toast(`${r.n} is no longer featured.`); } }]}
              />
              <p className="xs muted">Rules for featured items: customer stories need the customer’s written consent; always labelled, one featured item per row.</p>
            </div>
          </section>
        </>
      )}

      {tab === "offers" && (
        <>
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Website banner</h2>
                <p className="card-d">Shown at the top of every public page</p>
              </div>
              <Status tone="ok">Live</Status>
            </div>
            <div className="card-c grid g3">
              <div className="field"><label className="label" htmlFor="ob">Text</label><input id="ob" className="input" defaultValue="New here? 20% off your first Growth month with WELCOME20" /></div>
              <div className="field"><label className="label" htmlFor="ol">Button goes to</label><select id="ol" className="select"><option>Pricing · Growth</option><option>Sign up (start free)</option></select></div>
              <div className="field"><label className="label" htmlFor="od">Dates</label><input id="od" className="input" defaultValue="1 Nov 2026 – 31 Jan 2027" /></div>
            </div>
            <div className="card-f"><button className="btn" onClick={() => toast("Banner saved.")}>Save banner</button></div>
          </section>
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Coupons on pages and campaigns</h2>
                <p className="card-d">Coupons are created only in Subscriptions and billing. Here you place them on pages and campaigns. One discount per order, never below a plan’s minimum price.</p>
              </div>
              <div className="row gap-8">
                <Link className="btn outline" href="/ops/billing">Coupons in billing</Link>
                <button className="btn" onClick={() => dlg.show("code")}><i className="i i-plus" /> Place a coupon</button>
              </div>
            </div>
            <div className="card-c">
              <DataTable
                rows={CODES}
                noun="placed coupons"
                rowKey={(r) => r.c}
                columns={[
                  { key: "c", label: "Code", text: (r) => r.c, render: (r) => <span className="mono b">{r.c}</span> },
                  { key: "g", label: "Gives", text: (r) => r.g, render: (r) => r.g },
                  { key: "p", label: "Placed on", text: (r) => r.pl, render: (r) => r.pl },
                  { key: "u", label: "Used", text: (r) => r.u, render: (r) => r.u },
                  { key: "e", label: "Ends", text: (r) => r.e, render: (r) => r.e },
                  { key: "s", label: "Status", text: (r) => r.s, render: (r) => ended.includes(r.c) ? <Status tone="mut">Removed from pages</Status> : <Status tone={r.s === "Active" ? "ok" : "ai"}>{r.s}</Status> },
                ]}
                actions={[{ label: "Remove from pages", hidden: (r) => ended.includes(r.c), run: (r) => { setEnded([...ended, r.c]); toast(`${r.c} removed from pages. The coupon itself stays in Subscriptions and billing.`); } }]}
              />
            </div>
          </section>
        </>
      )}

      {tab === "res" && (
        <>
          <div className="grid g4">
            {[["Visitors · October", "48,200", "+12% on September"], ["Sign-ups", "3,140", "6.5% of visitors"], ["Started a trial", "1,020", "32% of sign-ups"], ["Became paying", "412", "40% of trials"]].map(([k, v, d]) => (
              <div key={k} className="card"><div className="card-c"><span className="xs muted">{k}</span><span className="h2">{v}</span><span className="xs muted">{d}</span></div></div>
            ))}
          </div>
          <div className="grid g2">
            <section className="card">
              <div className="card-h"><div className="t"><h2 className="card-t">Money from the website · October</h2><p className="card-d">Subscriptions that started on a public page</p></div></div>
              <div className="card-c">
                {[["Starter and Growth", "AED 96,800", 45], ["Business and Enterprise", "AED 214,000", 100], ["AI conversation packs", "AED 12,300", 6]].map(([n, v, w]) => (
                  <div key={n as string} className="col gap-4">
                    <div className="row between sm"><span>{n}</span><span className="b tnum">{v}</span></div>
                    <div className="progress"><span style={{ width: `${w}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>
            <aside className="card">
              <div className="card-h"><h3 className="card-t">Pages that bring sign-ups</h3></div>
              <div className="card-c">
                {[["Pricing", "1,120 sign-ups"], ["Home", "980"], ["For restaurants", "540"], ["For clinics", "190"], ["Brand", "96 partner requests"]].map(([n, v]) => (
                  <div key={n} className="row between sm"><span>{n}</span><span className="tnum">{v}</span></div>
                ))}
              </div>
            </aside>
          </div>
        </>
      )}

      <FormDialog open={dlg.is("page")} title="New page" description="Starts as a draft" confirm="Create page" onClose={dlg.close}
        fields={[{ name: "n", label: "Page name", value: "For hotels", required: true }, { name: "u", label: "Address", value: "/hotels", required: true }, { name: "t", label: "Start from", type: "select", options: ["Industry page template", "Blank page"] }]}
        onSubmit={(v) => (v.u.startsWith("/") ? "Draft page created." : { error: "The address must start with /." })} />
      <FormDialog open={dlg.is("block")} title="Add a section" description="Added below the selected section" confirm="Add section" onClose={dlg.close}
        fields={[{ name: "t", label: "Section type", type: "select", options: ["Customer quotes (with their consent)", "Feature list", "FAQ", "Steps"] }, { name: "n", label: "Name", value: "What customers say", required: true }]}
        onSubmit={() => "Section added as hidden. Turn it on when it’s ready."} />
      <FormDialog open={dlg.is("sched")} title="Schedule publishing" description="The page changes at this time for everyone" confirm="Schedule" onClose={dlg.close}
        fields={[{ name: "at", label: "Date and time (UAE time)", value: "2026-11-25T06:00", required: true }]}
        onSubmit={(v) => `Scheduled for ${v.at.replace("T", " at ")}.`} />
      <FormDialog open={dlg.is("hist")} title="Page history" description="Roll back to any earlier version" confirm="Roll back to 13" onClose={dlg.close} fields={[]}
        onSubmit={() => "Rolled back to version 13 as a draft."}>
        <div className="col gap-8 sm">
          <div className="row between"><span className="b">Version 14</span><span className="muted">5 Nov · Lina Haddad · new hero text</span></div>
          <div className="row between"><span className="b">Version 13</span><span className="muted">1 Nov · Lina Haddad · added offer banner</span></div>
        </div>
      </FormDialog>
      <FormDialog open={dlg.is("feat")} title="Add a featured item" description="Every item is labelled “Customer story” or “Editor’s pick”" confirm="Add" onClose={dlg.close}
        fields={[{ name: "n", label: "Customer story or agent template", value: "Clinic appointments · agent template", required: true }, { name: "w", label: "Where", value: "Home · template row" }, { name: "l", label: "Label", type: "select", options: ["Editor’s pick", "Customer story"] }, { name: "d", label: "Dates", value: "15–30 Nov" }]}
        onSubmit={(v) => `Added. It shows from ${v.d.split("–")[0]} Nov with an “${v.l}” label.`} />
      <FormDialog open={dlg.is("code")} title="Place a coupon" description="Pick a coupon created in Subscriptions and billing" confirm="Place coupon" onClose={dlg.close}
        fields={[{ name: "c", label: "Coupon", type: "select", options: ["RAMADAN27 · 15% off Growth yearly", "WELCOME20 · 20% off the first Growth month"] }, { name: "p", label: "Place on", value: "Website banner and Pricing" }, { name: "d", label: "Dates", value: "20 Feb – 20 Mar 2027" }]}
        onSubmit={(v) => `${v.c.split(" ")[0]} placed on ${v.p.toLowerCase()} from ${v.d.split(" – ")[0]}.`} />
    </>
  );
}
