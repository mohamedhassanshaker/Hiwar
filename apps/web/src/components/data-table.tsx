"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * One column. `sort` (or, failing that, `text`) makes it sortable; `text` is also what the
 * search box matches. `className` goes on the header and every cell (for example "r").
 */
export type Column<R> = {
  key: string;
  label: string;
  render: (r: R) => ReactNode;
  text?: (r: R) => string;
  sort?: (r: R) => string | number;
  className?: string;
};
export type RowAction<R> = { label: string; run: (r: R) => void; hidden?: (r: R) => boolean };

const SIZES = [10, 25, 50, 100];
type View = "table" | "cards";
type Sort = { key: string; dir: "asc" | "desc" } | null;

const VIEW_EVENT = "hiwar-view";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VIEW_EVENT, onChange);
  };
}

/**
 * The table or card layout kept in this browser under `key`. The server render and the first
 * client paint use the table layout, so both agree.
 */
export function useStoredView(key: string): [View, (v: View) => void] {
  const view = useSyncExternalStore(
    subscribe,
    (): View => {
      try {
        return localStorage.getItem(key) === "cards" ? "cards" : "table";
      } catch {
        return "table";
      }
    },
    (): View => "table",
  );
  const choose = (v: View) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage may be unavailable (private mode); the layout then stays as it is.
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  };
  return [view, choose];
}

/**
 * Every list of records in the control panel and the operator portal (PLT-004 FR-008): search
 * and native select filters, sortable columns, a table or card layout kept per browser, row
 * actions and a pager with a page size.
 */
