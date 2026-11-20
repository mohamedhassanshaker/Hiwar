"use client";

import { useState, type ReactNode } from "react";

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

export { DataTable, type Column, type RowAction } from "./data-table";

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
