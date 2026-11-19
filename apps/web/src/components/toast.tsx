"use client";

import { useEffect, useRef, useState } from "react";

/** PLT-004 FR-012, FR-022: a toast for 4.5 seconds, kept while hovered or focused, with Dismiss. */
export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent("hiwar-toast", { detail: message }));
}

const SHOW_MS = 4500;

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!held.current) setMessage(null);
      }, SHOW_MS);
    };
    window.addEventListener("hiwar-toast", listener);
    return () => window.removeEventListener("hiwar-toast", listener);
  }, []);

  if (!message) return null;
  const hold = () => {
    held.current = true;
  };
  const release = () => {
    held.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), SHOW_MS);
  };
  return (
    <div className="toast" role="status" aria-live="polite" onMouseEnter={hold} onMouseLeave={release} onFocus={hold} onBlur={release}>
      <span>{message}</span>
      <button className="btn ghost sm" aria-label="Dismiss" onClick={() => setMessage(null)}>
        <i className="i i-x" />
      </button>
    </div>
  );
}
