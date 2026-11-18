"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { MsgBody } from "@/components/shared/message";
import type { Action, Input, Lang } from "@/features/engage/protocol";
import type { SessionView, WidgetConfig } from "@/features/engage/widget-session";
import { useVoiceInput, withSpoken } from "@/hooks/use-voice-input";

import { Composer } from "./widget-composer";
import { MessageView } from "./widget-message";

/**
 * The embedded widget (widget specification sections 4 to 6 and 13, D231).
 *
 * It renders what the server sends — blocks, a composer instruction, the flow — and decides
 * nothing from text. The session token lives in this frame's session storage, so a page
 * navigation on the host site restores the panel; the visitor key lives in local storage,
 * so a half-finished scenario can be offered back within its retention.
 */

type CallError = { code: string; message: string; messageAr?: string; retryAfter: number | null };

class WidgetCallError extends Error {
  constructor(readonly detail: CallError) {
    super(detail.message);
  }
}

const storage = {
  /** The stored value, or null when there is none or storage is refused. */
  get(kind: "session" | "local", key: string): string | null {
    try {
      return (kind === "session" ? sessionStorage : localStorage).getItem(key);
    } catch {
      return null;
    }
  },
  /** Stores a value, or removes it when null; a refused write is ignored. */
  set(kind: "session" | "local", key: string, value: string | null): void {
    try {
      const store = kind === "session" ? sessionStorage : localStorage;
      if (value === null) store.removeItem(key);
      else store.setItem(key, value);
    } catch {
      // Storage refused (a private window): the session still works, only not across reloads.
    }
  },
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

type Pending = { id: string; text: string; failed?: boolean };

/**
 * The widget panel inside its frame: header and menu, notices, the message list, the rating at
 * the end, and the composer. It restores the tab's session or starts one, follows the session's
 * event stream (reconnecting after 3 s), answers `awp:` messages only from the host page's
 * origin, and keeps a message sent while offline to send again when the connection returns.
 */
export function WidgetFrame({
  config,
  lang: initialLang,
  page,
  host,
  preview,
}: {
  config: WidgetConfig;
  lang: Lang;
  page: string | null;
  host: string | null;
  preview: boolean;
}) {
  const keyOf = (name: string) => `awp.widget.${config.deployment}.${name}`;
  const [lang, setLang] = useState<Lang>(initialLang);
  const [session, setSession] = useState<SessionView | null>(null);
  const [problem, setProblem] = useState<CallError | null>(null);
  const [offline, setOffline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [limitedUntil, setLimitedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [disclaimerClosed, setDisclaimerClosed] = useState(() => storage.get("session", keyOf("disclaimer")) === "closed");
  const [menuOpen, setMenuOpen] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const t = useCallback((en: string, ar: string) => (lang === "ar" ? ar : en), [lang]);
  const title = lang === "ar" ? config.title.ar : config.title.en;
  const accent = config.accentColour ?? undefined;

  // A page opened as a file has the origin `null`, which no message can be addressed to; it
  // is sent to whatever parent framed this. No message carries the session token.
  const parent = useCallback(
    (message: Record<string, unknown>) => {
      if (window.parent === window || !host) return;
      window.parent.postMessage(message, host !== "null" ? host : "*");
    },
    [host],
  );

  const remember = useCallback(
    (view: SessionView) => {
      tokenRef.current = view.sessionToken;
      storage.set("session", keyOf("token"), view.sessionToken);
      storage.set("session", keyOf("sid"), view.sessionId);
      setSession(view);
    },
    // keyOf depends only on the deployment code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.deployment],
  );

  const call = useCallback(async (path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`/embed/v1${path}`, {
        method: init.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(tokenRef.current ? { authorization: `Bearer ${tokenRef.current}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      setOffline(true);
      throw new WidgetCallError({ code: "OFFLINE", message: "Connection lost. Retrying…", messageAr: "انقطع الاتصال. جارٍ إعادة المحاولة…", retryAfter: null });
    }
    setOffline(false);
    if (response.status === 204) return null;
    const body = (await response.json().catch(() => null)) as { error?: CallError } | null;
    if (!response.ok) {
      throw new WidgetCallError(
        body?.error ?? { code: "TOOL_UNAVAILABLE", message: "The assistant is not responding.", messageAr: "المساعد لا يستجيب.", retryAfter: null },
      );
    }
    return body;
  }, []);

  /** Shows a refusal the way the specification says to (section 14). */
  const refused = useCallback((error: unknown) => {
    if (!(error instanceof WidgetCallError)) {
      setProblem({ code: "TOOL_UNAVAILABLE", message: "The assistant is not responding.", retryAfter: null });
      return;
    }
    const detail = error.detail;
    if (detail.code === "RATE_LIMITED") setLimitedUntil(Date.now() + (detail.retryAfter ?? 60) * 1000);
    if (detail.code === "ORIGIN_NOT_ALLOWED" || detail.code === "DEPLOYMENT_DISABLED") console.warn(`[assistant] ${detail.message}`);
    if (detail.code !== "OFFLINE") setProblem(detail);
  }, []);

  const start = useCallback(async () => {
    const visitorKey = storage.get("local", keyOf("visitor")) ?? newId();
    storage.set("local", keyOf("visitor"), visitorKey);
    const view = (await call("/sessions", {
      body: { deployment: config.deployment, lang, context: page ? { page } : {}, host, visitorKey, preview },
    })) as SessionView;
    remember(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, config.deployment, host, lang, page, preview, remember]);

  // The session: the one this tab already holds, or a new one.
  useEffect(() => {
    const token = storage.get("session", keyOf("token"));
    const sid = storage.get("session", keyOf("sid"));
    tokenRef.current = token;
    (async () => {
      try {
        if (token && sid) {
          try {
            remember((await call(`/sessions/${sid}`, { method: "GET" })) as SessionView);
            return;
          } catch (error) {
            if (!(error instanceof WidgetCallError) || error.detail.code !== "SESSION_EXPIRED") throw error;
            tokenRef.current = null;
          }
        }
        await start();
      } catch (error) {
        refused(error);
      }
    })();
    // The session is started once per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stream: replies as they are written, and every move of the conversation.
  const sessionId = session?.sessionId ?? null;
  useEffect(() => {
    if (!sessionId) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped || !tokenRef.current) return;
      source = new EventSource(`/embed/v1/sessions/${sessionId}/stream?token=${encodeURIComponent(tokenRef.current)}`);
      source.onopen = () => setOffline(false);
      source.addEventListener("message.start", () => setStreaming(""));
      source.addEventListener("message.delta", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { text: string };
        setStreaming((said) => (said ?? "") + data.text);
      });
      source.addEventListener("message.end", () => {
        setStreaming(null);
        // The loader shows the unread dot only while the panel is closed.
        parent({ type: "awp:unread" });
      });
      source.addEventListener("typing", (event) => setTyping((JSON.parse((event as MessageEvent<string>).data) as { on: boolean }).on));
      source.addEventListener("session.update", (event) => remember(JSON.parse((event as MessageEvent<string>).data) as SessionView));
      source.onerror = () => {
        source?.close();
        setOffline(true);
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [sessionId, parent, remember]);

  // The host page: open, close, start an action, change the language.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!host || event.origin !== host) return;
      const data = (event.data ?? {}) as { type?: string; action?: string; lang?: string };
      if (data.type === "awp:open") {
        setTimeout(() => composerRef.current?.focus(), 50);
        if (tokenRef.current && sessionId) void call(`/sessions/${sessionId}/events`, { body: { name: "widget.opened", props: { page: page ?? "" } } }).catch(() => undefined);
      }
      if (data.type === "awp:close") {
        if (tokenRef.current && sessionId) void call(`/sessions/${sessionId}/events`, { body: { name: "widget.closed", props: {} } }).catch(() => undefined);
      }
      if (data.type === "awp:start" && data.action) setPendingStart(data.action);
      if (data.type === "awp:expanded") setExpanded(Boolean((data as { expanded?: boolean }).expanded));
      if (data.type === "awp:lang") void changeLang(data.lang === "ar" ? "ar" : "en");
    };
    window.addEventListener("message", onMessage);
    parent({ type: "awp:ready" });
    return () => window.removeEventListener("message", onMessage);
    // act and changeLang read the current session through refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, sessionId]);

  // A countdown while rate limited.
  useEffect(() => {
    if (!limitedUntil) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= limitedUntil) setLimitedUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [limitedUntil]);

  // Unsent messages go once the connection is back.
  useEffect(() => {
    if (offline || !sessionId) return;
    const failed = unsent.filter((one) => one.failed);
    if (!failed.length) return;
    for (const one of failed) void sendText(one.text, one.id);
    // sendText is stable over a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // The list opens on the latest message and follows new ones.
  const messages = useMemo(() => session?.messages ?? [], [session]);

  // `startAction` names a quick action by its id, or a scenario by its code. It waits for the
  // greeting, which carries the quick actions, when the host page calls it before that.
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingStart || !sessionId || !messages.length) return;
    const chip = messages
      .flatMap((message) => message.blocks)
      .flatMap((block) => (block.type === "chips" ? block.items : []))
      .find((item) => item.id === pendingStart && item.action.type === "start_scenario");
    setPendingStart(null);
    void act(chip ? chip.action : { type: "start_scenario", scenario: pendingStart });
    // act reads the current session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStart, sessionId, messages]);

  // The host page hears when the conversation ends (specification 3.2, `on("conversation:end")`).
  const ended = session?.state.ended ?? false;
  useEffect(() => {
    if (ended) parent({ type: "awp:event", name: "conversation:end", detail: { sessionId } });
  }, [ended, parent, sessionId]);
  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, unsent.length, streaming, typing]);

  const sendText = async (text: string, id = newId()) => {
    if (!sessionId) return;
    setUnsent((pending) => [...pending.filter((one) => one.id !== id), { id, text }]);
    setProblem(null);
    try {
      remember((await call(`/sessions/${sessionId}/messages`, { body: { text, clientMessageId: id } })) as SessionView);
      setUnsent((pending) => pending.filter((one) => one.id !== id));
    } catch (error) {
      if (error instanceof WidgetCallError && error.detail.code === "OFFLINE") {
        setUnsent((pending) => pending.map((one) => (one.id === id ? { ...one, failed: true } : one)));
      } else {
        setUnsent((pending) => pending.filter((one) => one.id !== id));
        refused(error);
      }
    }
  };

  /** Sends a chip, button or field action and shows the session it returns, or the refusal. */
  async function act(action: Action) {
    if (!sessionId) return;
    setBusy(true);
    setProblem(null);
    try {
      remember((await call(`/sessions/${sessionId}/actions`, { body: action })) as SessionView);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(false);
    }
  }

  /** Switches the panel's language, tells the host page, and saves it on the session. */
  async function changeLang(next: Lang) {
    setLang(next);
    setMenuOpen(false);
    parent({ type: "awp:lang", lang: next });
    if (!sessionId) return;
    try {
      remember((await call(`/sessions/${sessionId}/language`, { body: { lang: next } })) as SessionView);
    } catch (error) {
      refused(error);
    }
  }

  const post = async (path: string, body: unknown) => {
    if (!sessionId) return;
    setBusy(true);
    setProblem(null);
    try {
      remember((await call(`/sessions/${sessionId}${path}`, { body })) as SessionView);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(false);
    }
  };

  // D386: the recording is sent to the session's transcription endpoint; its text joins the draft.
  const transcribe = async (audio: Blob): Promise<string> => {
    if (!sessionId || !tokenRef.current) throw new WidgetCallError({ code: "SESSION_EXPIRED", message: "Start the conversation first.", messageAr: "ابدأ المحادثة أولاً.", retryAfter: null });
    let response: Response;
    try {
      response = await fetch(`/embed/v1/sessions/${sessionId}/transcriptions`, {
        method: "POST",
        headers: { "content-type": audio.type, authorization: `Bearer ${tokenRef.current}` },
        body: audio,
      });
    } catch {
      throw new WidgetCallError({ code: "OFFLINE", message: "Connection lost. Try again.", messageAr: "انقطع الاتصال. حاول مرة أخرى.", retryAfter: null });
    }
    const body = (await response.json().catch(() => null)) as { text?: string; error?: CallError } | null;
    if (!response.ok) {
      throw new WidgetCallError(body?.error ?? { code: "TOOL_UNAVAILABLE", message: "Your speech could not be turned into text.", messageAr: "تعذّر تحويل كلامك إلى نص.", retryAfter: null });
    }
    return body?.text ?? "";
  };
  const voice = useVoiceInput({
    transcribe,
    onText: (spoken) => {
      setProblem(null);
      setDraft((current) => withSpoken(current, spoken));
      composerRef.current?.focus();
    },
    onProblem: (message, cause) => (cause instanceof WidgetCallError ? refused(cause) : setProblem({ code: "VALIDATION_FAILED", message, retryAfter: null })),
    t,
  });

  const speak = (text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "ar" ? "ar-AE" : "en-US";
    window.speechSynthesis.speak(utterance);
  };

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const input: Input = lastAssistant?.input ?? { mode: "free" };
  const limited = limitedUntil !== null && limitedUntil > now;
  const verifying = input.mode === "field" && input.field.type === "otp";

  const minimize = () => parent({ type: "awp:minimize" });
  // The loader fills the host page with the frame, or puts it back, and says which it did.
  const expand = () => parent({ type: "awp:expand" });

  return (
    <div
      className={"awp-wf" + (expanded ? " is-expanded" : "")}
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      role="dialog"
      aria-label={title}
      style={accent ? ({ ["--wf-accent" as string]: accent } as CSSProperties) : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") minimize();
      }}
    >
      <header className="awp-wf-head">
        <span className="awp-wf-logo" aria-hidden="true">
          <Sparkle />
        </span>
        <h1 className="awp-wf-title">{title}</h1>
        <div className="awp-wf-menu-wrap">
          <button type="button" className="awp-wf-icon" aria-label={t("Menu", "القائمة")} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <span aria-hidden="true">⋮</span>
          </button>
          {menuOpen && (
            <div className="awp-wf-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void changeLang(lang === "ar" ? "en" : "ar")}>
                {lang === "ar" ? "English" : "العربية"}
              </button>
              {!ended && config.handoff && (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void act({ type: "handoff", reason: "user_request" }); }}>
                  {t("Talk to a person", "التحدث مع موظف")}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void act({ type: "restart" }); }}>
                {t("Start a new conversation", "بدء محادثة جديدة")}
              </button>
            </div>
          )}
        </div>
        <button type="button" className="awp-wf-icon" aria-label={t("Minimize", "تصغير")} onClick={minimize}>
          <span aria-hidden="true">—</span>
        </button>
        <button type="button" className="awp-wf-icon" aria-label={expanded ? t("Restore", "استعادة الحجم") : t("Expand", "توسيع")} aria-pressed={expanded} onClick={expand}>
          <span aria-hidden="true">{expanded ? "⤡" : "⤢"}</span>
        </button>
      </header>

      {/* The conversation sits in an inset card, as the console's assistant panel does. */}
      <div className="awp-wf-body">
      {config.disclaimer && !disclaimerClosed && (
        <div className="awp-wf-disclaimer" role="note">
          <span>{lang === "ar" ? config.disclaimer.ar : config.disclaimer.en}</span>
          {config.disclaimer.dismissible && (
            <button
              type="button"
              className="awp-wf-icon awp-wf-small"
              aria-label={t("Close notice", "إغلاق الملاحظة")}
              onClick={() => {
                setDisclaimerClosed(true);
                storage.set("session", keyOf("disclaimer"), "closed");
              }}
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
      )}

      {offline && (
        <div className="awp-wf-notice awp-wf-warning" role="status">
          {t("Connection lost. Retrying…", "انقطع الاتصال. جارٍ إعادة المحاولة…")}
        </div>
      )}
      {session?.state.handoff === "connected" && (
        <div className="awp-wf-notice awp-wf-info" role="status">
          {t("You are now chatting with a person.", "أنت الآن تتحدث مع موظف.")}
        </div>
      )}
      {session?.state.resumable && (
        <div className="awp-wf-notice awp-wf-info" role="status">
          <span>{t("You have a request in progress.", "لديك طلب قيد الإنجاز.")}</span>
          <span className="awp-wf-row">
            <button type="button" className="awp-wf-chip" onClick={() => void post("/resume", { choice: "continue" })}>
              {t("Continue where you left off", "المتابعة من حيث توقفت")}
            </button>
            <button type="button" className="awp-wf-chip" onClick={() => void post("/resume", { choice: "start_over" })}>
              {t("Start over", "البدء من جديد")}
            </button>
          </span>
        </div>
      )}
      {preview && session?.previewOtp && (
        <div className="awp-wf-notice awp-wf-info" role="status">
          {t(`Preview only: the one-time code is ${session.previewOtp}.`, `للمعاينة فقط: رمز التحقق هو ${session.previewOtp}.`)}
        </div>
      )}

      <div className={"awp-wf-list" + (verifying ? " awp-wf-readonly" : "")} ref={listRef} aria-live="polite" aria-relevant="additions">
        {!session && !problem && <div className="awp-wf-muted">{t("Connecting…", "جارٍ الاتصال…")}</div>}
        {messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            active={message === lastAssistant && !ended}
            busy={busy}
            lang={lang}
            t={t}
            readAloud={config.readAloud}
            onAct={(action) => void act(action)}
            onSpeak={speak}
            onFeedback={(value) => void post("/feedback", { messageId: message.id, value })}
          />
        ))}
        {unsent.map((one) => (
          <div key={one.id} className="awp-wf-msg awp-wf-user">
            <div className="awp-wf-bubble">{one.text}</div>
            {one.failed && <div className="awp-wf-meta">{t("Not sent yet. It will go when the connection is back.", "لم تُرسل بعد. ستُرسل عند عودة الاتصال.")}</div>}
          </div>
        ))}
        {streaming !== null && streaming !== "" && (
          <div className="awp-wf-msg awp-wf-bot">
            <div className="awp-wf-bubble">
              <MsgBody text={streaming} />
            </div>
          </div>
        )}
        {(typing || session?.state.pending) && (streaming === null || streaming === "") && (
          <div className="awp-wf-msg awp-wf-bot" role="status" aria-label={t("The assistant is typing", "المساعد يكتب")}>
            <div className="awp-wf-bubble awp-wf-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {ended && session && session.state.rating === null && (
          <div className="awp-wf-rating">
            <span>{t("How was this conversation?", "ما تقييمك لهذه المحادثة؟")}</span>
            <span className="awp-wf-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" className="awp-wf-star" aria-label={t(`${value} of 5`, `${value} من 5`)} onClick={() => void post("/feedback", { rating: value })}>
                  ★
                </button>
              ))}
            </span>
          </div>
        )}
      </div>

      {problem && problem.code !== "OFFLINE" && (
        <div className="awp-wf-notice awp-wf-error" role="alert">
          <span>{lang === "ar" && problem.messageAr ? problem.messageAr : problem.message}</span>
          {problem.code === "SESSION_EXPIRED" && (
            <button type="button" className="awp-wf-chip" onClick={() => { tokenRef.current = null; setProblem(null); void start().catch(refused); }}>
              {t("Start again", "البدء من جديد")}
            </button>
          )}
          {problem.code === "TOOL_UNAVAILABLE" && !ended && (
            <button type="button" className="awp-wf-chip" onClick={() => void act({ type: "handoff", reason: "tool_failure" })}>
              {t("Talk to a person", "التحدث مع موظف")}
            </button>
          )}
        </div>
      )}
      {limited && (
        <div className="awp-wf-notice awp-wf-warning" role="status">
          {t(`You are sending messages quickly. Try again in ${Math.ceil(((limitedUntil ?? now) - now) / 1000)} s.`, `ترسل الرسائل بسرعة. حاول مجدداً بعد ${Math.ceil(((limitedUntil ?? now) - now) / 1000)} ث.`)}
        </div>
      )}

      <Composer
        input={input}
        step={lastAssistant?.flow?.step ?? null}
        disabled={!session || limited || busy || ended}
        title={title}
        lang={lang}
        t={t}
        draft={draft}
        setDraft={setDraft}
        composerRef={composerRef}
        voice={config.voiceInput}
        voiceState={voice.state}
        onMic={voice.toggle}
        onSend={(text) => {
          setDraft("");
          void sendText(text);
        }}
        onField={(field, value) => void act({ type: "field_submit", field, value, step: lastAssistant?.flow?.step ?? null })}
        onUpload={async (name, dataUrl) => {
          if (!sessionId) return null;
          try {
            const result = (await call(`/sessions/${sessionId}/files`, { body: { name, dataUrl } })) as { fileId: string; view: SessionView };
            remember(result.view);
            return result.fileId;
          } catch (error) {
            refused(error);
            return null;
          }
        }}
        onOtp={(code) => void post("/otp/verify", { code })}
        onResend={() => void post("/otp/send", {})}
        onCancel={() => void act({ type: "cancel", step: lastAssistant?.flow?.step ?? null })}
      />
      </div>
    </div>
  );
}

/** The assistant mark in the header. */
function Sparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4L12 3z" fill="currentColor" />
      <path d="M18.5 15l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7.7-2z" fill="currentColor" />
    </svg>
  );
}
