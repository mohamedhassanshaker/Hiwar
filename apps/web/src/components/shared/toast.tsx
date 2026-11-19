"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Ic } from "@/components/ui/icon";
import { useAwp } from "@/hooks/use-awp";

/**
 * What an action said, raised where the person is looking rather than at the top of a
 * screen they have already scrolled past.
 *
 * One host for the whole console, beside the shell: a toast raised by a row that then
 * disappears — a removed source, a deleted collection — is not unmounted with it.
 */

/** How long a toast stays when nobody is looking at it. */
const TOAST_MS = 6000;

export type ToastTone = "ok" | "bad";

type Toast = { id: number; tone: ToastTone; text: string };

type ToastApi = {
  /** Raises a toast. An empty message raises nothing, so an action with nothing to say is silent. */
  say: (text: string | null | undefined | void, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * The toast API.
 *
 * Outside the console shell — the sign-in screens, a test that renders one component —
 * there is no host, and saying something is a no-op rather than a crash.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  const absent = useMemo<ToastApi>(() => ({ say: () => undefined }), []);
  return api ?? absent;
}

/**
 * One toast: its icon, text and a dismiss button. It closes itself after 6 seconds unless
 * hovered or focused; an error toast is announced as an alert.
 */
function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { t } = useAwp();
  const [held, setHeld] = useState(false);

  useEffect(() => {
    // Held while the pointer is on it: a toast that vanishes mid-read is worse than none.
    if (held) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, onClose]);

  return (
    <div
      className="qr-toast"
      data-tone={toast.tone}
      role={toast.tone === "bad" ? "alert" : "status"}
      aria-live={toast.tone === "bad" ? "assertive" : "polite"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="qr-toast-ic" aria-hidden="true">
        <Ic
          n={toast.tone === "bad" ? "Alert02" : "TickCircle"}
          s={18}
          c={toast.tone === "bad" ? "var(--icon-danger)" : "var(--icon-success)"}
        />
      </span>
      <div className="qr-toast-b">
        <div className="qr-toast-h">
          <b>{toast.text}</b>
          <button className="qr-x" onClick={onClose} aria-label={t("Dismiss", "إغلاق")}>
            <Ic n="Cancel01" s={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Holds the toasts and renders the host. Wraps the console shell. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The id is a counter rather than a timestamp: two toasts raised in the same millisecond
  // would otherwise share a key and React would reuse one card for both.
  const next = useRef(0);

  const say = useCallback((text: string | null | undefined | void, tone: ToastTone = "ok") => {
    if (!text) return;
    const id = (next.current += 1);
    setToasts((before) => [...before, { id, tone, text }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ say }), [say]);
  const close = useCallback((id: number) => setToasts((before) => before.filter((one) => one.id !== id)), []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div className="awp-toasts">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onClose={() => close(toast.id)} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
