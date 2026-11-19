"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import {
  approveAction,
  claimAction,
  closeAction,
  handBackAction,
  rejectAction,
  releaseAction,
  sendAction,
  takeOverAction,
} from "./actions";

type Tone = "ai" | "warn" | "ok" | "mut";

export interface ThreadView {
  id: string;
  version: number;
  state: "AI_ACTIVE" | "HANDOVER_PENDING" | "HUMAN_ACTIVE" | "CLOSED";
  stateLabel: string;
  tone: Tone;
  visitorName: string;
  site: string;
  language: string;
  waited: string;
  reason: string | null;
  ownerName: string | null;
  mine: boolean;
  otherOwns: boolean;
  canTake: boolean;
  canClaim: boolean;
  typing: boolean;
  agentName: string;
  messages: { id: string; kind: string; who: string; text: string; time: string; cite: string }[];
  details: [string, string][];
  history: { t: string; d: string }[];
  used: { id?: string; t: string; d: string; inputs?: string; waiting?: boolean }[];
}

export function InboxClient(props: {
  readOnly: boolean;
  tabs: { all: number; pending: number; ai: number; human: number };
  filters: { tab: string; dep: string; period: string; q: string };
  deployments: { id: string; name: string }[];
  list: { id: string; name: string; time: string; preview: string; site: string; label: string; tone: Tone }[];
  selected: ThreadView | null;
  canApprove: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(props.filters.q);
  const [mobileView, setMobileView] = useState<"list" | "thread" | "details">(params.get("c") ? "thread" : "list");

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${path}?${next.toString()}`);
  };
  // Keep the open conversation in the URL, so it stays open when it leaves the current tab.
  const selectedId = props.selected?.id;
  useEffect(() => {
    if (selectedId && !params.get("c")) {
      const next = new URLSearchParams(params.toString());
      next.set("c", selectedId);
      router.replace(`${path}?${next.toString()}`);
    }
  }, [selectedId, params, path, router]);
  const filtered = props.filters.tab !== "all" || props.filters.dep || props.filters.q || props.filters.period !== "7";
  const TABS: [string, string, number][] = [
    ["all", "All", props.tabs.all],
    ["pending", "Needs a person", props.tabs.pending],
    ["ai", "With the AI", props.tabs.ai],
    ["human", "With the team", props.tabs.human],
  ];

  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Conversations</h1>
          <p className="lead">Watch every chat live. Take over at any moment and hand back with a summary. Only one party replies at a time.</p>
        </div>
        <div role="group" aria-label="Filter conversations" className="tabs">
          {TABS.map(([key, label, n]) => (
            <button key={key} className={props.filters.tab === key ? "tab on" : "tab"} aria-pressed={props.filters.tab === key} onClick={() => go({ tab: key === "all" ? "" : key, c: "" })}>
              {label} <span className="tnum">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`split3 inbox inbox-${mobileView}`}>
        <aside className="rail card p-0" aria-label="Conversation list">
          <div className="p-12 col gap-8" style={{ borderBottom: "1px solid var(--border)" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                go({ q: search, c: "" });
              }}
            >
              <label className="sr-only" htmlFor="inbox-q">Search messages</label>
              <input id="inbox-q" type="search" className="input" aria-label="Search all messages" placeholder="Search all messages" value={search} onChange={(e) => setSearch(e.target.value)} />
            </form>
            <div className="row nw gap-8">
              <label className="sr-only" htmlFor="fd">Deployment</label>
              <select id="fd" className="select" value={props.filters.dep} onChange={(e) => go({ dep: e.target.value, c: "" })}>
                <option value="">All sites</option>
                {props.deployments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="fr">Period</label>
              <select id="fr" className="select" value={props.filters.period} onChange={(e) => go({ period: e.target.value === "7" ? "" : e.target.value, c: "" })}>
                <option value="today">Today</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
          </div>
          <div role="list">
            {props.list.map((c) => (
              <button
                key={c.id}
                role="listitem"
                className={props.selected?.id === c.id ? "cv on" : "cv"}
                aria-current={props.selected?.id === c.id ? "true" : undefined}
                onClick={() => {
                  setMobileView("thread");
                  go({ c: c.id });
                }}
              >
                <span className="row between nw">
                  <span className="b trunc">{c.name}</span>
                  <span className="xs muted">{c.time}</span>
                </span>
                <span className="sm muted trunc" style={{ maxWidth: "100%" }}>{c.preview}</span>
                <span className="row between nw">
                  <span className={`stt ${c.tone}`}>{c.label}</span>
                  <span className="xs muted trunc">{c.site}</span>
                </span>
              </button>
            ))}
            {props.list.length === 0 && (
              <div className="p-16 col gap-4">
                <span className="sm">No conversations match these filters.</span>
                {filtered && (
                  <button className="btn link sm" style={{ alignSelf: "flex-start" }} onClick={() => {
                    setSearch("");
                    router.push(path);
                  }}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
        {props.selected ? (
          <Thread key={props.selected.id} view={props.selected} readOnly={props.readOnly} canApprove={props.canApprove} setMobileView={setMobileView} />
        ) : (
          <section className="center card empty">Select a conversation.</section>
        )}
      </div>
    </>
  );
}

function Thread({
  view,
  readOnly,
  canApprove,
  setMobileView,
}: {
  view: ThreadView;
  readOnly: boolean;
  canApprove: boolean;
  setMobileView: (v: "list" | "thread" | "details") => void;
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [handback, setHandback] = useState(false);
  const [note, setNote] = useState("");
  const [tell, setTell] = useState(true);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [pending, start] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const closed = view.state === "CLOSED";
  const noteMode = mode === "note";
  const composerOff = readOnly || (noteMode ? closed : !(view.mine && !closed));
  const hint = noteMode ? "Only staff see notes" : view.mine ? "You own this conversation" : "Take over to reply";
  const placeholder = noteMode ? "Write a note for your team" : view.mine ? "Write to the visitor" : "Only the owner can reply";

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.messages.length, view.typing]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "Something went wrong.");
      else {
        after?.();
        if (success) toast(success);
      }
      router.refresh();
    });

  return (
    <>
      <section className="center card p-0" aria-label="Conversation">
        <div className="row between p-16" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="row gap-8 nw">
            <button className="btn ghost sm mobile-only" aria-label="Back to the list" onClick={() => setMobileView("list")}>
              <i className="i i-chev-l flip" />
            </button>
            <span className="avatar">{view.visitorName.slice(0, 2).toUpperCase()}</span>
            <div className="col gap-0">
              <span className="b">{view.visitorName}</span>
              <span className="xs muted">
                {view.site} · {view.language}
              </span>
            </div>
          </div>
          <div className="row gap-8">
            {view.state === "HANDOVER_PENDING" && (
              <>
                <span className="sm c-warning">Waiting {view.waited}</span>
                {view.canClaim && !readOnly && (
                  <button className="btn sm" disabled={pending} onClick={() => run(() => claimAction(view.id))}>
                    Claim
                  </button>
                )}
              </>
            )}
            {view.otherOwns && <span className="sm muted">{view.ownerName} is replying</span>}
            <span className={`stt ${view.tone}`}>{view.stateLabel}</span>
            <span className="mono muted" title="Ownership version; stale replies are rejected">
              v{view.version}
            </span>
            <button className="btn ghost sm mobile-only" onClick={() => setMobileView("details")}>Details</button>
          </div>
        </div>
        <div className="thread" role="log" aria-live="polite" aria-label="Messages" ref={logRef}>
          {view.messages.map((m) =>
            m.kind === "event" ? (
              <span key={m.id} className="ev">{m.text}</span>
            ) : (
              <div key={m.id} className="col gap-2" style={{ alignItems: m.kind === "visitor" ? "flex-start" : "flex-end" }}>
                <span className="xs muted">{m.who}</span>
                <div
                  className="bubble-ai"
                  dir="auto"
                  style={
                    m.kind === "ai"
                      ? { background: "#eef0ff", borderColor: "#c7cbf7", alignSelf: "flex-end" }
                      : m.kind === "note"
                        ? { background: "#fff4e0", borderColor: "#f2d4a2", alignSelf: "flex-end" }
                        : m.kind === "staff"
                          ? { alignSelf: "flex-end" }
                          : undefined
                  }
                >
                  {m.text}
                </div>
                {m.cite && <span className="xs muted">Source: {m.cite}</span>}
                <span className="xs muted">{m.time}</span>
              </div>
            ),
          )}
          {view.typing && <span className="xs muted">{view.agentName} is writing a reply…</span>}
        </div>
        {!readOnly && (
          <div className="p-12 col gap-8" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="row between">
              <div role="group" aria-label="Composer mode" className="seg">
                <button type="button" aria-pressed={!noteMode} className={!noteMode ? "on" : ""} onClick={() => setMode("reply")}>Reply to visitor</button>
                <button type="button" aria-pressed={noteMode} className={noteMode ? "on" : ""} onClick={() => setMode("note")}>Internal note</button>
              </div>
              <span className="xs muted">{hint}</span>
            </div>
            <div className="row nw gap-8">
              <label className="sr-only" htmlFor="dr">Message</label>
              <textarea
                id="dr"
                className="textarea"
                rows={2}
                placeholder={placeholder}
                disabled={composerOff}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={noteMode ? { background: "#fff8ec" } : undefined}
              />
              <button className="btn" disabled={composerOff || !draft.trim() || pending} onClick={() => run(() => sendAction(view.id, mode, draft, view.version), undefined, () => setDraft(""))}>
                <i className="i i-send" /> Send
              </button>
            </div>
            <div className="row gap-8">
              {view.canTake && (
                <button className="btn outline sm" disabled={pending} onClick={() => run(() => takeOverAction(view.id, view.version))}>
                  <i className="i i-headset" /> Take over
                </button>
              )}
              {view.mine && (
                <>
                  <button className="btn outline sm" onClick={() => setHandback(true)}>
                    <i className="i i-bot" /> Hand back to the AI
                  </button>
                  <button className="btn outline sm" disabled={pending} onClick={() => run(() => releaseAction(view.id))}>Release to queue</button>
                </>
              )}
              {!closed && (
                <button className="btn ghost sm" disabled={pending} onClick={() => run(() => closeAction(view.id))}>Close conversation</button>
              )}
            </div>
          </div>
        )}
      </section>
      <aside className="rail" aria-label="Conversation details" style={{ flexBasis: 280 }}>
        <button className="btn ghost sm mobile-only" onClick={() => setMobileView("thread")}>Back to the conversation</button>
        <div className="card p-16 col gap-6">
          <h2 className="h3">Visitor</h2>
          {view.details.map(([k, v]) => (
            <div key={k} className="row between nw sm">
              <span className="muted">{k}</span>
              <span className="trunc" style={{ maxWidth: 170 }} title={v}>{v}</span>
            </div>
          ))}
        </div>
        <div className="card p-16 col gap-6">
          <h2 className="h3">Ownership history</h2>
          <p className="xs muted">Every change: who, when, why</p>
          {view.history.map((h, i) => (
            <div key={i} className="col gap-0 sm">
              <span>{h.t}</span>
              <span className="xs muted">{h.d}</span>
            </div>
          ))}
        </div>
        <div className="card p-16 col gap-6">
          <h2 className="h3">What the AI used</h2>
          <p className="xs muted">Staff only. The visitor never sees this.</p>
          {view.used.length === 0 && <span className="xs muted">Nothing yet.</span>}
          {view.used.map((u, i) => (
            <div key={i} className="col gap-2 sm">
              <span className="mono">{u.t}</span>
              <span className="xs muted">{u.d}</span>
              {u.inputs && <span className="xs mono" style={{ wordBreak: "break-all" }}>{u.inputs}</span>}
              {u.waiting && view.mine && canApprove && !readOnly && u.id && (
                <span className="row gap-4">
                  <button className="btn sm" disabled={pending} onClick={() => run(() => approveAction(u.id!), "Approved. The tool ran once.")}>Approve</button>
                  <button className="btn outline sm" onClick={() => setRejecting(u.id!)}>Reject</button>
                </span>
              )}
              {u.waiting && !view.mine && <span className="xs c-warning">Claim the conversation to approve or reject.</span>}
            </div>
          ))}
        </div>
        <Link href="/knowledge?view=unanswered" className="xs">See unanswered questions</Link>
      </aside>

      <Dialog
        open={handback}
        title="Hand back to the AI"
        description="The AI continues with the full transcript and your note. The note is labelled as staff information and the visitor never sees it."
        onClose={() => setHandback(false)}
        footer={
          <>
            <button className="btn outline" onClick={() => setHandback(false)}>Cancel</button>
            <button className="btn" disabled={pending} onClick={() => run(() => handBackAction(view.id, note, tell), "Handed back to the AI.", () => {
              setHandback(false);
              setNote("");
            })}>
              Hand back
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="hb-n">Handover note</label>
          <textarea id="hb-n" className="textarea" rows={3} placeholder="For example: Refund approved. Customer wants confirmation by email." value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="hint">Leave it empty and Hiwar writes a summary from your part of the conversation.</span>
        </div>
        <label className="row gap-8 sm">
          <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell the visitor that the assistant is back
        </label>
      </Dialog>
      <Dialog
        open={rejecting !== null}
        title="Reject this action"
        description="The tool does not run. The reason is kept in the history and the audit log."
        onClose={() => setRejecting(null)}
        footer={
          <>
            <button className="btn outline" onClick={() => setRejecting(null)}>Cancel</button>
            <button className="btn destructive" disabled={!rejectReason.trim()} onClick={() => rejecting && run(() => rejectAction(rejecting, rejectReason), "Rejected.", () => {
              setRejecting(null);
              setRejectReason("");
            })}>
              Reject
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="rj">Reason</label>
          <input id="rj" className="input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </div>
      </Dialog>
    </>
  );
}
