"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { textOn } from "@/server/contrast";

type Lang = "en" | "ar";
type Line =
  | { kind: "visitor" | "ai"; text: string; at: string; citations?: string[] }
  | { kind: "person"; text: string; name: string; at: string }
  | { kind: "status"; status: "waiting" | "joined" | "left" | "cancelled" | "reopened"; at: string }
  | { kind: "notice"; text: string; at: string };

interface State {
  status: string;
  offline: boolean;
  outsideHours: boolean;
  agentName: string;
  welcome: Record<Lang, string>;
  appearance: {
    brandColour: string;
    position: "right" | "left";
    showAiLabel: boolean;
    suggestions: Record<Lang, string[]>;
    rtl: boolean;
    preChatForm: boolean;
    talkToPerson: boolean;
    citations: boolean;
    languageOverride: "auto" | "en" | "ar";
  };
  offlineMessage: Record<Lang, string>;
  conversation: null | {
    state: "AI_ACTIVE" | "HANDOVER_PENDING" | "HUMAN_ACTIVE" | "CLOSED";
    lines: Line[];
    ownerName: string | null;
    typing: boolean;
    followUp: boolean;
    askFeedback: boolean;
    contactGiven: boolean;
    pendingTool: { id: string; name: string; inputs: Record<string, unknown> } | null;
  };
}

/** Copy from the C-Widget board, in English and Arabic. */
const T = {
  en: {
    open: "Open chat", close: "Close chat", ph: "Write a message", send: "Send", talk: "Talk to a person",
    ai: "AI assistant · answers may be imperfect", aiLabel: "AI assistant", typing: "is typing…",
    waitT: "Waiting for our team", waitD: "Usually under 2 minutes", waitLine: "You asked for a person. We are finding someone from the team.",
    soon: "A person will join shortly", cancel: "Cancel", joined: "A team member has joined", person: "A real person · online",
    from: "from support", left: (n: string) => `The team member left. ${n} will continue with you.`, cancelled: "You cancelled the request. The assistant continues.",
    offT: "We are offline right now", offD: "Leave your email and we will reply tomorrow morning.",
    followT: "No one is free right now", followD: "Leave your contact details and we will follow up.",
    name: "Name", email: "Email", phone: "Phone (optional)", message: "Message", submit: "Send", thanks: "Thanks. We will get back to you.",
    preT: "Before we start", start: "Start chat", helpful: "Was this helpful?", yes: "Yes", no: "No", thanksFb: "Thanks for your feedback.",
    confirm: "Confirm", confirmQ: (n: string) => `The assistant wants to: ${n}. Continue?`,
    lost: "Connection lost. We will send your message when you are back online.", lang: "عربي", source: "Source",
  },
  ar: {
    open: "افتح المحادثة", close: "أغلق المحادثة", ph: "اكتب رسالة", send: "إرسال", talk: "تحدث مع شخص",
    ai: "مساعد ذكي · قد تكون الإجابات غير دقيقة", aiLabel: "مساعد ذكي", typing: "يكتب…",
    waitT: "في انتظار أحد الفريق", waitD: "عادةً أقل من دقيقتين", waitLine: "طلبت التحدث مع شخص. ننتظر أحد الفريق.",
    soon: "سينضم إليك أحد الفريق قريبًا", cancel: "إلغاء", joined: "انضم أحد أفراد الفريق", person: "شخص حقيقي · متصل",
    from: "من فريق الدعم", left: (n: string) => `غادر أحد أفراد الفريق. ${n} ستكمل معك.`, cancelled: "ألغيت الطلب. سيكمل المساعد معك.",
    offT: "نحن غير متاحين الآن", offD: "اترك بريدك وسنرد عليك صباح الغد.",
    followT: "لا يوجد أحد متاح الآن", followD: "اترك بيانات التواصل وسنعود إليك.",
    name: "الاسم", email: "البريد الإلكتروني", phone: "الهاتف (اختياري)", message: "الرسالة", submit: "إرسال", thanks: "شكرًا. سنعود إليك قريبًا.",
    preT: "قبل أن نبدأ", start: "ابدأ المحادثة", helpful: "هل كانت المحادثة مفيدة؟", yes: "نعم", no: "لا", thanksFb: "شكرًا على رأيك.",
    confirm: "تأكيد", confirmQ: (n: string) => `يريد المساعد تنفيذ: ${n}. هل تريد المتابعة؟`,
    lost: "انقطع الاتصال. سنرسل رسالتك عند عودة الاتصال.", lang: "English", source: "المصدر",
  },
} as const;

