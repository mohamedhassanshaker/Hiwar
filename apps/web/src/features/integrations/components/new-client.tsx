"use client";

import { useState, useTransition } from "react";

import { usePeople } from "@/components/shared/directory";
import { createClient } from "@/features/integrations/actions";
import type { ClientOption } from "@/features/integrations/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/** `UC-76.1-02` and `UC-76.1-03`: a new client, refused without a permission or with a taken id. */
export function NewClient({
  permissionOptions,
  onClose,
  onCreated,
}: {
  permissionOptions: ClientOption[];
  onClose: () => void;
  onCreated: (clientCode: string) => void;
}) {
  const { t, nm } = useAwp();
  const people = usePeople();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [owner, setOwner] = useState(people[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, act] = useTransition();

  const clientId = nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  return (
    <Modal
      title={t("New client", "عميل جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Create client", "إنشاء العميل")}
            disabled={pending || clientId.length < 3 || nameAr.trim() === "" || owner === "" || chosen.length === 0}
            onClick={() =>
              act(async () => {
                const outcome = await createClient({ clientId, nameEn, nameAr, ownerPersonId: owner, permissions: chosen });
                if (!outcome.ok) {
                  setNote(outcome.reason);
                  return;
                }
                onCreated(clientId);
                onClose();
              })
            }
          />
        </>
      }
    >
      <Field label={t("Client name (English)", "اسم العميل (إنجليزي)")}>
        <input className="awp-input" value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder={t("e.g. CRM integration", "مثال: تكامل CRM")} />
      </Field>
      <Field label={t("Client name (Arabic)", "اسم العميل (عربي)")}>
        <input className="awp-input" dir="rtl" value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
      </Field>
      <Field label={t("Owner", "المستخدم")}>
        <PopSelect className="awp-input" value={owner} onChange={(event) => setOwner(event.target.value)}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{nm(person)}</option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Allowed permissions", "الأذونات المسموحة")} hint={t("A client with none can do nothing.", "العميل بلا أذونات لا يمكنه فعل شيء.")}>
        <div className="awp-col" style={{ gap: 8 }}>
          {permissionOptions.map(({ code, en, ar }) => (
            <label key={code} className="awp-row">
              <input
                type="checkbox"
                checked={chosen.includes(code)}
                onChange={() => setChosen(chosen.includes(code) ? chosen.filter((one) => one !== code) : [...chosen, code])}
              />
              <span className="awp-mono" style={{ width: 150 }}>{code}</span>
              <span className="awp-small awp-muted">{t(en, ar)}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label={t("Client ID", "معرّف العميل")}>
        <input className="awp-input awp-mono" readOnly value={clientId} />
      </Field>
      {note && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {note}
        </p>
      )}
    </Modal>
  );
}
