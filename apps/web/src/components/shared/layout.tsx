"use client";

import { useState, type ReactNode } from "react";

import { Ic } from "@/components/ui/icon";
import { Kpi, type KpiItem } from "@/components/ui/metrics";
import { PopSelect } from "@/components/ui/pop-select";
import type { ServerPage } from "@/lib/paging";
import { Pager, usePaging } from "./pager";
import { useAwp } from "@/hooks/use-awp";

export type Col<T> = { h: ReactNode; r: (row: T) => ReactNode; end?: boolean; cls?: string };

/**
 * A table with a stated empty state, a page at a time.
 *
 * A filter that matches nothing would leave the column headers over blank space, which
 * reads as "still loading" rather than "nothing here". `empty` names what is absent when a
 * screen can say something more useful than "None".
 *
 * `onMove` makes the rows an ordered list: each starts with a handle that is dragged, or moved
 * with the arrow keys, to a new place (`to`, from 0). Every row is shown, since a row cannot be
 * dragged onto another page. `rowKey` keeps a moved row's focus on it.
 */
export function DataTable<T>({
  cols,
  rows,
  onRow,
  empty,
  server,
  onMove,
  rowKey,
}: {
  cols: Col<T>[];
  rows: T[];
  onRow?: (row: T) => void;
  empty?: ReactNode;
  /** For a list paged on the server: `rows` is already the page, and this says which. */
  server?: ServerPage & { onPage: (page: number) => void };
  onMove?: (row: T, to: number) => void;
  rowKey?: (row: T) => string;
}) {
  const { t } = useAwp();
  const paged = usePaging(rows);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const shown = server || onMove ? rows : paged.shown;
  const pager = server ? (
    <Pager
      page={server.page - 1}
      last={Math.max(0, Math.ceil(server.total / server.size) - 1)}
      total={server.total}
      size={server.size}
      onPage={(page) => server.onPage(page + 1)}
    />
  ) : onMove ? null : (
    paged.pager
  );
  return (
    <>
    <div style={{ overflowX: "auto" }}>
      <table className="awp-tbl">
        <thead>
          <tr>
            {onMove && <th aria-label={t("Order", "الترتيب")} />}
            {cols.map((c, i) => (
              <th key={i} style={c.end ? { textAlign: "end" } : undefined}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + (onMove ? 1 : 0)} className="awp-muted" style={{ textAlign: "center", padding: "28px 12px" }}>
                {empty ?? t("None", "لا يوجد")}
              </td>
            </tr>
          )}
          {shown.map((r, ri) => (
            <tr
              key={rowKey ? rowKey(r) : ri}
              className={onRow ? "click" : ""}
              onClick={onRow ? () => onRow(r) : undefined}
              onDragOver={onMove && dragged !== null ? (event) => (event.preventDefault(), setOver(ri)) : undefined}
              onDrop={
                onMove && dragged !== null
                  ? (event) => {
                      event.preventDefault();
                      if (dragged !== ri) onMove(rows[dragged], ri);
                      setDragged(null);
                      setOver(null);
                    }
                  : undefined
              }
              style={over === ri && dragged !== ri ? { boxShadow: `inset 0 ${dragged !== null && dragged < ri ? -2 : 2}px 0 var(--border-selected)` } : undefined}
            >
              {onMove && (
                <td style={{ width: 28, paddingInlineEnd: 0 }}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(ri));
                      setDragged(ri);
                    }}
                    onDragEnd={() => (setDragged(null), setOver(null))}
                    onKeyDown={(event) => {
                      const to = event.key === "ArrowUp" ? ri - 1 : event.key === "ArrowDown" ? ri + 1 : -1;
                      if (to < 0 || to >= rows.length) return;
                      event.preventDefault();
                      onMove(r, to);
                    }}
                    aria-label={t("Drag, or use the arrow keys, to change the order", "اسحب، أو استخدم مفاتيح الأسهم، لتغيير الترتيب")}
                    title={t("Drag to change the order", "اسحب لتغيير الترتيب")}
                    style={{ border: 0, background: "transparent", padding: 2, cursor: "grab", display: "flex" }}
                  >
                    <Ic n="Menu01" s={16} />
                  </button>
                </td>
              )}
              {cols.map((c, i) => (
                <td key={i} className={c.cls} style={c.end ? { textAlign: "end", whiteSpace: "nowrap" } : undefined}>
                  {c.r(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {pager}
    </>
  );
}

/** A row of KPI tiles that wraps, each at least 180 pixels wide. */
export const KpiRow = ({ items }: { items: KpiItem[] }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: 16 }}>
    {items.map((k, i) => (
      <Kpi key={i} {...k} />
    ))}
  </div>
);

/** A responsive grid of cards, each column at least `min` pixels wide or the full width. */
export const Grid = ({ min = 280, children }: { min?: number; children?: ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(min(${min}px,100%),1fr))`, gap: 16 }}>{children}</div>
);

/** The wrapping row of filter controls above a table, with a divider beneath. */
export const FilterBar = ({ children }: { children?: ReactNode }) => (
  <div className="awp-row" style={{ padding: "14px 20px", flexWrap: "wrap", gap: 12, borderBottom: "1px solid var(--border-divider)" }}>
    {children}
  </div>
);

/** A controlled select over `[value, label]` pairs, at most `w` pixels wide. */
export const Sel = ({
  value,
  onChange,
  opts,
  w = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  opts: [string, string][];
  w?: number;
}) => (
  <PopSelect className="awp-input" style={{ maxWidth: w }} value={value} onChange={(e) => onChange(e.target.value)}>
    {opts.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </PopSelect>
);
