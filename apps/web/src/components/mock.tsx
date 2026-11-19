"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Dialog } from "@/components/dialog";
import { toast } from "@/components/toast";

/**
 * Shared pieces for screens whose functions have no backend yet: their state lives in the
 * browser and resets on reload. Data comes from `src/mock/*`.
 */

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "tab on" : "tab"} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="seg">
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? "switch on" : "switch"} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Status({ tone, children }: { tone: "ok" | "warn" | "bad" | "ai" | "mut"; children: ReactNode }) {
  return <span className={`stt ${tone}`}>{children}</span>;
}

export type Column<R> = { key: string; label: string; render: (r: R) => ReactNode; text?: (r: R) => string; className?: string };
export type RowAction<R> = { label: string; run: (r: R) => void; hidden?: (r: R) => boolean };

const PAGE = 10;

/**
 * Table with search, optional select filters, table or card layout, a row menu and a pager
 * (the TableSearch and TablePager boards).
 */
export function DataTable<R>({
  rows,
  columns,
  noun,
  rowKey,
  actions,
  filters,
  toolbar,
}: {
  rows: R[];
  columns: Column<R>[];
  noun: string;
  rowKey: (r: R) => string;
  actions?: RowAction<R>[];
  filters?: { label: string; options: string[]; value: (r: R) => string }[];
  toolbar?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [fv, setFv] = useState<Record<number, string>>({});
  const [cards, setCards] = useState(false);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !columns.some((c) => (c.text ? c.text(r) : String(c.render(r) ?? "")).toLowerCase().includes(needle))) return false;
      return (filters ?? []).every((f, i) => !fv[i] || f.value(r) === fv[i]);
    });
  }, [rows, columns, filters, q, fv]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);
  const filtered = q !== "" || Object.values(fv).some(Boolean);

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

  return (
    <div className="col gap-12">
      <div className="row gap-8 wrap between">
        <div className="row gap-8 wrap dt-tools grow">
          <label className="sr-only" htmlFor={`q-${noun}`}>Search {noun}</label>
          <input
            id={`q-${noun}`}
            className="input"
            placeholder={`Search ${noun}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
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
          <Seg
            label="Layout"
            options={[
              ["table", "Table"],
              ["cards", "Cards"],
            ]}
            value={cards ? "cards" : "table"}
            onChange={(v) => setCards(v === "cards")}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="card dash">
          <div className="card-c">
            <p className="sm muted">No {noun} match. Change the search or clear the filters.</p>
          </div>
        </div>
      ) : cards ? (
        <div className="grid g3">
          {slice.map((r) => (
            <div key={rowKey(r)} className="card">
              <div className="card-c">
                <div className="row between top">
                  <div className="b">{columns[0].render(r)}</div>
                  {menuFor(r)}
                </div>
                <dl className="kv sm">
                  {columns.slice(1).map((c) => (
                    <div key={c.key} className="row gap-8 between">
                      <dt className="muted">{c.label}</dt>
                      <dd>{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={c.className}>
                    {c.label}
                  </th>
                ))}
                {actions && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
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
      <div className="row between sm muted">
        <span>
          {shown.length === 0 ? 0 : at * PAGE + 1}–{at * PAGE + slice.length} of {shown.length} {noun}
        </span>
        <div className="row gap-4">
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
      </div>
    </div>
  );
}

export type FieldSpec = { name: string; label: string; value?: string; type?: "text" | "textarea" | "date" | "number" | "email" | "select"; options?: string[]; hint?: string; required?: boolean };

/**
 * A dialog with a few fields. `onSubmit` gets the values and returns the toast text, or an
 * error message as `{ error }` to keep the dialog open.
 */
export function FormDialog({
  open,
  title,
  description,
  fields,
  confirm,
  destructive,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  fields: FieldSpec[];
  confirm: string;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (v: Record<string, string>) => string | { error: string };
  children?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const formId = `fd-${title.replace(/\W+/g, "-")}`;
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={() => {
        setError(null);
        onClose();
      }}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button form={formId} className={destructive ? "btn destructive" : "btn"}>
            {confirm}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
          const missing = fields.find((f) => f.required && !data[f.name]?.trim());
          if (missing) return setError(`${missing.label} is required.`);
          const r = onSubmit(data);
          if (typeof r === "object") return setError(r.error);
          setError(null);
          onClose();
          toast(r);
        }}
      >
        {children}
        {fields.map((f) => (
          <div key={f.name} className="field">
            <label className="label" htmlFor={`${formId}-${f.name}`}>
              {f.label}
            </label>
            {f.type === "textarea" ? (
              <textarea id={`${formId}-${f.name}`} name={f.name} className="textarea" defaultValue={f.value} dir="auto" />
            ) : f.type === "select" ? (
              <select id={`${formId}-${f.name}`} name={f.name} className="select" defaultValue={f.value}>
                {(f.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input id={`${formId}-${f.name}`} name={f.name} className="input" type={f.type ?? "text"} defaultValue={f.value} dir="auto" />
            )}
            {f.hint && <span className="hint">{f.hint}</span>}
          </div>
        ))}
        {error && (
          <p className="sm err" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Opens one of several dialogs by key; `null` closes. */
export function useDialog<K extends string>() {
  const [open, setOpen] = useState<{ key: K; ctx?: unknown } | null>(null);
  return {
    is: (k: K) => open?.key === k,
    ctx: <T,>() => open?.ctx as T,
    show: (key: K, ctx?: unknown) => setOpen({ key, ctx }),
    close: () => setOpen(null),
  };
}

export function PageHead({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="t">
        <h1 className="h1">{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {children && <div className="row gap-8 wrap">{children}</div>}
    </div>
  );
}

export function SampleNote() {
  return <p className="xs muted">Sample data: this screen has no backend yet, and changes reset when the page reloads.</p>;
}