export function DataTable<R>({
  rows,
  columns,
  noun,
  rowKey,
  caption,
  actions,
  filters,
  toolbar,
  search = true,
  initialQuery = "",
  empty,
  pageSize = 25,
}: {
  rows: R[];
  columns: Column<R>[];
  noun: string;
  rowKey: (r: R) => string;
  /** The table's accessible name (an sr-only caption). */
  caption?: string;
  actions?: RowAction<R>[];
  filters?: { label: string; options: string[]; value: (r: R) => string }[];
  toolbar?: ReactNode;
  /** false when the screen filters on the server and has its own search. */
  search?: boolean;
  initialQuery?: string;
  /** Shown when there are no rows at all, before any search or filter. */
  empty?: ReactNode;
  pageSize?: number;
}) {
  const [q, setQ] = useState(initialQuery);
  const [fv, setFv] = useState<Record<number, string>>({});
  const [view, chooseView] = useStoredView(`hiwar-view:${noun}`);
  const [sort, setSort] = useState<Sort>(null);
  const [size, setSize] = useState(pageSize);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);

  // A column without `text` is searched and sorted by what it renders when that is plain text.
  const plain = (c: Column<R>, r: R): string | null => {
    if (c.text) return c.text(r);
    const v = c.render(r);
    return typeof v === "string" || typeof v === "number" ? String(v) : null;
  };
  const sortValue = (c: Column<R>, r: R) => (c.sort ? c.sort(r) : (plain(c, r) ?? ""));
  const sortable = (c: Column<R>) => Boolean(c.sort) || (rows.length > 0 && plain(c, rows[0]) !== null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kept = rows.filter((r) => {
      if (needle && !columns.some((c) => (plain(c, r) ?? "").toLowerCase().includes(needle))) return false;
      return (filters ?? []).every((f, i) => !fv[i] || f.value(r) === fv[i]);
    });
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!column) return kept;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...kept].sort((a, b) => {
      const x = sortValue(column, a);
      const y = sortValue(column, b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" }) * sign;
    });
    // plain and sortValue read only `columns`, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, filters, q, fv, sort]);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * size, at * size + size);
  const filtered = q !== "" || Object.values(fv).some(Boolean);
  // With no rows at all the screen says what is absent; with rows hidden by the search, that.
  const none = rows.length === 0 ? (empty ?? <p className="sm muted">No {noun} yet.</p>) : <p className="sm muted">No {noun} match. Change the search or clear the filters.</p>;

  const toggleSort = (key: string) => {
    setSort(sort?.key !== key ? { key, dir: "asc" } : sort.dir === "asc" ? { key, dir: "desc" } : null);
    setPage(0);
  };

  const menuFor = (r: R) => {
    const list = (actions ?? []).filter((a) => !a.hidden?.(r));
    if (!list.length) return null;
    const k = rowKey(r);
    return (
      <span className="pos-rel">
        <button className="btn ghost sm" aria-label={`More actions for ${k}`} aria-haspopup="menu" aria-expanded={menu === k} onClick={() => setMenu(menu === k ? null : k)}>
          <i className="i i-more" />
        </button>
        {menu === k && (
          <div role="menu" className="menu">
            {list.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                className="mi"
                onClick={() => {
                  setMenu(null);
                  a.run(r);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </span>
    );
  };

  const id = noun.replace(/\W+/g, "-");
  return (
    <div className="col gap-12 dt">
      <div className="row gap-8 between">
        <div className="row gap-8 dt-tools grow">
          {search && (
            <>
              <label className="sr-only" htmlFor={`q-${id}`}>Search {noun}</label>
              <input
                id={`q-${id}`}
                type="search"
                className="input"
                placeholder={`Search ${noun}`}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
            </>
          )}
          {(filters ?? []).map((f, i) => (
            <select
              key={f.label}
              className="select"
              aria-label={f.label}
              value={fv[i] ?? ""}
              onChange={(e) => {
                setFv({ ...fv, [i]: e.target.value });
                setPage(0);
              }}
            >
              <option value="">{f.label}: all</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ))}
          {view === "cards" && columns.some(sortable) && (
            <select
              className="select"
              aria-label={`Sort ${noun}`}
              value={sort ? `${sort.key}:${sort.dir}` : ""}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                setSort(key ? { key, dir: dir as "asc" | "desc" } : null);
                setPage(0);
              }}
            >
              <option value="">Sort: default</option>
              {columns.filter(sortable).flatMap((c) => [
                <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ↑</option>,
                <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ↓</option>,
              ])}
            </select>
          )}
          {filtered && (
            <button
              className="btn ghost sm"
              onClick={() => {
                setQ("");
                setFv({});
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="row gap-8">
          {toolbar}
          <div role="group" aria-label={`Layout of ${noun}`} className="seg">
            {(
              [
                ["table", "Table"],
                ["cards", "Cards"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => chooseView(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 && view === "cards" ? (
        <div className="card dash">
          <div className="card-c">{none}</div>
        </div>
      ) : view === "cards" ? (
        <ul className="grid g3 dt-cards" aria-label={caption ?? noun}>
          {slice.map((r) => (
            <li key={rowKey(r)} className="card">
              <div className="card-c">
                <div className="row between top nw">
                  <div className="b">{columns[0].render(r)}</div>
                  {menuFor(r)}
                </div>
                <dl className="kv sm">
                  {columns.slice(1).map((c) => (
                    <div key={c.key} className="row gap-8 between nw">
                      <dt className="muted">{c.label}</dt>
                      <dd>{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr>
                {columns.map((c) => {
                  const dir = sort?.key === c.key ? sort.dir : null;
                  return (
                    <th key={c.key} scope="col" className={c.className} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : sortable(c) ? "none" : undefined}>
                      {sortable(c) ? (
                        <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                          {c.label}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
                {actions && (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (actions ? 1 : 0)}>{none}</td>
                </tr>
              )}
              {slice.map((r) => (
                <tr key={rowKey(r)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.render(r)}
                    </td>
                  ))}
                  {actions && <td className="r">{menuFor(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && (
        <nav className="row between sm muted dt-pager" aria-label={`Pages of ${noun}`}>
          <span>
            {at * size + 1}–{at * size + slice.length} of {shown.length} {noun}
          </span>
          {/* A list that fits on the smallest page needs no paging controls. */}
          {shown.length > SIZES[0] && (
          <div className="row gap-8">
            <label className="row gap-4">
              Rows
              <select
                className="select sm"
                aria-label={`Rows per page of ${noun}`}
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <button className="btn outline sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
              Previous
            </button>
            <span aria-live="polite">
              Page {at + 1} of {pages}
            </span>
            <button className="btn outline sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              Next
            </button>
          </div>
          )}
        </nav>
      )}
    </div>
  );
}

/** A cell of a RecordTable row: what is shown, and the value it is searched and sorted by. */
export type Cell = { v: ReactNode; s?: string | number };

/**
 * DataTable for a server component, whose rows are already rendered: render functions cannot
 * cross to the client, React nodes can. `filter` holds a row's value for each of `filters`.
 */
export function RecordTable({
  columns,
  rows,
  filters,
  ...rest
}: {
  /** `sort: false` for a column of controls, which is neither searched nor sorted. */
  columns: { label: string; className?: string; sort?: false }[];
  rows: { key: string; cells: Cell[]; filter?: string[] }[];
  filters?: { label: string; options: string[] }[];
  noun: string;
  caption?: string;
  search?: boolean;
  initialQuery?: string;
  empty?: ReactNode;
  pageSize?: number;
  toolbar?: ReactNode;
}) {
  type Row = (typeof rows)[number];
  const cols: Column<Row>[] = columns.map((c, i) => ({
    key: String(i),
    label: c.label,
    className: c.className,
    render: (r) => r.cells[i].v,
    ...(c.sort === false ? {} : { text: (r: Row) => String(r.cells[i].s ?? ""), sort: (r: Row) => r.cells[i].s ?? "" }),
  }));
  return (
    <DataTable
      {...rest}
      rows={rows}
      columns={cols}
      rowKey={(r) => r.key}
      filters={filters?.map((f, i) => ({ ...f, value: (r: Row) => r.filter?.[i] ?? "" }))}
    />
  );
}
