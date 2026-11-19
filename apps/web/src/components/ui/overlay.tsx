"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useAwp } from "@/hooks/use-awp";
import { Ic } from "./icon";

/** Escape is the standard way out of an ARIA dialog, alongside its own explicit controls. */
function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onEscape]);
}

/**
 * A modal dialog of at most `w` pixels with a title, a close button, a body and an optional
 * footer. Escape, the scrim and the close button all close it; when `dirty`, they first ask
 * whether to discard the edits.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  w = 560,
  dirty,
}: {
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  w?: number;
  /** `COM-17`: when the form has been edited, closing asks before it throws the edits away. */
  dirty?: boolean;
}) {
  const { t } = useAwp();
  const [confirming, setConfirming] = useState(false);
  const close = () => (dirty ? setConfirming(true) : onClose());
  useEscapeKey(close);
  // The Dashboard 3 glass panel handoff v2 restyles every modal to: a scrim of its own
  // rather than a clickable backdrop wrapping the panel, so a drag that starts inside the
  // panel and ends outside it no longer closes the form under the pointer.
  return (
    <div className="d3-modal-wrap" role="presentation" style={{ zIndex: 60 }}>
      <div className="d3-modal-scrim" onClick={close} />
      <div className="d3-modal awp-modal" role="dialog" aria-modal="true" style={{ width: `min(${w}px,100%)` }}>
        <div className="d3-ch">
          <h3>{title}</h3>
          <button className="d3-ibtn" onClick={close} aria-label={t("Close", "إغلاق")}>
            <Ic n="Cancel01" s={16} />
          </button>
        </div>
        <div className="awp-modal-b">
          {confirming ? (
            <p style={{ margin: 0 }} role="alert">
              {t("Discard the changes you made? Nothing has been saved yet.", "هل تريد تجاهل التغييرات التي أجريتها؟ لم يُحفظ شيء بعد.")}
            </p>
          ) : (
            children
          )}
        </div>
        {/* `COM-17`: the unsaved-changes confirmation, which neither handoff has. */}
        {confirming ? (
          <div className="d3-modal-f awp-modal-f">
            <button className="d3-pill" onClick={() => setConfirming(false)}>
              {t("Keep editing", "متابعة التحرير")}
            </button>
            <button className="d3-pill" style={{ color: "var(--text-danger)" }} onClick={onClose}>
              {t("Discard", "تجاهل")}
            </button>
          </div>
        ) : (
          footer && <div className="d3-modal-f awp-modal-f">{footer}</div>
        )}
      </div>
    </div>
  );
}

/**
 * A side drawer of at most `w` pixels with a title, an optional subtitle, a body and an optional
 * footer. Escape, the close button or a click on the overlay outside it closes it.
 */
export function Drawer({
  title,
  sub,
  onClose,
  children,
  footer,
  w = 560,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  w?: number;
}) {
  const { t } = useAwp();
  useEscapeKey(onClose);
  return (
    <div className="awp-overlay" onClick={onClose}>
      <div className="awp-drawer" style={{ width: `min(${w}px,100%)` }} onClick={(e) => e.stopPropagation()}>
        <div className="awp-row" style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-divider)" }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 18 }}>{title}</b>
            {sub && <div className="awp-small awp-muted">{sub}</div>}
          </div>
          <button className="awp-iconbtn" onClick={onClose} aria-label={t("Close", "إغلاق")}>
            <Ic n="X" />
          </button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>{children}</div>
        {footer && (
          <div className="awp-row" style={{ padding: 20, borderTop: "1px solid var(--border-divider)", gap: 10, flexWrap: "wrap" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
