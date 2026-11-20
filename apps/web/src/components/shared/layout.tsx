"use client";

import { useState, type ReactNode } from "react";

import { useStoredView } from "@/components/data-table";

import { Ic } from "@/components/ui/icon";
import { Kpi, type KpiItem } from "@/components/ui/metrics";
import { PopSelect } from "@/components/ui/pop-select";
import type { ServerPage } from "@/lib/paging";
import { Pager, usePaging } from "./pager";
import { useAwp } from "@/hooks/use-awp";

/** `s` gives the value a column sorts by; without it a column sorts by what it renders when that is text or a number. */
export type Col<T> = { h: ReactNode; r: (row: T) => ReactNode; end?: boolean; cls?: string; s?: (row: T) => string | number };

const VIEW_KEY = "hiwar-view:ai";

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
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const [view, chooseView] = useStoredView(VIEW_KEY);
  const value = (c: Col<T>, r: T): string | number | null => {
    if (c.s) return c.s(r);
    const v = c.r(r);
    return typeof v === "string" || typeof v === "number" ? v : null;
  };
  // Rows paged on the server or ordered by hand keep their order.
  const sortable = (c: Col<T>) => !server && !onMove && (Boolean(c.s) || (rows.length > 0 && value(c, rows[0]) !== null));
  const ordered =
    sort && !server && !onMove
      ? [...rows].sort((a, b) => {
          const x = value(cols[sort.i], a) ?? "";
          const y = value(cols[sort.i], b) ?? "";
          if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
          return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * sort.dir;
        })
      : rows;
  const paged = usePaging(ordered);
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
  const label = (c: Col<T>, i: number) => (typeof c.h === "string" ? c.h : t(`Column ${i + 1}`, `العمود ${i + 1}`));
  return (
    <>
    {!onMove && rows.length > 0 && (
      <div className="awp-row" style={{ justifyContent: "flex-end", gap: 8, padding: "8px 16px", flexWrap: "wrap" }}>
        {view === "cards" && cols.some(sortable) && (
          <select
            className="awp-input"
            style={{ maxWidth: 220 }}
            aria-label={t("Sort", "ترتيب")}
            value={sort ? `${sort.i}:${sort.dir}` : ""}
            onChange={(e) => {
              const [i, dir] = e.target.value.split(":").map(Number);
              setSort(e.target.value ? { i, dir: dir as 1 | -1 } : null);
            }}
          >
            <option value="">{t("Sort: default", "الترتيب: الافتراضي")}</option>
            {cols.flatMap((c, i) =>
              sortable(c)
                ? [
                    <option key={`${i}:1`} value={`${i}:1`}>{label(c, i)} ↑</option>,
                    <option key={`${i}:-1`} value={`${i}:-1`}>{label(c, i)} ↓</option>,
                  ]
                : [],
            )}
          </select>
        )}
        <div role="group" aria-label={t("Layout", "طريقة العرض")} className="seg">
          {(
            [
              ["table", t("Table", "جدول")],
              ["cards", t("Cards", "بطاقات")],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => chooseView(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
    )}
    {view === "cards" && !onMove && rows.length > 0 ? (
      <ul className="dt-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(260px,100%),1fr))", gap: 12, padding: "4px 16px 12px" }}>
        {shown.map((r, ri) => (
          <li
            key={rowKey ? rowKey(r) : ri}
            className={onRow ? "click" : ""}
            onClick={onRow ? () => onRow(r) : undefined}
            style={{ border: "1px solid var(--border-divider)", borderRadius: 8, padding: 12, background: "var(--surface-card)", cursor: onRow ? "pointer" : undefined, minWidth: 0 }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{cols[0]?.r(r)}</div>
            <dl className="kv" style={{ fontSize: 13 }}>
              {cols.slice(1).map((c, i) => (
                <div key={i} className="awp-row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <dt className="awp-muted">{c.h}</dt>
                  <dd>{c.r(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    ) : (
    <div style={{ overflowX: "auto" }}>
      <table className="awp-tbl">
        <thead>
          <tr>
            {onMove && <th aria-label={t("Order", "الترتيب")} />}
            {cols.map((c, i) => {
              const dir = sort?.i === i ? sort.dir : null;
              return (
                <th
                  key={i}
                  style={c.end ? { textAlign: "end" } : undefined}
                  className={c.end ? "r" : undefined}
                  aria-sort={dir ? (dir === 1 ? "ascending" : "descending") : sortable(c) ? "none" : undefined}
                >
                  {sortable(c) ? (
                    <button type="button" className="th-sort" onClick={() => setSort(dir === null ? { i, dir: 1 } : dir === 1 ? { i, dir: -1 } : null)}>
                      {c.h}
                    </button>
                  ) : (
                    c.h
                  )}
                </th>
              );
            })}
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
    )}
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
