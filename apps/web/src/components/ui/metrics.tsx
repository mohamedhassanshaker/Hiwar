"use client";

import type { ReactNode } from "react";

import { useAwp } from "@/hooks/use-awp";
import { Ic } from "./icon";

/** A stacked horizontal bar `h` pixels high; each part's `v` is its width in percent. */
export function Bar({ parts, h = 8 }: { parts: { v: number; c: string }[]; h?: number }) {
  return (
    <div className="awp-bar" style={{ height: h }}>
      {parts.map((p, i) => (
        <span key={i} style={{ width: p.v + "%", background: p.c }} />
      ))}
    </div>
  );
}

export type KpiItem = { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: string; onClick?: () => void };

/**
 * A KPI tile: label, value coloured by `tone` (danger, warning or success), and an optional note.
 * With `onClick` it is a button, opened by click or Enter, with an arrow pointing in the reading
 * direction.
 */
export function Kpi({ label, value, note, tone, onClick }: KpiItem) {
  const { lang } = useAwp();
  const col = ({ danger: "var(--text-danger)", warning: "var(--text-warning)", success: "var(--text-success)" } as Record<string, string>)[tone ?? ""] || "var(--text-primary)";
  return (
    <div
      className={"awp-card" + (onClick ? " awp-kpi-click" : "")}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, cursor: onClick ? "pointer" : undefined }}
    >
      <span className="awp-small awp-muted awp-row" style={{ justifyContent: "space-between" }}>
        {label}
        {onClick && <Ic n={lang === "ar" ? "ArrowLeft01Round" : "ArrowRight01Round"} s={16} c="var(--icon-tertiary)" />}
      </span>
      <span style={{ fontSize: "clamp(20px,2.2vw,26px)", fontWeight: 900, lineHeight: 1.35, color: col, overflowWrap: "anywhere" }}>{value}</span>
      {note && <span className="awp-small awp-muted">{note}</span>}
    </div>
  );
}

/** A rating out of 5 as five stars, `v` rounded to whole stars, followed by `v` itself. */
export function Stars({ v }: { v: number }) {
  return (
    <span className="awp-row" style={{ gap: 2 }} aria-label={v + " / 5"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24">
          <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" fill={i <= Math.round(v) ? "var(--icon-warning)" : "var(--surface-sunken)"} />
        </svg>
      ))}
      <span className="awp-small awp-muted" style={{ marginInlineStart: 4 }}>
        {v}
      </span>
    </span>
  );
}
