"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal dialog on the native <dialog> element, which traps focus and closes with Escape
 * (PLT-005 FR-009). `onClose` runs for Escape, the close button and Cancel.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog native-dialog" aria-labelledby="dialog-title" onClose={onClose} onCancel={onClose}>
      <div className="dialog-h row between top">
        <div className="col gap-4">
          <h2 className="h3" id="dialog-title">
            {title}
          </h2>
          {description && <p className="sm muted">{description}</p>}
        </div>
        <button className="btn ghost sm" aria-label="Close" onClick={onClose}>
          <i className="i i-x" />
        </button>
      </div>
      {children && <div className="dialog-c col gap-12">{children}</div>}
      {footer && <div className="dialog-f row end gap-8">{footer}</div>}
    </dialog>
  );
}

/** A confirmation dialog for destructive or important actions. */
export function Confirm({
  open,
  title,
  description,
  confirm,
  destructive,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className={destructive ? "btn destructive" : "btn"} onClick={onConfirm} disabled={busy}>
            {confirm}
          </button>
        </>
      }
    />
  );
}
