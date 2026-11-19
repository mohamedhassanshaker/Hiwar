"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Confirm, Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";
import {
  addFaqAction,
  addWebsiteAction,
  answerAction,
  deleteSourceAction,
  dismissAction,
  reprocessAction,
  setEnabledAction,
} from "./actions";

interface Source {
  id: string;
  name: string;
  type: "file" | "website" | "faq";
  status: "queued" | "processing" | "ready" | "failed";
  enabled: boolean;
  reason: string | null;
  chunks: number;
  updated: string;
  detail: string;
}
interface Question {
  id: string;
  question: string;
  language: string;
  suggestion: string;
  weekCount: number;
}

const TYPE = { file: "File", website: "Website", faq: "FAQ" } as const;
const STATUS: Record<string, [string, string]> = {
  ready: ["ok", "Ready"],
  processing: ["ai", "Processing"],
  queued: ["mut", "Queued"],
  failed: ["bad", "Failed"],
  off: ["mut", "Disabled"],
};

function when(iso: string): string {
  const d = new Date(iso);
  return Date.now() - d.getTime() < 60_000 ? "Just now" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function KnowledgeClient(props: {
  readOnly: boolean;
  initialView: "src" | "un";
  stats: { ready: number; total: number; chunks: number; storage: string; storageLimit: string; unansweredWeek: number };
  sources: Source[];
  unanswered: Question[];
}) {
  const router = useRouter();
  const [view, setView] = useState(props.initialView);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Source | null>(null);
  const [problem, setProblem] = useState<{ text: string; upgrade?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const ro = props.readOnly;

  const run = <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string; upgrade?: boolean }>, after?: (d?: T) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setProblem({ text: r.error ?? "Something went wrong.", upgrade: r.upgrade });
      setProblem(null);
      after?.(r.data);
      router.refresh();
    });

  const upload = async (files: FileList, sourceId?: string) => {
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    if (sourceId) form.append("sourceId", sourceId);
    const response = await fetch("/api/knowledge/upload", { method: "POST", body: form });
    const body = (await response.json()) as { error?: string; upgrade?: boolean };
    if (!response.ok) setProblem({ text: body.error ?? "Upload failed.", upgrade: body.upgrade });
    else setProblem(null);
    router.refresh();
    return response.ok;
  };

  const stats = [
    { k: "Sources ready", v: String(props.stats.ready), d: `of ${props.stats.total} sources` },
    { k: "Chunks searchable", v: String(props.stats.chunks), d: "Arabic and English" },
    { k: "Storage used", v: props.stats.storage, d: `of ${props.stats.storageLimit}` },
    { k: "Unanswered this week", v: String(props.stats.unansweredWeek), d: "questions with low confidence" },
  ];

  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Knowledge</h1>
          <p className="lead">What your agents can answer from. Arabic and English are both supported, including mixed documents. Nothing is shared with other organizations.</p>
        </div>
        {!ro && (
          <button className="btn" onClick={() => setAdding(true)}>
            <i className="i i-plus" /> Add a source
          </button>
        )}
      </div>
      {problem && (
        <p className="note-p c-danger" role="alert">
          {problem.text} {problem.upgrade && <Link href="/billing">Upgrade</Link>}
        </p>
      )}
      <div className="grid g4">
        {stats.map((s) => (
          <div key={s.k} className="card p-16 col gap-4">
            <span className="over">{s.k}</span>
            <span className="num">{s.v}</span>
            <span className="xs muted">{s.d}</span>
          </div>
        ))}
      </div>
      <div role="group" aria-label="Knowledge views" className="tabs">
        <button className={view === "src" ? "tab on" : "tab"} aria-pressed={view === "src"} onClick={() => setView("src")}>
          Sources
        </button>
        <button className={view === "un" ? "tab on" : "tab"} aria-pressed={view === "un"} onClick={() => setView("un")}>
          Unanswered questions <span className="tnum">{props.unanswered.length}</span>
        </button>
      </div>

      {view === "src" && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="r">Chunks</th>
                  <th scope="col">Updated</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {props.sources.map((s) => {
                  const key = !s.enabled && s.status === "ready" ? "off" : s.status;
                  const [tone, label] = STATUS[key];
                  const again = s.type === "website" ? "Re-crawl" : s.status === "failed" ? "Retry" : s.type === "file" ? "Replace" : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="col gap-2">
                          <span className="b">{s.name}</span>
                          <span className="xs muted">{s.detail}</span>
                        </div>
                      </td>
                      <td>{TYPE[s.type]}</td>
                      <td>
                        <span className={`stt ${tone}`}>{label}</span>
                        {s.status === "failed" && s.reason && <div className="xs c-danger">{s.reason}</div>}
                      </td>
                      <td className="r tnum">{s.chunks}</td>
                      <td className="sm muted">{when(s.updated)}</td>
                      <td className="r">
                        {!ro && (
                          <span className="row end gap-4 nw">
                            {again && (
                              <button
                                className="btn ghost sm"
                                disabled={pending || s.status === "processing" || s.status === "queued"}
                                onClick={() => {
                                  if (again === "Replace") {
                                    setReplacing(s.id);
                                    replaceInput.current?.click();
                                  } else run(() => reprocessAction(s.id));
                                }}
                              >
                                {again}
                              </button>
                            )}
                            {s.status === "ready" && (
                              <button className="btn ghost sm" aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`} onClick={() => run(() => setEnabledAction(s.id, !s.enabled))}>
                                {s.enabled ? "Disable" : "Enable"}
                              </button>
                            )}
                            <button className="btn ghost sm" aria-label={`Delete ${s.name}`} onClick={() => setDeleting(s)}>
                              <i className="i i-trash" />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {props.sources.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">
                        <span className="b">No sources yet</span>
                        <span className="sm muted">Upload files, crawl your website or write FAQ entries.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="note-p">How a source is prepared: Hiwar extracts the text, splits it into chunks, embeds and indexes it. Changes to a page or file update only what changed.</p>
          <input
            ref={replaceInput}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.csv"
            onChange={async (e) => {
              if (e.target.files?.length && replacing) await upload(e.target.files, replacing);
              e.target.value = "";
              setReplacing(null);
            }}
          />
        </>
      )}

      {view === "un" && <Unanswered questions={props.unanswered} ro={ro} run={run} />}

      <AddSource open={adding} onClose={() => setAdding(false)} upload={upload} run={run} />
      <Confirm
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="The source and its chunks are removed. Agents stop answering from it. Past conversations keep their citations."
        confirm="Delete source"
        destructive
        busy={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          run(() => deleteSourceAction(deleting.id), (name) => {
            toast(`Removed ${name} and its chunks. Past conversations keep their citations.`);
            setDeleting(null);
          })
        }
      />
    </>
  );
}

function Unanswered({
  questions,
  ro,
  run,
}: {
  questions: Question[];
  ro: boolean;
  run: <T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, after?: (d?: T) => void) => void;
}) {
  const [open, setOpen] = useState<Record<string, string>>({});
  return (
    <div className="card">
      <div className="p-16 col gap-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="h2">Questions the agent could not answer well</h2>
        <p className="sm muted">Retrieval confidence was low. Add an answer and the agent can use it straight away.</p>
      </div>
      {questions.length === 0 && (
        <div className="empty" style={{ margin: 16 }}>
          <span className="b">Nothing waiting</span>
          <span className="sm muted">New unanswered questions show up here.</span>
        </div>
      )}
      {questions.map((q) => (
        <div key={q.id} className="row between top p-16" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="col gap-4 grow">
            <span className="b" dir="auto">{q.question}</span>
            <span className="xs muted">
              Asked {q.weekCount} times this week · {q.language}
            </span>
            {open[q.id] !== undefined && (
              <div className="field">
                <label className="label" htmlFor={`ua-${q.id}`}>Suggested answer</label>
                <textarea id={`ua-${q.id}`} className="textarea" rows={3} dir="auto" value={open[q.id]} onChange={(e) => setOpen({ ...open, [q.id]: e.target.value })} />
              </div>
            )}
          </div>
          {!ro && (
            <div className="row gap-4 nw">
              {open[q.id] !== undefined ? (
                <button
                  className="btn sm"
                  disabled={!open[q.id].trim()}
                  onClick={() => run(() => answerAction(q.id, open[q.id]), () => toast("Added to your FAQ. The agent can use it now."))}
                >
                  Add as FAQ
                </button>
              ) : (
                <button className="btn outline sm" onClick={() => setOpen({ ...open, [q.id]: q.suggestion })}>
                  Write an answer
                </button>
              )}
              <button className="btn ghost sm" onClick={() => run(() => dismissAction(q.id))}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AddSource({
  open,
  onClose,
  upload,
  run,
}: {
  open: boolean;
  onClose: () => void;
  upload: (files: FileList) => Promise<boolean>;
  run: <T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, after?: (d?: T) => void) => void;
}) {
  const [kind, setKind] = useState<"file" | "url" | "faq">("file");
  const [files, setFiles] = useState<FileList | null>(null);
  const [url, setUrl] = useState("https://");
  const [depth, setDepth] = useState(2);
  const [domains, setDomains] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (kind === "file") {
      if (!files?.length) return;
      setBusy(true);
      const ok = await upload(files);
      setBusy(false);
      if (ok) onClose();
    } else if (kind === "url") {
      const list = domains.split(/[,\s]+/).filter(Boolean);
      run(() => addWebsiteAction({ url, depth, domains: list }), onClose);
    } else {
      run(() => addFaqAction({ question, answer }), onClose);
    }
  };
  return (
    <Dialog
      open={open}
      title="Add a source"
      description="Upload files, crawl a website or write FAQ entries by hand."
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>Add and prepare</button>
        </>
      }
    >
      <div role="group" aria-label="Source type" className="seg">
        {(
          [
            ["file", "Upload files"],
            ["url", "Website"],
            ["faq", "FAQ entry"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {kind === "file" && (
        <label
          className="dropzone col center gap-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles(e.dataTransfer.files);
          }}
        >
          <i className="i i-upload s24" />
          <span className="b">{files?.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : "Drop files here or browse"}</span>
          <span className="xs muted">PDF, DOCX, TXT, MD or CSV. Up to 25 MB each.</span>
          <input type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => setFiles(e.target.files)} />
        </label>
      )}
      {kind === "url" && (
        <>
          <div className="field">
            <label className="label" htmlFor="ku">Website address</label>
            <input id="ku" className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid g2">
            <div className="field">
              <label className="label" htmlFor="kd">Crawl depth</label>
              <select id="kd" className="select" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                <option value={1}>1 level</option>
                <option value={2}>2 levels</option>
                <option value={3}>3 levels</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="kl">Stay on these domains</label>
              <input id="kl" className="input" placeholder="example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
            </div>
          </div>
        </>
      )}
      {kind === "faq" && (
        <>
          <div className="field">
            <label className="label" htmlFor="kq">Question</label>
            <input id="kq" className="input" dir="auto" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ka">Answer</label>
            <textarea id="ka" className="textarea" rows={4} dir="auto" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </div>
        </>
      )}
    </Dialog>
  );
}
