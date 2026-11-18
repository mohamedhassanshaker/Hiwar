"use client";

import { useState, useTransition } from "react";

import type { RoleRow } from "@/features/organisation/types";
import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { setRolePermissions } from "@/features/organisation/actions";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-41.2-02`: allow or deny each permission for a role.
 *
 * Deny is offered beside Allow rather than being the absence of one, because the evaluator
 * lets an explicit deny beat an allow at any scope — it is how an exception is carved out
 * of a wider grant, and dropping the row would silently turn that exception off.
 *
 * `UC-41.2-05`: the permission a system role exists for is shown locked.
 */
export function RolePermissionsModal({
  role,
  catalogue,
  effects,
  locked,
  onClose,
}: {
  role: RoleRow;
  catalogue: Record<string, { en: string; ar: string }>;
  effects: Record<string, "Allow" | "Deny">;
  locked: string | null;
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const [draft, setDraft] = useState<Record<string, "Allow" | "Deny" | "None">>(() => {
    const initial: Record<string, "Allow" | "Deny" | "None"> = {};
    for (const code of Object.keys(catalogue)) initial[code] = effects[code] ?? "None";
    return initial;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setProblem(null);
      const chosen: Record<string, "Allow" | "Deny"> = {};
      for (const [code, effect] of Object.entries(draft)) {
        if (effect !== "None") chosen[code] = effect;
      }
      const result = await setRolePermissions({ roleCode: role.code, effects: chosen });
      if (result.ok) onClose();
      else setProblem(why(result));
    });

  return (
    <Modal
      title={t(`Permissions — ${role.nameEn}`, `الأذونات — ${role.nameAr}`)}
      onClose={onClose}
      w={720}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Save", "حفظ")} disabled={pending} onClick={submit} />
        </>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
        {Object.entries(catalogue).map(([code, label]) => {
          const isLocked = code === locked;
          return (
            <div
              key={code}
              className="awp-row"
              style={{ justifyContent: "space-between", gap: 12, padding: "4px 0" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{t(label.en, label.ar)}</div>
                <div className="awp-small awp-muted awp-mono">{code}</div>
              </div>
              <div className="awp-row" style={{ gap: 6 }}>
                {isLocked && (
                  <span className="awp-chip" title={t("This role is defined by it.", "هذا الدور معرّف به.")}>
                    <Ic n="Lock" s={14} /> {t("Locked", "مقفل")}
                  </span>
                )}
                <PopSelect
                  className="awp-input"
                  style={{ width: 120 }}
                  value={draft[code]}
                  disabled={isLocked}
                  aria-label={code}
                  onChange={(event) =>
                    setDraft({ ...draft, [code]: event.target.value as "Allow" | "Deny" | "None" })
                  }
                >
                  <option value="None">{t("Not granted", "غير ممنوح")}</option>
                  <option value="Allow">{t("Allow", "سماح")}</option>
                  <option value="Deny">{t("Deny", "رفض")}</option>
                </PopSelect>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
