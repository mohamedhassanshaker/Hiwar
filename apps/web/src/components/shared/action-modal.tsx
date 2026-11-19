"use client";

import { useEffect, useState } from "react";

import type { ActionDef, ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";
import { DropZone } from "@/components/shared/forms";

/**
 * The generic confirm dialog the modal host opens for a named action. It renders the action's
 * description, code, editable fields, checks, upload and preview, and on confirm passes the
 * field values to `onDone` and, once it has finished, shows Done with the result lines; an act
 * that was refused leaves the dialog as it was, with the refusal in a toast (D355). An action
 * with `go` closes and navigates instead; one without `onDone` is a message with only Close.
 */
export function ActionModal({ label, def: given, onClose, go }: ModalProps) {
  const { t } = useAwp();
  const def: ActionDef =
    given ?? { title: label ?? "", desc: t("Review the details below and confirm.", "راجع التفاصيل أدناه ثم أكّد.") };
  const [phase, setPhase] = useState<"ask" | "working" | "done">("ask");
  const done = phase === "done";
  // `UC-23.3-05`: a field here is something the person types before confirming (a fork's new
  // title, what should change), not a read-only preview — its current value has to reach
  // `onDone`, or typing into it does nothing.
  const [values, setValues] = useState<string[]>(() => (def.fields ?? []).map(([, v]) => v));
  const target = def.go;
  useEffect(() => {
    if (target) {
      onClose();
      go(target);
    }
  }, [target, onClose, go]);
  if (target) return null;
  const confirmLbl = def.confirm || def.title;
  // Nothing to do means nothing to confirm: this is a message, and it does not get to
  // report "Done" or claim an audit entry for a change that was never made.
  const tells = !def.onDone;
  return (
    <Modal
      title={def.title}
      onClose={onClose}
      footer={
        done || tells ? (
          <Btn label={t("Close", "إغلاق")} onClick={onClose} />
        ) : (
          <>
            <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
            <Btn
              type={def.danger ? "danger" : "default"}
              label={confirmLbl}
              disabled={phase === "working"}
              onClick={async () => {
                setPhase("working");
                const finished = await def.onDone?.(values);
                setPhase(finished === false ? "ask" : "done");
              }}
            />
          </>
        )
      }
    >
      {done && !tells ? (
        <div className="awp-col" style={{ gap: 12 }}>
          <div className="awp-row">
            <Ic n="TickCircle" c="var(--icon-success)" />
            <b>{t("Done", "تم")}</b>
          </div>
          {def.result ? (
            def.result.map((r) => (
              <div key={r} className="awp-row" style={{ gap: 10 }}>
                <Ic n="CheckCircleFill" s={16} c="var(--icon-success)" />
                <span className="awp-mono" style={{ fontSize: 13 }}>
                  {r}
                </span>
              </div>
            ))
          ) : (
            <p className="awp-muted" style={{ margin: 0 }}>
              {t("The change is recorded in the audit log.", "سُجل التغيير في سجل الإجراءات.")}
            </p>
          )}
        </div>
      ) : (
        <>
          <p style={{ margin: 0 }}>{def.desc}</p>
          {def.code && (
            <pre className="awp-mono" style={{ margin: 0, padding: 14, borderRadius: 12, background: "var(--surface-sunken)", whiteSpace: "pre-wrap", direction: "ltr", textAlign: "left" }}>
              {def.code}
            </pre>
          )}
          {(def.fields || []).map(([l, , kind, opts], index) => (
            <Field key={l} label={l}>
              {kind === "area" ? (
                <textarea
                  className="awp-input"
                  style={{ height: 88, padding: 12 }}
                  value={values[index]}
                  onChange={(event) => setValues(values.map((value, i) => (i === index ? event.target.value : value)))}
                />
              ) : kind === "select" ? (
                <PopSelect
                  className="awp-input"
                  value={values[index]}
                  onChange={(event) => setValues(values.map((value, i) => (i === index ? event.target.value : value)))}
                >
                  {(opts ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </PopSelect>
              ) : (
                <input
                  className="awp-input"
                  value={values[index]}
                  onChange={(event) => setValues(values.map((value, i) => (i === index ? event.target.value : value)))}
                />
              )}
            </Field>
          ))}
          {def.checks && (
            <div className="awp-col" style={{ gap: 8 }}>
              {def.checks.map((c, i) => (
                <label key={c} className="awp-row">
                  <input type="checkbox" defaultChecked={i < 3} />
                  <span className="awp-mono">{c}</span>
                </label>
              ))}
            </div>
          )}
          {def.upload && <DropZone />}
          {def.preview && (
            <div style={{ height: 160, borderRadius: 12, background: "var(--surface-sunken)", display: "grid", placeItems: "center" }}>
              <Ic n="File01" s={40} c="var(--icon-tertiary)" />
            </div>
          )}
          {def.body}
        </>
      )}
    </Modal>
  );
}
