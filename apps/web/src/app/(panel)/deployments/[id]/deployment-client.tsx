"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Confirm, Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import type { DeploymentSettings } from "@/db/schema";
import { textOn } from "@/server/contrast";
import { NewDeployment } from "../new-deployment";
import {
  addOriginAction,
  agentAction,
  removeOriginAction,
  rotateAction,
  sendDevAction,
  settingsAction,
  statusAction,
  verifyAction,
} from "../actions";

type Tab = "install" | "origins" | "look" | "behaviour";
const STATUS: Record<string, [string, string]> = { live: ["ok", "Live"], paused: ["warn", "Paused"], draft: ["mut", "Draft"] };

interface Props {
  readOnly: boolean;
  orgOverage: boolean;
  list: { id: string; name: string; status: string; agent: string }[];
  agents: { id: string; name: string }[];
  deployment: {
    id: string;
    name: string;
    status: "draft" | "live" | "paused";
    agentId: string;
    agentName: string;
    agentLive: number | null;
    publicKey: string;
    previousKeyExpiresAt: string | null;
    snippet: string;
    settings: DeploymentSettings;
  };
  origins: { id: string; origin: string; verified: boolean; reason: string | null }[];
  versions: number[];
  tools: { key: string; name: string }[];
}

export function DeploymentClient(props: Props) {
  const router = useRouter();
  const d = props.deployment;
  const [tab, setTab] = useState<Tab>("install");
  const [settings, setSettings] = useState<DeploymentSettings>(d.settings);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devEmail, setDevEmail] = useState("");
  const [newOrigin, setNewOrigin] = useState("");
  const [removing, setRemoving] = useState<{ id: string; origin: string; last: boolean } | null>(null);
  const ro = props.readOnly;
  const dirty = JSON.stringify(settings) !== JSON.stringify(d.settings);
  const set = <K extends keyof DeploymentSettings>(k: K, v: DeploymentSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const verifiedCount = props.origins.filter((o) => o.verified).length;

  const run = <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, after?: (d?: T) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setProblem(r.error ?? "Something went wrong.");
      setProblem(null);
      after?.(r.data);
      router.refresh();
    });

  const [tone, label] = STATUS[d.status];
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Deployments</h1>
          <p className="lead">Install an agent on a website and control where and how it runs.</p>
        </div>
        {!ro && <NewDeployment agents={props.agents} />}
      </div>
      {problem && (
        <p className="note-p c-danger" role="alert">
          {problem}
        </p>
      )}
      <div className="split">
        <aside className="narrow" aria-label="Deployments" style={{ flexBasis: 260 }}>
          <div className="card p-0" role="list">
            {props.list.map((x) => (
              <Link key={x.id} role="listitem" href={`/deployments/${x.id}`} className={x.id === d.id ? "cv on" : "cv"} style={{ textDecoration: "none", color: "inherit" }}>
                <span className="row between">
                  <span className="b">{x.name}</span>
                  <span className={`stt ${STATUS[x.status][0]}`}>{STATUS[x.status][1]}</span>
                </span>
                <span className="xs muted">{x.agent}</span>
              </Link>
            ))}
          </div>
        </aside>
        <section className="wide card">
          <div className="row between p-16" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="col gap-2">
              <h2 className="h2">{d.name}</h2>
              <span className="row gap-8 sm">
                <span className={`stt ${tone}`}>{label}</span>
                <span className="muted">Agent:</span>
                {ro ? (
                  d.agentName
                ) : (
                  <select className="select" style={{ width: 180, minHeight: 32 }} aria-label="Agent" value={d.agentId} onChange={(e) => run(() => agentAction(d.id, e.target.value))}>
                    {props.agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
              </span>
            </div>
            {!ro && (
              <div className="row gap-8">
                <Link className="btn outline sm" href={`/deployments/${d.id}/preview`}>Preview widget</Link>
                {d.status === "live" ? (
                  <button className="btn outline sm" disabled={pending} onClick={() => run(() => statusAction(d.id, "paused"), () => toast("Paused. The widget shows the offline message."))}>
                    Pause
                  </button>
                ) : (
                  <button className="btn sm" disabled={pending} onClick={() => run(() => statusAction(d.id, "live"), () => toast(`${d.name} is live.`))}>
                    Make live
                  </button>
                )}
              </div>
            )}
          </div>
          {d.status !== "live" && verifiedCount === 0 && <p className="note-p p-16">A deployment cannot go live until an origin is verified. Add your site under Allowed origins, install the snippet, then verify.</p>}
          <div className="p-16 col gap-16">
            <div role="tablist" className="tabs" aria-label="Deployment settings">
              {(
                [
                  ["install", "Install"],
                  ["origins", "Allowed origins"],
                  ["look", "Appearance"],
                  ["behaviour", "Behavior and quotas"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>

            {tab === "install" && (
              <div className="col gap-12">
                <p className="sm">Paste this line before &lt;/body&gt; on every page where the chat should appear.</p>
                <pre className="snip" aria-label="Embed snippet">{d.snippet}</pre>
                <div className="row gap-8">
                  <button className="btn outline sm" onClick={async () => {
                    await navigator.clipboard.writeText(d.snippet);
                    toast("Snippet copied.");
                  }}>
                    <i className="i i-copy" /> Copy
                  </button>
                  {!ro && (
                    <>
                      <button className="btn outline sm" onClick={() => setDevOpen(true)}>Send to developer</button>
                      <button className="btn outline sm" onClick={() => setTab("origins")}>Verify domain</button>
                      <button className="btn outline sm" onClick={() => setRotating(true)}>Rotate key</button>
                    </>
                  )}
                </div>
                <p className="xs muted">
                  Public key <span className="mono">{d.publicKey}</span>
                  {d.previousKeyExpiresAt && ` · the previous key works until ${new Date(d.previousKeyExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                </p>
              </div>
            )}

            {tab === "origins" && (
              <div className="col gap-12">
                <p className="note-p">The widget only loads on listed origins. Enter the address of a page that has the snippet: Verify checks that page for this deployment&apos;s key, and the whole site is allowed.</p>
                {props.origins.map((o) => (
                  <div key={o.id} className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div className="col gap-2">
                      <span className="mono">{o.origin}</span>
                      {o.verified ? <span className="stt ok">Verified</span> : <span className="stt warn">Not verified{o.reason ? `: ${o.reason}` : ""}</span>}
                    </div>
                    {!ro && (
                      <div className="row gap-4">
                        <button className="btn outline sm" disabled={pending} onClick={() => run(() => verifyAction(d.id, o.id), (r) => {
                          const res = r as { verified: boolean; reason?: string } | undefined;
                          toast(res?.verified ? `${o.origin} is verified.` : `Not verified: ${res?.reason ?? ""}`);
                        })}>
                          Verify
                        </button>
                        <button className="btn ghost sm" aria-label={`Remove ${o.origin}`} onClick={() => setRemoving({ id: o.id, origin: o.origin, last: d.status === "live" && o.verified && verifiedCount === 1 })}>
                          <i className="i i-trash" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!ro && (
                  <div className="row nw gap-8">
                    <label className="sr-only" htmlFor="new-origin">Add an origin</label>
                    <input id="new-origin" className="input" placeholder="https://example.com/contact" value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} />
                    <button className="btn sm" disabled={!newOrigin.trim()} onClick={() => run(() => addOriginAction(d.id, newOrigin), () => setNewOrigin(""))}>
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "look" && (
              <div className="split">
                <div className="wide col gap-12">
                  <div className="field">
                    <label className="label" htmlFor="bc">Brand colour</label>
                    <div className="row gap-8">
                      <input id="bc" type="color" value={settings.brandColour} disabled={ro} onChange={(e) => set("brandColour", e.target.value)} />
                      <span className="mono">{settings.brandColour}</span>
                      <span className="xs muted">Text on it: {textOn(settings.brandColour) === "#ffffff" ? "white" : "indigo ink"} (keeps WCAG AA)</span>
                    </div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="wen">Welcome message (English)</label>
                    <input id="wen" className="input" placeholder="Uses the agent's welcome when empty" value={settings.welcome.en} disabled={ro} onChange={(e) => set("welcome", { ...settings.welcome, en: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="war">Welcome message (Arabic)</label>
                    <input id="war" className="input" dir="rtl" lang="ar" value={settings.welcome.ar} disabled={ro} onChange={(e) => set("welcome", { ...settings.welcome, ar: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="pos">Position</label>
                    <select id="pos" className="select" value={settings.position} disabled={ro} onChange={(e) => set("position", e.target.value as "right" | "left")}>
                      <option value="right">Bottom right</option>
                      <option value="left">Bottom left</option>
                    </select>
                  </div>
                  {(
                    [
                      ["showAiLabel", "Show AI label"],
                      ["suggestedQuestions", "Suggested questions"],
                      ["rtl", "Right-to-left for Arabic"],
                    ] as const
                  ).map(([k, l]) => (
                    <div key={k} className="row between">
                      <span className="sm b">{l}</span>
                      <button role="switch" aria-checked={settings[k]} aria-label={l} className={settings[k] ? "switch on" : "switch"} disabled={ro} onClick={() => set(k, !settings[k])} />
                    </div>
                  ))}
                </div>
                <div className="narrow">
                  <span className="over">Live preview</span>
                  <div className="card p-0" style={{ overflow: "hidden" }}>
                    <div style={{ background: settings.brandColour, color: textOn(settings.brandColour), padding: 12 }}>
                      <b>{d.agentName}</b>
                      {settings.showAiLabel && <div className="xs">AI assistant</div>}
                    </div>
                    <div className="wg-b" style={{ height: 180 }}>
                      <div className="bubble-ai">{settings.welcome.en || "Hi! How can I help you today?"}</div>
                      {settings.suggestedQuestions && (
                        <div className="row gap-6">
                          {settings.suggestions.en.map((s) => (
                            <span key={s} className="sg">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="xs muted p-12">Opens at the bottom {settings.position}.</div>
                  </div>
                </div>
              </div>
            )}

            {tab === "behaviour" && (
              <div className="col gap-12">
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="pin">Agent version</label>
                    <select id="pin" className="select" disabled={ro} value={settings.pinnedVersion ?? ""} onChange={(e) => set("pinnedVersion", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Latest live{d.agentLive ? ` (v${d.agentLive})` : ""}</option>
                      {props.versions.map((v) => (
                        <option key={v} value={v}>Pin to version {v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="lo">Language override</label>
                    <select id="lo" className="select" disabled={ro} value={settings.languageOverride} onChange={(e) => set("languageOverride", e.target.value as DeploymentSettings["languageOverride"])}>
                      <option value="auto">None: follow the agent</option>
                      <option value="ar">Arabic</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="mq">AI conversations per month</label>
                    <input id="mq" type="number" min={1} className="input" placeholder="Plan allowance" disabled={ro} value={settings.monthlyQuota ?? ""} onChange={(e) => set("monthlyQuota", e.target.value ? Math.max(1, Number(e.target.value)) : null)} />
                    <span className="hint">Empty uses the organization&apos;s plan allowance. Set lower to share it between sites.</span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="cc">Concurrent conversations</label>
                    <input id="cc" type="number" min={1} className="input" disabled={ro} value={settings.concurrentLimit} onChange={(e) => set("concurrentLimit", Math.max(1, Number(e.target.value) || 1))} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="lb">Behavior at limit</label>
                    <select id="lb" className="select" disabled={ro} value={settings.limitBehaviour} onChange={(e) => set("limitBehaviour", e.target.value as DeploymentSettings["limitBehaviour"])}>
                      <option value="stop_route">Stop the AI, show the fallback message and route to a person</option>
                      <option value="offline">Show offline message</option>
                      <option value="overage" disabled={!props.orgOverage}>Allow overage{props.orgOverage ? "" : " (turn on in Plan and usage)"}</option>
                    </select>
                    <span className="hint">People can always keep replying, whatever limit is reached.</span>
                  </div>
                </div>
                <div className="col gap-6">
                  <span className="b sm">Tools this site may use</span>
                  {props.tools.length === 0 && <span className="xs muted">The agent has no tools turned on.</span>}
                  {props.tools.map((t) => {
                    const on = settings.toolSubset === null || settings.toolSubset.includes(t.key);
                    return (
                      <label key={t.key} className="row gap-8 sm">
                        <input
                          type="checkbox"
                          disabled={ro}
                          checked={on}
                          onChange={(e) => {
                            const all = props.tools.map((x) => x.key);
                            const current = settings.toolSubset ?? all;
                            const next = e.target.checked ? [...current, t.key] : current.filter((k) => k !== t.key);
                            set("toolSubset", next.length === all.length ? null : next);
                          }}
                        />
                        {t.name}
                      </label>
                    );
                  })}
                </div>
                <div className="row between">
                  <div className="col gap-2">
                    <span className="b sm">Pre-chat form</span>
                    <span className="xs muted">Name and email (required) and phone (optional) before the first message.</span>
                  </div>
                  <button role="switch" aria-checked={settings.preChatForm} aria-label="Pre-chat form" className={settings.preChatForm ? "switch on" : "switch"} disabled={ro} onClick={() => set("preChatForm", !settings.preChatForm)} />
                </div>
              </div>
            )}

            {(tab === "look" || tab === "behaviour") && !ro && (
              <div className="row end gap-8">
                <button className="btn outline" disabled={!dirty} onClick={() => setSettings(d.settings)}>Discard</button>
                <button className="btn" disabled={!dirty || pending} onClick={() => run(() => settingsAction(d.id, settings), () => toast("Saved. The live widget uses the new settings."))}>
                  Save
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <Confirm
        open={rotating}
        title="Rotate the public key?"
        description="A new key is issued. The old key keeps working for a 7-day grace period, then stops. Update the snippet on your site before then."
        confirm="Rotate key"
        busy={pending}
        onClose={() => setRotating(false)}
        onConfirm={() => run(() => rotateAction(d.id), () => {
          setRotating(false);
          toast("Key rotated. The old key works for 7 more days.");
        })}
      />
      <Confirm
        open={removing !== null}
        title={`Remove ${removing?.origin ?? ""}?`}
        description={removing?.last ? "This is the last verified origin of a live deployment, so the deployment will be paused." : "The widget stops loading on this site."}
        confirm={removing?.last ? "Remove and pause" : "Remove"}
        destructive
        busy={pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && run(() => removeOriginAction(d.id, removing.id), () => setRemoving(null))}
      />
      <Dialog
        open={devOpen}
        title="Send to developer"
        description="We email the snippet and the install steps."
        onClose={() => setDevOpen(false)}
        footer={
          <>
            <button className="btn outline" onClick={() => setDevOpen(false)}>Cancel</button>
            <button className="btn" disabled={!devEmail} onClick={() => run(() => sendDevAction(d.id, devEmail), () => {
              setDevOpen(false);
              toast(`Install steps sent to ${devEmail}.`);
            })}>
              Send
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="dev-email">Developer&apos;s email</label>
          <input id="dev-email" type="email" className="input" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
        </div>
      </Dialog>
    </>
  );
}