function token(): string {
  const keyName = "hiwar_visitor";
  try {
    const existing = localStorage.getItem(keyName);
    if (existing) return existing;
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(keyName, fresh);
    return fresh;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export function Widget({ widgetKey, page, preview }: { widgetKey: string; page: string; preview: boolean }) {
  const [visitorToken] = useState(() => (typeof window === "undefined" ? "" : token()));
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(preview);
  const [lang, setLang] = useState<Lang>(() => (typeof navigator !== "undefined" && navigator.language.startsWith("ar") ? "ar" : "en"));
  const [draft, setDraft] = useState("");
  const queue = useRef<string[]>([]);
  const [online, setOnline] = useState(true);
  const [prechat, setPrechat] = useState<{ name: string; email: string; phone: string } | null>(null);
  const [contactSent, setContactSent] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const t = T[lang];
  const effectiveLang: Lang = state?.appearance.languageOverride && state.appearance.languageOverride !== "auto" ? state.appearance.languageOverride : lang;

  const load = useCallback(
    () =>
      fetch(`/api/widget/state?key=${encodeURIComponent(widgetKey)}&token=${visitorToken}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<State>) : null,
      ),
    [widgetKey, visitorToken],
  );
  const refresh = useCallback(
    () =>
      load()
        .then((data) => {
          if (data) {
            setState(data);
            // A refresh that started before the connection dropped may finish after it.
            setOnline(navigator.onLine);
          }
        })
        .catch(() => setOnline(false)),
    [load],
  );

  const post = useCallback(
    async (action: string, body: Record<string, unknown>) => {
      const response = await fetch(`/api/widget/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: widgetKey, token: visitorToken, ...body }),
      });
      await refresh();
      return response.ok;
    },
    [widgetKey, visitorToken, refresh],
  );

  useEffect(() => {
    document.body.style.background = "transparent";
    let alive = true;
    load()
      .then((data) => {
        if (alive && data) setState(data);
      })
      .catch(() => alive && setOnline(false));
    return () => {
      alive = false;
    };
  }, [load]);

  const hasConversation = Boolean(state?.conversation);
  useEffect(() => {
    const source = new EventSource(`/api/widget/live?key=${encodeURIComponent(widgetKey)}&token=${visitorToken}`);
    source.onmessage = () => void refresh();
    return () => source.close();
  }, [widgetKey, visitorToken, refresh, hasConversation]);

  // Tell the host page how big the frame must be (widget.js resizes the iframe).
  useEffect(() => {
    if (preview) return;
    window.parent.postMessage({ hiwar: "resize", open, position: state?.appearance.position ?? "right" }, "*");
  }, [open, preview, state?.appearance.position]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.conversation?.lines.length, state?.conversation?.typing]);

  const visitor = useMemo(
    () => ({ language: effectiveLang, page: page || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, device: typeof navigator !== "undefined" ? (/Mobi/.test(navigator.userAgent) ? "Mobile" : "Desktop") : undefined, ...(prechat ?? {}) }),
    [effectiveLang, page, prechat],
  );

  // DEP-003 FR-021: messages typed while offline are sent after reconnecting.
  useEffect(() => {
    const up = () => {
      setOnline(true);
      const waiting = queue.current;
      queue.current = [];
      for (const text of waiting) void post("message", { text, visitor });
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [post, visitor]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body) return;
    setDraft("");
    if (!online) {
      queue.current.push(body);
      return;
    }
    const ok = await post("message", { text: body, visitor }).catch(() => false);
    if (!ok) {
      setOnline(false);
      queue.current.push(body);
    }
  };

  if (!state) return null;
  const c = state.conversation;
  const brand = state.appearance.brandColour;
  const onBrand = textOn(brand);
  const rtl = effectiveLang === "ar" && state.appearance.rtl;
  const waiting = c?.state === "HANDOVER_PENDING";
  const human = c?.state === "HUMAN_ACTIVE";
  const showOffline = state.offline || (c?.followUp ?? false);
  const needPrechat = state.appearance.preChatForm && !c && !prechat;
  const firstVisitor = c?.lines.some((l) => l.kind === "visitor") ?? false;
  const side = state.appearance.position === "left" ? { insetInlineStart: 16 } : { insetInlineEnd: 16 };

  return (
    <div dir={rtl ? "rtl" : "ltr"} lang={effectiveLang} className="wg-root">
      {!open && (
        <button className="launch" style={{ background: brand, color: onBrand, position: "fixed", bottom: 12, ...side }} aria-label={t.open} onClick={() => setOpen(true)}>
          <i className="i i-message s24" />
        </button>
      )}
      {open && (
        <section className="wg" aria-label={state.agentName} style={{ position: preview ? "relative" : "fixed", inset: preview ? undefined : 0, width: "100%", height: preview ? 600 : "100%", borderRadius: preview ? 16 : 0 }}>
          <div className="row between p-12" style={{ background: brand, color: onBrand }}>
            <div className="row gap-8">
              <span className="avatar sm" style={{ background: "rgba(255,255,255,.2)", color: onBrand }}>
                {human ? (c?.ownerName ?? "?")[0] : waiting ? "…" : state.agentName[0]}
              </span>
              <div className="col gap-0">
                <span className="b">{human ? `${c?.ownerName} ${t.from}` : waiting ? t.waitT : state.agentName}</span>
                <span className="xs" style={{ opacity: 0.85 }}>{human ? t.person : waiting ? t.waitD : state.appearance.showAiLabel ? t.aiLabel : ""}</span>
              </div>
            </div>
            <div className="row gap-4">
              {state.appearance.languageOverride === "auto" && (
                <button className="btn ghost sm" style={{ color: onBrand }} onClick={() => setLang(lang === "en" ? "ar" : "en")}>
                  {t.lang}
                </button>
              )}
              {!preview && (
                <button className="btn ghost sm" style={{ color: onBrand }} aria-label={t.close} onClick={() => setOpen(false)}>
                  <i className="i i-x" />
                </button>
              )}
            </div>
          </div>

          {!online && (
            <div className="offline-banner" role="alert">
              {t.lost}
            </div>
          )}

          {needPrechat ? (
            <PreChat t={t} onStart={(v) => setPrechat(v)} />
          ) : showOffline && !contactSent && !c?.contactGiven ? (
            <ContactForm
              t={t}
              title={state.offline ? t.offT : t.followT}
              detail={state.offline ? state.offlineMessage[effectiveLang] || t.offD : t.followD}
              onSend={async (v) => {
                await post("contact", { ...v, language: effectiveLang });
                setContactSent(true);
              }}
            />
          ) : (
            <>
              <div className="wg-b" role="log" aria-live="polite" ref={logRef} style={{ flex: 1, height: "auto" }}>
                <div className="bubble-ai" dir="auto">{state.welcome[effectiveLang]}</div>
                {c?.lines.map((line, i) => {
                  if (line.kind === "status") {
                    const text =
                      line.status === "waiting" ? t.waitLine : line.status === "joined" ? t.joined : line.status === "left" ? t.left(state.agentName) : line.status === "cancelled" ? t.cancelled : "";
                    return text ? <span key={i} className="st">{text}</span> : null;
                  }
                  if (line.kind === "notice") return <span key={i} className="st" dir="auto">{line.text}</span>;
                  if (line.kind === "visitor") return <div key={i} className="bubble-me" dir="auto">{line.text}</div>;
                  if (i === 0 && line.kind === "ai") return null;
                  return (
                    <div key={i} className="col gap-2" style={{ alignItems: "flex-start" }}>
                      <div className={line.kind === "person" ? "bubble-person" : "bubble-ai"} dir="auto">{line.text}</div>
                      {line.kind === "ai" && line.citations && line.citations.length > 0 && (
                        <span className="xs muted">
                          {t.source}: {line.citations.join(", ")}
                        </span>
                      )}
                    </div>
                  );
                })}
                {c?.typing && <span className="xs muted">{state.agentName} {t.typing}</span>}
                {waiting && (
                  <span className="st">
                    {t.soon} ·{" "}
                    <button className="btn link sm" onClick={() => post("cancel", {})}>
                      {t.cancel}
                    </button>
                  </span>
                )}
                {c?.pendingTool && (
                  <div className="card p-12 col gap-8">
                    <span className="sm">{t.confirmQ(c.pendingTool.name)}</span>
                    <div className="row gap-8">
                      <button className="btn sm" style={{ background: brand, color: onBrand }} onClick={() => post("confirm", { toolCallId: c.pendingTool!.id, confirm: true })}>
                        {t.confirm}
                      </button>
                      <button className="btn outline sm" onClick={() => post("confirm", { toolCallId: c.pendingTool!.id, confirm: false })}>
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                )}
                {c?.askFeedback && !feedbackSent && (
                  <div className="card p-12 col gap-8">
                    <span className="sm">{t.helpful}</span>
                    <div className="row gap-8">
                      <button className="btn outline sm" onClick={() => post("feedback", { answer: "yes" }).then(() => setFeedbackSent(true))}>{t.yes}</button>
                      <button className="btn outline sm" onClick={() => post("feedback", { answer: "no" }).then(() => setFeedbackSent(true))}>{t.no}</button>
                    </div>
                  </div>
                )}
                {feedbackSent && <span className="st">{t.thanksFb}</span>}
                {!firstVisitor && (
                  <div className="row gap-6">
                    {state.appearance.suggestions[effectiveLang].map((s) => (
                      <button key={s} className="sg" onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-12 col gap-8" style={{ borderTop: "1px solid #dfe2f0" }}>
                <div className="row nw gap-8">
                  <label className="sr-only" htmlFor="wm">{t.ph}</label>
                  <input id="wm" className="input" placeholder={t.ph} value={draft} dir="auto" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(draft)} />
                  <button className="btn" style={{ background: brand, color: onBrand }} aria-label={t.send} disabled={!draft.trim()} onClick={() => send(draft)}>
                    <i className="i i-send flip" />
                  </button>
                </div>
                <div className="row between">
                  {state.appearance.talkToPerson && (!c || c.state === "AI_ACTIVE" || c.state === "CLOSED") ? (
                    <button className="btn link sm" onClick={() => post("person", { visitor })}>
                      {t.talk}
                    </button>
                  ) : (
                    <span />
                  )}
                  {state.appearance.showAiLabel && !human && <span className="xs muted">{t.ai}</span>}
                </div>
              </div>
            </>
          )}
          {contactSent && <p className="p-12 sm">{t.thanks}</p>}
        </section>
      )}
    </div>
  );
}

type Copy = (typeof T)[Lang];

function PreChat({ t, onStart }: { t: Copy; onStart: (v: { name: string; email: string; phone: string }) => void }) {
  const [v, setV] = useState({ name: "", email: "", phone: "" });
  const valid = v.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email);
  return (
    <div className="p-16 col gap-12" style={{ flex: 1 }}>
      <span className="b">{t.preT}</span>
      <input className="input" aria-label={t.name} placeholder={t.name} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input className="input" type="email" aria-label={t.email} placeholder={t.email} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <input className="input" aria-label={t.phone} placeholder={t.phone} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <button className="btn" disabled={!valid} onClick={() => onStart(v)}>
        {t.start}
      </button>
    </div>
  );
}

function ContactForm({ t, title, detail, onSend }: { t: Copy; title: string; detail: string; onSend: (v: { name: string; email: string; phone: string; message: string }) => void }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", message: "" });
  return (
    <div className="p-16 col gap-12" style={{ flex: 1 }}>
      <div className="col gap-4">
        <span className="b">{title}</span>
        <span className="sm muted">{detail}</span>
      </div>
      <input className="input" aria-label={t.name} placeholder={t.name} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input className="input" type="email" aria-label={t.email} placeholder={t.email} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <input className="input" aria-label={t.phone} placeholder={t.phone} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <textarea className="textarea" rows={3} aria-label={t.message} placeholder={t.message} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />
      <button className="btn" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)} onClick={() => onSend(v)}>
        {t.submit}
      </button>
    </div>
  );
}
