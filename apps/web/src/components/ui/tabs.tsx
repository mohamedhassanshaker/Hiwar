"use client";

import type { ReactNode } from "react";

import { Ic } from "./icon";

export type TabItem = { id: string; label: ReactNode; count?: number };

/** `end` sits at the far end of the tab row, for an action about the tab shown. */
export function Tabs({ items, value, onChange, end }: { items: TabItem[]; value: string; onChange: (id: string) => void; end?: ReactNode }) {
  return (
    <div className="awp-tabs" role="tablist">
      {items.map((it) => (
        // `aria-selected` is how a screen reader learns which tab is on (WCAG 2.2 4.1.2, NFR-17); `on` only paints it.
        <button key={it.id} role="tab" aria-selected={value === it.id} className={value === it.id ? "on" : ""} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && <span className="awp-small awp-muted">{it.count}</span>}
        </button>
      ))}
      {end && <div style={{ marginInlineStart: "auto", alignSelf: "center", flexShrink: 0 }}>{end}</div>}
    </div>
  );
}

export type SegItem = {
  id: string;
  label: ReactNode;
  icon?: string;
  /** Offered but not choosable, with `title` saying why. A feature flag turns these off. */
  disabled?: boolean;
  title?: string;
};

/** A segmented control: one button per item, the selected one marked `on`, with optional icons. */
export function Seg({ items, value, onChange }: { items: SegItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="awp-seg">
      {items.map((it) => (
        <button
          key={it.id}
          className={value === it.id ? "on" : ""}
          disabled={it.disabled}
          title={it.title}
          onClick={() => onChange(it.id)}
        >
          {it.icon && <Ic n={it.icon} s={16} c="currentColor" />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export type ChipItem = { id: string; label: ReactNode };

/** A wrapping row of single-choice chips, the selected one marked `on`. */
export function Chips({ items, value, onChange }: { items: ChipItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="awp-row" style={{ flexWrap: "wrap" }}>
      {items.map((it) => (
        <button key={it.id} className={"awp-chip" + (value === it.id ? " on" : "")} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
