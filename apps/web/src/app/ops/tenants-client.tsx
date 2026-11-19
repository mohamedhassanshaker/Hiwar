"use client";

import { useState, type ReactNode } from "react";

import { Dialog } from "@/components/dialog";
import { DataTable, FormDialog, SampleNote, Seg, Status, Switch, Tabs, useDialog } from "@/components/mock";
import { toast } from "@/components/toast";
import { FEATURES, INDUSTRIES, MARKETS, PLAN_KEYS, PLAN_NAMES, TEMPLATE_KINDS, TEMPLATES, TENANTS, type PlanKey, type Tenant } from "@/mock/tenants";

const TAKEN = ["gulf-bites", "desert-bank", "oasis-clinics"];
const STATE_TONE = { Active: "ok", Trial: "ai", Overdue: "warn", "Read-only": "bad" } as const;

function planText(v: string | boolean, unit: string) {
  if (v === false) return "Off";
  if (v === true) return "Included";
  return /^[\d,]+$/.test(v) && unit ? `${v} ${unit}` : v;
}

/** Feature table for one plan with per-organization changes (OPS-005 FR-004 to FR-006). */
function FeatureTable({ plan, over, setOver, limits, used }: { plan: PlanKey; over: Record<string, boolean>; setOver: (o: Record<string, boolean>) => void; limits: Record<string, [string, string]>; used: Record<string, string> }) {
  const pi = PLAN_KEYS.indexOf(plan);
  const groups = [...new Set(FEATURES.map((f) => f.group))];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Plan gives</th>
            <th scope="col">This organization</th>
            <th scope="col">Use now</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={g}>
              <th colSpan={4} scope="colgroup" className="xs muted">{g}</th>
            </tr>,
            ...FEATURES.filter((f) => f.group === g).map((f) => {
              const base = f.plan[pi];
              const on0 = base !== false;
              const on = over[f.key] ?? on0;
              const lim = limits[f.key];
              const changed = on !== on0 || !!lim;
              return (
                <tr key={f.key}>
                  <td>
                    <div className="b">{f.name}</div>
                    <div className="xs muted">{f.desc}</div>
                  </td>
                  <td className="sm">{planText(base, f.unit)}</td>
                  <td>
                    <div className="row gap-8">
                      {f.kind !== "lim" && <Switch on={on} label={f.name} disabled={f.locked} onChange={(v) => setOver({ ...over, [f.key]: v })} />}
                      {f.kind !== "sw" && <input className="input" style={{ width: 140 }} aria-label={`${f.name} limit for this organization`} defaultValue={lim ? lim[0] : typeof base === "string" ? base : ""} disabled={!on} />}
                      {changed && <span className="badge ai">{lim ? lim[1] : "Changed"}</span>}
                    </div>
                  </td>
                  <td className="sm">{used[f.key] ?? "—"}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function counts(plan: PlanKey, over: Record<string, boolean>, limits: Record<string, unknown>) {
  const pi = PLAN_KEYS.indexOf(plan);
  let on = 0;
  let ch = 0;
  for (const f of FEATURES) {
    const on0 = f.plan[pi] !== false;
    const v = over[f.key] ?? on0;
    if (v) on++;
    if (v !== on0 || limits[f.key]) ch++;
  }
  return { on, ch };
}

function Wizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("Bright Smile Dental");
  const [email, setEmail] = useState("owner@brightsmile.ae");
  const [route, setRoute] = useState("bright-smile");
  const [industry, setIndustry] = useState(INDUSTRIES[2]);
  const [region, setRegion] = useState("UAE");
  const [data, setData] = useState("Shared (separated by row)");
  const [plan, setPlan] = useState<PlanKey>("growth");
  const [over, setOver] = useState<Record<string, boolean>>({});
  const [template, setTemplate] = useState(TEMPLATES[2].name);
  const taken = TAKEN.includes(route);
  const badRoute = !/^[a-z0-9-]{3,40}$/.test(route);
  const c = counts(plan, over, {});
  const STEPS = ["Details", "Plan and features", "Starter agent", "Review"];
  const close = () => {
    setStep(0);
    onClose();
  };
  const summary: [string, string, number][] = [
    ["Name and industry", `${name} · ${industry}`, 0],
    ["Owner", email, 0],
    ["Workspace address", `${route}.hiwar.app`, 0],
    ["Region and data", `${region} · ${data}`, 0],
    ["Plan and features", `${PLAN_NAMES[plan]} · ${c.on} features on${c.ch ? ` · ${c.ch} changed from plan` : ""}`, 1],
    ["Starter agent", template, 2],
  ];
  return (
    <Dialog
      open={open}
      title="Create an organization"
      description={`Step ${step + 1} of 4 · ${STEPS[step]}`}
      onClose={close}
      footer={
        <>
          {step > 0 ? (
            <button className="btn outline" onClick={() => setStep(step - 1)}>Back</button>
          ) : (
            <button className="btn outline" onClick={close}>Cancel</button>
          )}
          {step < 3 ? (
            <button className="btn" disabled={step === 0 && (taken || badRoute || !name.trim() || !email.includes("@"))} onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                close();
                toast(`${name} is set up at ${route}.hiwar.app on the ${PLAN_NAMES[plan]} plan. The Owner invitation was sent.`);
              }}
            >
              Create organization
            </button>
          )}
        </>
      }
    >
      <nav aria-label="Setup steps" className="steps-nav">
        {STEPS.map((l, i) => (
          <button key={l} className={i === step ? "chip on" : i < step ? "chip done" : "chip"} aria-current={i === step ? "step" : undefined} onClick={() => !taken && !badRoute && setStep(i)}>
            {i < step ? "✓" : i + 1} {l}
          </button>
        ))}
      </nav>
      {step === 0 && (
        <>
          <div className="field">
            <label className="label" htmlFor="wz-n">Name</label>
            <input id="wz-n" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="wz-e">Owner’s email</label>
            <input id="wz-e" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <span className="hint">We email the Owner an invitation to set up the organization.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="wz-i">Industry</label>
            <select id="wz-i" className="select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {INDUSTRIES.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="wz-r">Workspace address</label>
            <div className="row nw gap-4">
              <input id="wz-r" className="input" value={route} aria-invalid={taken || badRoute} aria-describedby="wz-r-h" onChange={(e) => setRoute(e.target.value.toLowerCase())} />
              <span className="sm muted">.hiwar.app</span>
            </div>
            <span id="wz-r-h" className={taken || badRoute ? "hint err" : "hint"}>
              {taken ? `${route}.hiwar.app is already used by another organization. Try ${route}-uae.` : badRoute ? "Use 3 to 40 lowercase letters, numbers and dashes." : "Available · lowercase letters, numbers and dashes only. Staff sign in at this address."}
            </span>
          </div>
          <div className="grid g3">
            <div className="field">
              <label className="label" htmlFor="wz-rg">Region</label>
              <select id="wz-rg" className="select" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option>UAE</option>
                <option>KSA</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="wz-d">Data separation</label>
              <select id="wz-d" className="select" value={data} onChange={(e) => setData(e.target.value)}>
                <option>Shared (separated by row)</option>
                <option>Own schema</option>
                <option>Own database</option>
              </select>
            </div>
          </div>
        </>
      )}
      {step === 1 && (
        <>
          <div className="row between">
            <Seg label="Plan" options={PLAN_KEYS.map((k) => [k, PLAN_NAMES[k]] as const)} value={plan} onChange={(p) => { setPlan(p); setOver({}); }} />
            <span className="sm">
              {c.on} of {FEATURES.length} features on{c.ch ? ` · ${c.ch} changed from plan` : ""}
            </span>
          </div>
          <FeatureTable plan={plan} over={over} setOver={setOver} limits={{}} used={{}} />
          <button className="btn ghost sm" onClick={() => setOver({})}>Reset to the {PLAN_NAMES[plan]} plan</button>
        </>
      )}
      {step === 2 && (
        <fieldset className="col gap-8">
          <legend className="label">Start the organization with an agent template</legend>
          {[...TEMPLATES.map((t) => t.name), "No starter agent"].map((t) => (
            <label key={t} className="row gap-8">
              <input type="radio" name="tpl" checked={template === t} onChange={() => setTemplate(t)} />
              {t}
            </label>
          ))}
          <span className="hint">The template becomes a draft agent the Owner can edit before publishing.</span>
        </fieldset>
      )}
      {step === 3 && (
        <>
          {summary.map(([k, v, s]) => (
            <div key={k} className="row between">
              <div className="col gap-0">
                <span className="xs muted">{k}</span>
                <span className="sm">{v}</span>
              </div>
              <button className="btn ghost sm" onClick={() => setStep(s)}>Edit</button>
            </div>
          ))}
          <div className="card soft">
            <div className="card-c sm">
              <span className="b">Set up automatically</span>
              <ul>
                <li>Organization record with row-level separation{data !== "Shared (separated by row)" ? ` (${data.toLowerCase()})` : ""}</li>
                <li>File storage folder and knowledge vector namespace</li>
                <li>Owner role and the five team roles</li>
                <li>{PLAN_NAMES[plan]} allowance and the base safety rules</li>
                <li>Owner invitation to {email}</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** O-Tenants functions that need no backend: tabs, wizard, plan and features, temporary change, grace (OPS-005). */
export function TenantsClient({ realList }: { realList: ReactNode }) {
  const [tab, setTab] = useState<"orgs" | "samples" | "templates" | "global" | "tax">("orgs");
  const [wizard, setWizard] = useState(false);
  const dlg = useDialog<"features" | "temp" | "grace">();
  const [plan, setPlan] = useState<PlanKey>("growth");
  const [over, setOver] = useState<Record<string, boolean>>({});
  const [states, setStates] = useState<Record<string, string>>({});
  const [kind, setKind] = useState("All");
  const [sel, setSel] = useState(TEMPLATES[0].id);
  const [published, setPublished] = useState<Record<string, boolean>>({});
  const t = dlg.ctx<Tenant>() ?? TENANTS[0];
  const tpl = TEMPLATES.find((x) => x.id === sel) ?? TEMPLATES[0];
  const c = counts(plan, over, plan === t.plan ? t.limits : {});

  return (
    <>
      <div className="row between">
        <Tabs
          label="Organization views"
          value={tab}
          onChange={setTab}
          tabs={[
            ["orgs", "All organizations"],
            ["samples", "Plans and grace"],
            ["templates", "Agent templates"],
            ["global", "Global defaults"],
            ["tax", "Tax by market"],
          ]}
        />
        <button className="btn" onClick={() => setWizard(true)}>
          <i className="i i-plus" /> Create organization
        </button>
      </div>
      {tab === "orgs" && realList}
      {tab === "samples" && (
        <>
          <SampleNote />
          <DataTable
            rows={TENANTS}
            noun="organizations"
            rowKey={(r) => r.name}
            filters={[
              { label: "Region", options: ["UAE", "KSA"], value: (r) => r.region },
              { label: "Plan", options: PLAN_KEYS.map((k) => PLAN_NAMES[k]), value: (r) => PLAN_NAMES[r.plan] },
            ]}
            columns={[
              { key: "n", label: "Organization", text: (r) => r.name, render: (r) => <button className="row-link" onClick={() => { setPlan(r.plan); setOver({}); dlg.show("features", r); }}>{r.name}</button> },
              { key: "i", label: "Industry", text: (r) => r.industry, render: (r) => r.industry },
              { key: "d", label: "Data", text: (r) => r.data, render: (r) => r.data },
              { key: "r", label: "Region", text: (r) => r.region, render: (r) => r.region },
              { key: "p", label: "Plan", text: (r) => PLAN_NAMES[r.plan], render: (r) => PLAN_NAMES[r.plan] },
              {
                key: "s",
                label: "Billing state",
                text: (r) => states[r.id] ?? r.state,
                render: (r) => {
                  const s = (states[r.id] ?? r.state) as Tenant["state"];
                  return (
                    <div className="col gap-0">
                      <Status tone={STATE_TONE[s]}>{s}</Status>
                      <span className="xs muted">{states[r.id] ? "Grace extended to 30 Nov" : r.detail}</span>
                    </div>
                  );
                },
              },
            ]}
            actions={[
              { label: "Plan and features", run: (r) => { setPlan(r.plan); setOver({}); dlg.show("features", r); } },
              { label: "Add temporary change", run: (r) => dlg.show("temp", r) },
              { label: "Extend grace period", run: (r) => dlg.show("grace", r), hidden: (r) => r.state !== "Overdue" && r.state !== "Read-only" },
            ]}
          />
          <p className="sm muted">Unpaid organizations have a 30-day grace period with full use, then move to read-only automatically: people can sign in and export, but widgets show the offline message and no AI conversations are spent.</p>
        </>
      )}
      {tab === "templates" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Agent templates</h2>
                <p className="card-d">Starter agents Hiwar publishes and versions. Organizations copy one when they create an agent.</p>
              </div>
              <Seg label="Template kind" options={TEMPLATE_KINDS.map((k) => [k, k] as const)} value={kind} onChange={setKind} />
            </div>
            <div className="card-c">
              {TEMPLATES.filter((x) => kind === "All" || x.kind === kind).map((x) => {
                const draft = published[x.id] ? "" : x.draft;
                return (
                  <div key={x.id} className="row between">
                    <div className="col gap-0">
                      <span className="b">{x.name}</span>
                      <span className="xs muted">{x.kind} · {published[x.id] ? x.draft : x.live} live · {x.size} · used by {x.used}</span>
                    </div>
                    <div className="row gap-4">
                      {draft && <span className="badge warning">{draft} draft</span>}
                      <button className="btn ghost sm" onClick={() => setSel(x.id)}>See changes</button>
                      {draft && (
                        <button
                          className="btn outline sm"
                          onClick={() => {
                            setPublished({ ...published, [x.id]: true });
                            toast(`${x.name} ${x.draft} published. Organizations that use it were told by email; their own changes are kept.`);
                          }}
                        >
                          Publish {draft}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card-f">
              <span className="sm muted grow">Start a template from an existing agent, or a new version from the live one.</span>
              <button className="btn outline sm" onClick={() => dlg.show("temp", { name: "__template" })}>New template</button>
            </div>
          </section>
          <aside className="card">
            <div className="card-h">
              <div className="t">
                <span className="xs muted">What changed</span>
                <h3 className="card-t">{tpl.name} · {tpl.live} to {tpl.draft || tpl.live}</h3>
              </div>
            </div>
            <div className="card-c">
              {tpl.diff.length === 0 ? (
                <p className="sm muted">No draft version yet. Start a new version to make changes.</p>
              ) : (
                tpl.diff.map(([s, a, b]) => (
                  <div key={a} className="row top gap-8">
                    <span className={`badge ${s === "Added" ? "success" : s === "Changed" ? "warning" : "danger"}`}>{s}</span>
                    <div className="col gap-0">
                      <span className="sm">{a}</span>
                      <span className="xs muted">{b}</span>
                    </div>
                  </div>
                ))
              )}
              <p className="xs muted">Organizations that copied a template are told about a new version by email and choose whether to apply it to their draft agent. Their own instructions, knowledge and tools are kept.</p>
            </div>
          </aside>
        </div>
      )}
      {tab === "global" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Global defaults</h2>
                <p className="card-d">Defaults and floors every organization starts from</p>
              </div>
            </div>
            <div className="card-c">
              <div className="row between">
                <div className="col gap-0">
                  <span className="b">Base safety rules</span>
                  <span className="xs muted">Card numbers redacted, prompt-injection guard, no medical or legal advice · organizations can only add stricter rules</span>
                </div>
                <span className="badge">v19</span>
              </div>
              <div className="row between">
                <div className="col gap-0">
                  <span className="b">Built-in tools</span>
                  <span className="xs muted">capture_lead, request_person, send_transcript · available to every agent</span>
                </div>
                <span className="badge">3 tools</span>
              </div>
              <div className="row between">
                <div className="col gap-0">
                  <span className="b">Default widget texts</span>
                  <span className="xs muted">Greeting, offline message and handover messages in English and Arabic</span>
                </div>
                <button className="btn outline sm" onClick={() => toast("Widget texts v4 published. New deployments use them; existing ones keep their own texts.")}>Publish v4</button>
              </div>
            </div>
          </section>
          <aside className="card soft">
            <div className="card-c">
              <span className="b">Floors, not ceilings</span>
              <span className="sm">Organization settings can make these stricter, never looser. For example, an agent never repeats a card number a visitor typed.</span>
            </div>
          </aside>
        </div>
      )}
      {tab === "tax" && (
        <div className="grid g2">
          <section className="card">
            <div className="card-h">
              <div className="t">
                <h2 className="card-t">Tax setup · United Arab Emirates</h2>
                <p className="card-d">Every invoice for this market carries 5% VAT and the platform tax registration number.</p>
              </div>
              <Status tone="ok">Live</Status>
            </div>
            <div className="card-c">
              <div className="grid g3">
                <div className="field">
                  <label className="label" htmlFor="vr">VAT rate</label>
                  <input id="vr" className="input" defaultValue="5%" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="trn">Platform tax registration number</label>
                  <input id="trn" className="input" defaultValue="100xxxxxxxxxxx3" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="einv">E-invoicing</label>
                  <select id="einv" className="select">
                    <option>Not required yet</option>
                    <option>Connected · test</option>
                  </select>
                </div>
              </div>
              <div className="row between">
                <span className="sm muted">Add a new rate with a start date. Invoices from that date use the new rate; earlier invoices don’t change.</span>
                <button className="btn outline sm" onClick={() => dlg.show("temp", { name: "__rate" })}>Add rate change</button>
              </div>
            </div>
            <div className="card-f">
              <button className="btn outline" onClick={() => toast("Test invoice sent to your email.")}>Send test invoice</button>
              <button className="btn" onClick={() => toast("UAE tax setup saved.")}>Save changes</button>
            </div>
          </section>
          <aside className="card">
            <div className="card-h">
              <h3 className="card-t">Markets</h3>
            </div>
            <div className="card-c">
              {MARKETS.map((m) => (
                <div key={m.name} className="row between sm">
                  <span>{m.name} · {m.currency} · VAT {m.vat}</span>
                  <Status tone="ok">{m.state}</Status>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      <Wizard open={wizard} onClose={() => setWizard(false)} />
      <Dialog
        open={dlg.is("features")}
        title={`Plan and features · ${t.name}`}
        description={`${t.industry} · ${t.region}`}
        onClose={dlg.close}
        footer={
          <>
            <button className="btn outline" onClick={dlg.close}>Cancel</button>
            <button className="btn" onClick={() => { dlg.close(); toast(`Plan and features saved for ${t.name}. Their Owner was told by email.`); }}>Save changes</button>
          </>
        }
      >
        <div className="row between">
          <Seg label="Plan" options={PLAN_KEYS.map((k) => [k, PLAN_NAMES[k]] as const)} value={plan} onChange={(p) => { setPlan(p); setOver({}); }} />
          <span className="sm">{c.on} of {FEATURES.length} features on{c.ch ? ` · ${c.ch} changed from plan` : ""}</span>
          <button className="btn ghost sm" onClick={() => dlg.show("temp", t)}>Add temporary change</button>
        </div>
        <p className="xs muted">Changing the plan applies at once; the next invoice is adjusted.</p>
        <FeatureTable plan={plan} over={over} setOver={setOver} limits={plan === t.plan ? t.limits : {}} used={t.used} />
        <p className="xs muted">Features you turn off disappear for members right away; their data is kept. Lower limits stop new use only. The Owner is told by email.</p>
      </Dialog>
      <FormDialog
        open={dlg.is("temp")}
        title={t.name === "__rate" ? "Add a tax rate change" : t.name === "__template" ? "New agent template" : `Temporary change · ${t.name}`}
        description={t.name === "__rate" ? "Invoices from the start date use the new rate" : t.name === "__template" ? "Copies an agent's instructions, tools and knowledge starters into a draft template" : "Applies until the end date, then the plan’s limits return"}
        confirm={t.name === "__rate" ? "Add" : t.name === "__template" ? "Create draft" : "Add change"}
        onClose={dlg.close}
        fields={
          t.name === "__rate"
            ? [
                { name: "rate", label: "Rate", value: "5%", required: true },
                { name: "from", label: "Start date", type: "date", value: "2027-01-01", required: true },
              ]
            : t.name === "__template"
              ? [
                  { name: "name", label: "Name", value: "Hotel reservations", required: true },
                  { name: "kind", label: "Kind", type: "select", options: TEMPLATE_KINDS.slice(1), value: "Bookings" },
                  { name: "from", label: "Copy from agent", value: "Gulf Bites · Order helper" },
                ]
              : [
                  { name: "feature", label: "Feature", type: "select", options: ["AI conversations per month", "Team members", "Knowledge storage", "Deployments", "Advanced model tier"] },
                  { name: "extra", label: "Extra on top of the plan", value: "+500 AI conversations per month", required: true },
                  { name: "end", label: "End date", type: "date", value: "2026-12-31", required: true },
                  { name: "reason", label: "Reason (logged)", value: "Ramadan campaign pilot", required: true },
                ]
        }
        onSubmit={(v) =>
          t.name === "__rate"
            ? `Rate change to ${v.rate} scheduled from ${v.from}.`
            : t.name === "__template"
              ? `${v.name} created as a draft template.`
              : `Temporary change added for ${t.name} until ${v.end}. The plan’s limit comes back after that.`
        }
      />
      <FormDialog
        open={dlg.is("grace")}
        title={`Extend the grace period for ${t.name}?`}
        description={t.state === "Read-only" ? "Read-only since the 30-day grace period ended. Members can sign in and export, but widgets are offline." : `Overdue · ${t.detail}. Full use continues until the grace period ends.`}
        confirm="Extend grace period"
        onClose={dlg.close}
        fields={[
          { name: "end", label: "New end of grace period", type: "date", value: "2026-11-30", required: true },
          { name: "reason", label: "Reason (required, logged)", type: "textarea", value: "Purchase order approved by the Owner; payment expected by bank transfer this month.", required: true },
        ]}
        onSubmit={(v) => {
          setStates({ ...states, [t.id]: "Overdue" });
          return `${t.name}: grace period extended to ${v.end} with your reason logged. Full use is back.`;
        }}
      >
        <p className="sm muted">Full use returns until the new date. If the invoice is still unpaid then, the organization moves to read-only again automatically.</p>
      </FormDialog>
    </>
  );
}
