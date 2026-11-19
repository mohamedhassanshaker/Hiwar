"use client";

import { useState, useTransition } from "react";

import { createKey } from "@/features/integrations/actions";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

const EXPIRIES: [string, number | null][] = [
  ["30 days", 30],
  ["90 days", 90],
  ["1 year", 365],
  ["Never", null],
];

/** `UC-77.1-01`: the secret, shown once and never again. */
export function ShowSecret({ secret, onClose }: { secret: string; onClose: () => void }) {
  const { t } = useAwp();
  return (
    <Modal
      title={t("Store it in your secrets manager", "احفظه في مدير الأسرار")}
      onClose={onClose}
      footer={<Btn label={t("Done", "تم")} onClick={onClose} />}
    >
      <p className="awp-muted" style={{ marginTop: 0 }}>
        {t("This is the only time the secret is shown. Afterwards only its prefix is kept.", "هذه المرة الوحيدة التي يظهر فيها السر. بعدها يُحفظ مقدمته فقط.")}
      </p>
      <code className="awp-mono" style={{ display: "block", wordBreak: "break-all", padding: 12, background: "var(--surface-sunken)", borderRadius: 8 }}>
        {secret}
      </code>
    </Modal>
  );
}

/** The Create key dialog: a key name and an expiry (90 days by default); a created key's secret goes to `onCreated`. */
export function CreateKey({ clientCode, onClose, onCreated }: { clientCode: string; onClose: () => void; onCreated: (secret: string) => void }) {
  const { t } = useAwp();
  const [name, setName] = useState("production");
  const [expiry, setExpiry] = useState<number | null>(90);
  const [pending, act] = useTransition();
  return (
    <Modal
      title={t("Create key", "إنشاء مفتاح")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Create", "إنشاء")}
            disabled={pending || name.trim() === ""}
            onClick={() =>
              act(async () => {
                const outcome = await createKey({ clientId: clientCode, name, expiresInDays: expiry });
                if (outcome.ok) onCreated(outcome.value);
              })
            }
          />
        </>
      }
    >
      <Field label={t("Key name", "اسم المفتاح")}>
        <input className="awp-input" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t("Expires", "الانتهاء")}>
        <PopSelect className="awp-input" value={String(expiry)} onChange={(event) => setExpiry(event.target.value === "null" ? null : Number(event.target.value))}>
          {EXPIRIES.map(([label, days]) => (
            <option key={label} value={String(days)}>{label}</option>
          ))}
        </PopSelect>
      </Field>
    </Modal>
  );
}
