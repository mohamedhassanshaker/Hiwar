"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Confirm, Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import type { AgentConfig, NoPersonBehaviour, ToolPolicy } from "@/db/schema";
import type { TurnLine, TurnResult } from "@/server/agent-service";
import {
  addHttpToolAction,
  duplicateAction,
  newAgentAction,
  publishAction,
  rollBackAction,
  saveDraftAction,
  testTurnAction,
} from "./actions";

type Tab = "persona" | "know" | "tools" | "guard" | "esc" | "ver";
const TABS: [Tab, string][] = [
  ["persona", "Persona"],
  ["know", "Knowledge"],
  ["tools", "Tools"],
  ["guard", "Guardrails"],
  ["esc", "Escalation"],
  ["ver", "Versions"],
];
const MODEL_LABEL = { fast: "Fast model", standard: "Standard model", advanced: "Advanced model" } as const;
const NO_PERSON: [NoPersonBehaviour, string][] = [
  ["keep_ai", "Keep with the AI"],
  ["collect_contact", "Collect contact details and promise follow-up"],
  ["offline", "Show offline message"],
];
const POLICIES: [ToolPolicy, string][] = [
  ["ask_visitor", "Ask the visitor first"],
  ["staff_approval", "Require staff approval"],
  ["auto", "Run automatically"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  readOnly: boolean;
  planLabel: string;
  models: ("fast" | "standard" | "advanced")[];
  httpTools: boolean;
  agents: { id: string; name: string; purpose: string; live: number | null }[];
  agent: { id: string; draft: AgentConfig; live: number | null };
  liveConfig: string;
  versions: { number: number; publishedAt: string; publishedBy: string }[];
  sources: { id: string; name: string; type: string; status: string; enabled: boolean; chunks: number; detail: string }[];
  tools: { key: string; name: string; description: string; access: "read" | "write"; kind: "builtin" | "http" }[];
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={on ? "switch on" : "switch"} disabled={disabled} onClick={() => onChange(!on)} />;
}

function Setting({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="row between nw gap-12" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="col gap-2">
        <span className="b sm">{title}</span>
        {detail && <span className="xs muted">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

export function AgentEditor(props: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<AgentConfig>(props.agent.draft);
  const [saved, setSaved] = useState(JSON.stringify(props.agent.draft));
  const [tab, setTab] = useState<Tab>("persona");
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<{ text: string; upgrade?: boolean } | null>(null);
  const [rollTo, setRollTo] = useState<number | null>(null);
  const [addingTool, setAddingTool] = useState(false);
  const dirty = JSON.stringify(config) !== saved;
  const differsFromLive = props.liveConfig === "null" || JSON.stringify(config) !== props.liveConfig;
  const nextVersion = (props.versions[0]?.number ?? 0) + 1;
  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
  const ro = props.readOnly;

  const run = <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string; upgrade?: boolean }>, after?: (data?: T) => void) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setProblem({ text: result.error ?? "Something went wrong.", upgrade: result.upgrade });
        return;
      }
      setProblem(null);
      after?.(result.data);
    });

  const save = () => run(() => saveDraftAction(props.agent.id, config), () => {
    setSaved(JSON.stringify(config));
    toast("Draft saved.");
  });
  const doPublish = () =>
    run(
      () => publishAction(props.agent.id, config),
      (n) => {
        setSaved(JSON.stringify(config));
        toast(`Version ${n} of ${config.name} is live. Deployments that follow the latest version now use it.`);
        router.refresh();
      },
    );

  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Agents</h1>
          <p className="lead">Set the persona, knowledge, tools and guardrails once. Publish a version and pin it to any deployment.</p>
        </div>
        {!ro && (
          <button className="btn" disabled={pending} onClick={() => run(() => newAgentAction(), (id) => router.push(`/agents/${id}`))}>
            <i className="i i-plus" /> New agent
          </button>
        )}
      </div>
      {problem && (
        <p className="note-p c-danger" role="alert">
          {problem.text} {problem.upgrade && <Link href="/billing">Upgrade</Link>}
        </p>
      )}
      <div className="split3">
        <aside className="rail" aria-label="Agents">
          <div className="card p-0" role="list">
            {props.agents.map((a) => (
              <Link key={a.id} role="listitem" href={`/agents/${a.id}`} className={a.id === props.agent.id ? "cv on" : "cv"} aria-current={a.id === props.agent.id ? "true" : undefined} style={{ textDecoration: "none", color: "inherit" }}>
                <span className="row between">
                  <span className="b">{a.name}</span>
                  <span className={a.live ? "stt ok" : "stt mut"}>{a.live ? `v${a.live} live` : "Draft"}</span>
                </span>
                <span className="xs muted">{a.purpose}</span>
              </Link>
            ))}
          </div>
          <div className="card p-12 col gap-4">
            <span className="b sm">Templates</span>
            <span className="xs muted">Customer support, lead capture, appointment booking and FAQ templates arrive in the next release.</span>
          </div>
        </aside>

        <section className="center card" aria-label="Agent editor">
          <div className="row between p-16" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="col gap-2">
              <h2 className="h2">{config.name}</h2>
              <span className="xs muted">{config.purpose}</span>
            </div>
            <div className="row gap-8">
              <span className={dirty || differsFromLive ? "stt warn" : "stt ok"}>{dirty || differsFromLive ? "Unpublished changes" : "Up to date"}</span>
              {!ro && (
                <>
                  <button className="btn outline sm" disabled={pending} onClick={() => run(() => duplicateAction(props.agent.id), (id) => {
                    toast("Duplicated as a draft.");
                    router.push(`/agents/${id}`);
                  })}>
                    Duplicate
                  </button>
                  <button className="btn outline sm" disabled={pending || !dirty} onClick={save}>
                    Save draft
                  </button>
                  <button className="btn sm" disabled={pending} onClick={doPublish}>
                    Publish v{nextVersion}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="p-16 col gap-16">
            <div role="tablist" aria-label="Agent settings" className="tabs">
              {TABS.map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab on" : "tab"} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "persona" && (
              <div className="col gap-12">
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="an">Name shown to visitors</label>
                    <input id="an" className="input" value={config.name} disabled={ro} onChange={(e) => set("name", e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="ap">Purpose and site</label>
                    <input id="ap" className="input" value={config.purpose} disabled={ro} onChange={(e) => set("purpose", e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="am">Model</label>
                    <select id="am" className="select" value={config.model} disabled={ro} onChange={(e) => set("model", e.target.value as AgentConfig["model"])}>
                      {(["fast", "standard", "advanced"] as const).map((m) => (
                        <option key={m} value={m} disabled={!props.models.includes(m)}>
                          {MODEL_LABEL[m]}
                          {!props.models.includes(m) ? " (upgrade)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="hint">Models available on the {props.planLabel} plan.</span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="al">Reply language</label>
                    <select id="al" className="select" value={config.replyLanguage} disabled={ro} onChange={(e) => set("replyLanguage", e.target.value as AgentConfig["replyLanguage"])}>
                      <option value="auto">Detect and match the visitor</option>
                      <option value="ar">Arabic only</option>
                      <option value="en">English only</option>
                    </select>
                    <span className="hint">Detects the visitor&apos;s language, including Gulf, Egyptian and Levantine Arabic and mixed text.</span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="at">Tone</label>
                    <select id="at" className="select" value={config.tone} disabled={ro} onChange={(e) => set("tone", e.target.value as AgentConfig["tone"])}>
                      <option value="warm">Warm and professional</option>
                      <option value="short">Short and direct</option>
                      <option value="formal">Formal</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="ar">Reply length</label>
                    <select id="ar" className="select" value={config.replyLength} disabled={ro} onChange={(e) => set("replyLength", e.target.value as AgentConfig["replyLength"])}>
                      <option value="short">Short, 1 to 3 sentences</option>
                      <option value="balanced">Balanced</option>
                      <option value="detailed">Detailed</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="ai">Persona and instructions</label>
                  <textarea id="ai" className="textarea" rows={6} value={config.instructions} disabled={ro} onChange={(e) => set("instructions", e.target.value)} />
                  <span className="hint">Kept in a separate privileged channel. Visitor text is always treated as data.</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="ac">Creativity: {config.creativity}</label>
                  <input id="ac" type="range" min={0} max={10} value={config.creativity} aria-label="Creativity" disabled={ro} onChange={(e) => set("creativity", Number(e.target.value))} />
                </div>
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="aw-en">Welcome message (English)</label>
                    <input id="aw-en" className="input" value={config.welcome.en} disabled={ro} onChange={(e) => set("welcome", { ...config.welcome, en: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="aw-ar">Welcome message (Arabic)</label>
                    <input id="aw-ar" dir="rtl" lang="ar" className="input" value={config.welcome.ar} disabled={ro} onChange={(e) => set("welcome", { ...config.welcome, ar: e.target.value })} />
                  </div>
                </div>
                <OperatingHours config={config} ro={ro} set={set} />
              </div>
            )}

            {tab === "know" && (
              <div className="col gap-8">
                <p className="note-p">Choose which sources this agent can retrieve from. New sources are on for every agent. Knowledge is stored per organization and never shared.</p>
                {props.sources.length === 0 && <p className="sm muted">No sources yet.</p>}
                {props.sources.map((s) => {
                  const on = !config.excludedSources.includes(s.id);
                  return (
                    <Setting key={s.id} title={s.name} detail={`${s.type} · ${s.status === "ready" && s.enabled ? `${s.chunks} chunks · ready` : s.enabled ? s.status : "disabled"}`}>
                      <Switch on={on} label={`Use ${s.name}`} disabled={ro} onChange={(v) => set("excludedSources", v ? config.excludedSources.filter((x) => x !== s.id) : [...config.excludedSources, s.id])} />
                    </Setting>
                  );
                })}
                <Link href="/knowledge" className="sm">Manage knowledge</Link>
              </div>
            )}

            {tab === "tools" && (
              <div className="col gap-8">
                <p className="note-p">Write tools never run on their own unless you explicitly allow it. Secrets are encrypted and never shown after saving.</p>
                {props.tools.map((t) => {
                  const setting = config.tools[t.key] ?? { enabled: false };
                  const update = (next: { enabled: boolean; policy?: ToolPolicy }) => set("tools", { ...config.tools, [t.key]: next });
                  return (
                    <Setting key={t.key} title={t.name} detail={t.description}>
                      <span className="row gap-8 nw">
                        <span className={t.access === "write" ? "badge c-warning" : "badge"}>{t.access === "write" ? "Write" : "Read"}</span>
                        {t.access === "write" && (
                          <select className="select" style={{ width: 210 }} aria-label={`Confirmation for ${t.name}`} disabled={ro} value={setting.policy ?? "staff_approval"} onChange={(e) => update({ ...setting, policy: e.target.value as ToolPolicy })}>
                            {POLICIES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        )}
                        <Switch on={setting.enabled} label={`Enable ${t.name}`} disabled={ro} onChange={(v) => update({ ...setting, enabled: v, policy: t.access === "write" ? setting.policy ?? "staff_approval" : undefined })} />
                      </span>
                    </Setting>
                  );
                })}
                {!ro && (
                  <button className="btn outline sm" style={{ alignSelf: "flex-start" }} disabled={!props.httpTools} onClick={() => setAddingTool(true)}>
                    <i className="i i-plus" /> Add an HTTP tool
                  </button>
                )}
                {!props.httpTools && (
                  <p className="note-p">
                    HTTP tools need Growth or above. <Link href="/billing">See plans</Link>
                  </p>
                )}
              </div>
            )}

            {tab === "guard" && (
              <div className="col gap-12">
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="g1">Allowed topics</label>
                    <textarea id="g1" className="textarea" rows={3} value={config.allowedTopics} disabled={ro} onChange={(e) => set("allowedTopics", e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="g2">Blocked topics</label>
                    <textarea id="g2" className="textarea" rows={3} value={config.blockedTopics} disabled={ro} onChange={(e) => set("blockedTopics", e.target.value)} />
                    <span className="hint">Separate with commas. A blocked topic gets the refusal message.</span>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="g3">Refusal message</label>
                  <input id="g3" className="input" value={config.refusalMessage} disabled={ro} onChange={(e) => set("refusalMessage", e.target.value)} />
                </div>
                {(
                  [
                    ["discloseAi", "Say that it is an AI when asked", "And show an AI label in the widget"],
                    ["citations", "Show source citations", "Visitors see which document an answer came from"],
                    ["sayUnsure", 'Say "I do not know" when unsure', "Instead of guessing when retrieval confidence is low"],
                    ["redact", "Redact card numbers and national IDs", "From stored transcripts"],
                  ] as const
                ).map(([key, title, detail]) => (
                  <Setting key={key} title={title} detail={detail}>
                    <Switch on={config.guardrails[key]} label={title} disabled={ro} onChange={(v) => set("guardrails", { ...config.guardrails, [key]: v })} />
                  </Setting>
                ))}
              </div>
            )}

            {tab === "esc" && (
              <div className="col gap-12">
                {(
                  [
                    ["talkToPerson", 'Show "Talk to a person" in the widget', "Visitors can ask at any time"],
                    ["agentRequest", "Let the agent request a person", "Uses the request-a-person tool when it cannot help"],
                    ["lowConfidence", "Escalate on repeated low confidence", "After the number of replies chosen below"],
                    ["negativeSentiment", "Escalate on strong negative sentiment", "For example an angry or upset visitor"],
                    ["sensitiveTopic", "Escalate on a sensitive topic", "A blocked topic gets the refusal message, then a person"],
                    ["toolFailure", "Escalate on repeated tool failure", "After 2 failed tool calls in a row"],
                  ] as const
                ).map(([key, title, detail]) => (
                  <Setting key={key} title={title} detail={detail}>
                    <Switch on={config.escalation[key]} label={title} disabled={ro} onChange={(v) => set("escalation", { ...config.escalation, [key]: v })} />
                  </Setting>
                ))}
                <div className="grid g2">
                  <div className="field">
                    <label className="label" htmlFor="e1">After this many low-confidence replies in a row</label>
                    <select id="e1" className="select" value={config.escalation.lowConfidenceCount} disabled={ro} onChange={(e) => set("escalation", { ...config.escalation, lowConfidenceCount: Number(e.target.value) as 2 | 3 | 4 })}>
                      {[2, 3, 4].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="e3">Claim wait (minutes)</label>
                    <input id="e3" type="number" min={1} max={10} className="input" value={config.escalation.claimWaitMinutes} disabled={ro} onChange={(e) => set("escalation", { ...config.escalation, claimWaitMinutes: Math.min(10, Math.max(1, Number(e.target.value) || 2)) })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="e2">When no one claims it within {config.escalation.claimWaitMinutes} minutes</label>
                    <select id="e2" className="select" value={config.escalation.noPerson} disabled={ro} onChange={(e) => set("escalation", { ...config.escalation, noPerson: e.target.value as NoPersonBehaviour })}>
                      {NO_PERSON.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {tab === "ver" && (
              <div className="col gap-8">
                <p className="note-p">Editing creates a draft. Publishing makes a version live for every deployment that follows the latest version. Pinned deployments stay on their version.</p>
                <Setting title={`Version ${nextVersion}`} detail="Your unpublished changes">
                  <span className="stt ai">Draft</span>
                </Setting>
                {props.versions.map((v) => (
                  <Setting key={v.number} title={`Version ${v.number}`} detail={`Published ${new Date(v.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} by ${v.publishedBy}`}>
                    {v.number === props.agent.live ? (
                      <span className="stt ok">Live</span>
                    ) : (
                      <span className="row gap-8">
                        <span className="stt mut">Earlier</span>
                        {!ro && (
                          <button className="btn outline sm" onClick={() => setRollTo(v.number)}>
                            Roll back to this
                          </button>
                        )}
                      </span>
                    )}
                  </Setting>
                ))}
              </div>
            )}
          </div>
        </section>

        <TestConsole agentId={props.agent.id} config={config} />
      </div>

      <Confirm
        open={rollTo !== null}
        title={`Roll back to version ${rollTo}?`}
        description={`Version ${rollTo} becomes live for every deployment that follows the latest version. Pinned deployments keep their version. Your draft is kept.`}
        confirm="Roll back"
        busy={pending}
        onClose={() => setRollTo(null)}
        onConfirm={() =>
          rollTo !== null &&
          run(() => rollBackAction(props.agent.id, rollTo), () => {
            toast(`Rolled back. Version ${rollTo} is live again for deployments that follow the latest version.`);
            setRollTo(null);
            router.refresh();
          })
        }
      />
      <HttpToolDialog
        open={addingTool}
        onClose={() => setAddingTool(false)}
        onSave={(input) => run(() => addHttpToolAction(input), () => {
          setAddingTool(false);
          toast("HTTP tool added. Turn it on for this agent and publish.");
          router.refresh();
        })}
      />
    </>
  );
}

function OperatingHours({ config, ro, set }: { config: AgentConfig; ro: boolean; set: <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => void }) {
  const summary = useMemo(
    () =>
      config.operatingHours
        .map((r) => `${r.days.map((d) => DAYS[d]).join(", ")} ${r.from} to ${r.to}`)
        .join("; "),
    [config.operatingHours],
  );
  return (
    <div className="card p-12 col gap-8">
      <div className="row between">
        <span className="b sm">Operating hours</span>
        <span className="xs muted">{summary} ({config.timezone})</span>
      </div>
      {config.operatingHours.map((range, index) => (
        <div key={index} className="row gap-8">
          {DAYS.map((d, i) => (
            <label key={d} className="row gap-4 xs">
              <input
                type="checkbox"
                disabled={ro}
                checked={range.days.includes(i)}
                onChange={(e) => {
                  const next = [...config.operatingHours];
                  next[index] = { ...range, days: e.target.checked ? [...range.days, i].sort() : range.days.filter((x) => x !== i) };
                  set("operatingHours", next);
                }}
              />
              {d}
            </label>
          ))}
          <input aria-label="From" type="time" className="input" style={{ width: 120 }} disabled={ro} value={range.from} onChange={(e) => {
            const next = [...config.operatingHours];
            next[index] = { ...range, from: e.target.value };
            set("operatingHours", next);
          }} />
          <input aria-label="To" type="time" className="input" style={{ width: 120 }} disabled={ro} value={range.to} onChange={(e) => {
            const next = [...config.operatingHours];
            next[index] = { ...range, to: e.target.value };
            set("operatingHours", next);
          }} />
        </div>
      ))}
      <div className="field">
        <label className="label" htmlFor="oh">Outside hours</label>
        <select id="oh" className="select" disabled={ro} value={config.outsideHours} onChange={(e) => set("outsideHours", e.target.value as NoPersonBehaviour)}>
          {NO_PERSON.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TestConsole({ agentId, config }: { agentId: string; config: AgentConfig }) {
  const [chat, setChat] = useState<{ line: TurnLine; meta?: TurnResult }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const transcript: TurnLine[] = [...chat.map((c) => c.line), { role: "visitor", text: t }];
    setChat((c) => [...c, { line: { role: "visitor", text: t } }]);
    setQ("");
    setBusy(true);
    const result = await testTurnAction(agentId, transcript, config);
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? "No answer." : result.error);
      return;
    }
    setError(null);
    const data = result.data;
    setChat((c) => [...c, { line: { role: "ai", text: data.text }, meta: data }]);
  };
  return (
    <aside className="rail card" aria-label="Test console" style={{ flexBasis: 320 }}>
      <div className="p-16 col gap-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="row between">
          <h2 className="h3">Test console</h2>
          <button className="btn ghost sm" onClick={() => setChat([])}>
            Reset conversation
          </button>
        </div>
        <p className="xs muted">Chats with the draft as it is in the editor, saved or not. Sources, tool calls and cost show for each turn.</p>
      </div>
      <div className="thread" role="log" aria-live="polite" style={{ minHeight: 240 }}>
        {chat.map((c, i) => (
          <div key={i} className="col gap-4" style={{ alignItems: c.line.role === "visitor" ? "flex-end" : "flex-start" }}>
            <div className="bubble" dir="auto" style={{ background: c.line.role === "ai" ? "#eef0ff" : "#fff", border: "1px solid #dfe2f0", padding: "8px 12px", borderRadius: 12, maxWidth: "90%" }}>
              {c.line.text}
            </div>
            {c.meta && (
              <div className="col gap-2 xs muted">
                <span>
                  <i className="i i-file s12" /> {c.meta.citations.length ? c.meta.citations.map((x) => `${x.name} · chunk ${x.chunk} · ${x.confidence}`).join("; ") : "No source needed"}
                </span>
                <span>
                  <i className="i i-zap s12" /> {c.meta.tools.length ? c.meta.tools.map((t) => `${t.key} · ${t.access} · ${t.status}${t.duration_ms ? ` · ${t.duration_ms} ms` : ""}`).join("; ") : "No tools used"}
                </span>
                <span>
                  <i className="i i-coins s12" /> {c.meta.input_tokens} input · {c.meta.output_tokens} output tokens · about AED {c.meta.cost_aed.toFixed(3)}
                </span>
                {c.meta.escalate && <span className="c-warning">Would hand over to a person: {c.meta.escalate}</span>}
                {c.meta.low_confidence && <span className="c-warning">Low confidence</span>}
              </div>
            )}
          </div>
        ))}
        {busy && <span className="xs muted">Writing a reply…</span>}
        {error && <span className="xs c-danger">{error}</span>}
      </div>
      <div className="p-12 col gap-8">
        <div className="row nw gap-8">
          <label className="sr-only" htmlFor="tq">Test message</label>
          <input id="tq" className="input" placeholder="Try a visitor question" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} />
          <button className="btn" aria-label="Send" disabled={!q.trim() || busy} onClick={() => ask(q)}>
            <i className="i i-send" />
          </button>
        </div>
        <div className="row gap-4">
          {["Where is my order?", "I want a refund", "مرحبا"].map((chip) => (
            <button key={chip} className="sg" onClick={() => ask(chip)}>
              {chip}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function HttpToolDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (input: unknown) => void }) {
  const [form, setForm] = useState({ name: "", description: "", access: "read", endpoint: "https://", method: "POST", schema: '{"type":"object","properties":{}}', secretName: "", secretValue: "" });
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) });
  const submit = () => {
    let inputSchema: unknown;
    try {
      inputSchema = JSON.parse(form.schema);
    } catch {
      setSchemaError("The input schema must be valid JSON.");
      return;
    }
    setSchemaError(null);
    onSave({
      name: form.name,
      description: form.description,
      access: form.access,
      endpoint: form.endpoint,
      method: form.method,
      inputSchema,
      headers: {},
      secrets: form.secretName ? { [form.secretName]: form.secretValue } : {},
    });
  };
  return (
    <Dialog open={open} title="Add an HTTP tool" description="The tool editor takes a name, a description for the model, an input schema, an endpoint, a method, headers and secrets." onClose={onClose} footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" onClick={submit}>Add tool</button></>}>
      <div className="field"><label className="label" htmlFor="ht-n">Name</label><input id="ht-n" className="input" {...field("name")} /></div>
      <div className="field"><label className="label" htmlFor="ht-d">Description for the model</label><textarea id="ht-d" className="textarea" rows={2} {...field("description")} /></div>
      <div className="grid g2">
        <div className="field"><label className="label" htmlFor="ht-a">Access</label><select id="ht-a" className="select" {...field("access")}><option value="read">Read</option><option value="write">Write</option></select></div>
        <div className="field"><label className="label" htmlFor="ht-m">Method</label><select id="ht-m" className="select" {...field("method")}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select></div>
      </div>
      <div className="field"><label className="label" htmlFor="ht-e">Endpoint</label><input id="ht-e" className="input" {...field("endpoint")} /></div>
      <div className="field"><label className="label" htmlFor="ht-s">Input schema (JSON)</label><textarea id="ht-s" className="textarea mono" rows={3} {...field("schema")} />{schemaError && <span className="err">{schemaError}</span>}</div>
      <div className="grid g2">
        <div className="field"><label className="label" htmlFor="ht-sn">Secret header name</label><input id="ht-sn" className="input" placeholder="Authorization" {...field("secretName")} /></div>
        <div className="field"><label className="label" htmlFor="ht-sv">Secret value</label><input id="ht-sv" className="input" type="password" autoComplete="off" {...field("secretValue")} /></div>
      </div>
    </Dialog>
  );
}
