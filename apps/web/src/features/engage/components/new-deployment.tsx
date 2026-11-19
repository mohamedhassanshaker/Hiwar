"use client";

import { useState, useTransition } from "react";

import { createDeployment } from "@/features/engage/actions";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";
import { SURFACES } from "./deployment-detail";

/** `UC-62.1-02`: a new deployment, which opens as a Draft on its own page. */
export function NewDeployment({
  agentOptions,
  onClose,
  onCreated,
}: {
  agentOptions: { code: string; nameEn: string; nameAr: string }[];
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const { t } = useAwp();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [agentCode, setAgentCode] = useState(agentOptions[0]?.code ?? "");
  // `UC-62.1-02`: a deployment is published on a channel, so the channel is chosen here
  // rather than left for a second visit to the settings tab.
  const [surfaces, setSurfaces] = useState<string[]>(["Widget"]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, act] = useTransition();

  const code = nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const toggle = (surface: string) =>
    setSurfaces(surfaces.includes(surface) ? surfaces.filter((one) => one !== surface) : [...surfaces, surface]);

  return (
    <Modal
      title={t("New deployment", "نشر جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Create", "إنشاء")}
            disabled={pending || code.length < 3 || nameAr.trim() === "" || agentCode === "" || surfaces.length === 0}
            onClick={() =>
              act(async () => {
                const outcome = await createDeployment({ code, nameEn, nameAr, defaultAgentCode: agentCode, surfaces });
                if (!outcome.ok) {
                  setNote(outcome.reason);
                  return;
                }
                onCreated(code);
                onClose();
              })
            }
          />
        </>
      }
    >
      <Field label={t("Name (English)", "الاسم (إنجليزي)")}>
        <input className="awp-input" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
      </Field>
      <Field label={t("Name (Arabic)", "الاسم (عربي)")}>
        <input className="awp-input" dir="rtl" value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
      </Field>
      <Field label={t("Default agent", "الوكيل الافتراضي")}>
        <PopSelect className="awp-input" value={agentCode} onChange={(event) => setAgentCode(event.target.value)}>
          {agentOptions.map((one) => (
            <option key={one.code} value={one.code}>{t(one.nameEn, one.nameAr)}</option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Channels", "القنوات")}>
        <div className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {SURFACES.map((surface) => (
            <button key={surface} type="button" className={"awp-chip" + (surfaces.includes(surface) ? " on" : "")} onClick={() => toggle(surface)}>
              {surface}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t("Deployment ID", "معرّف النشر")}>
        <input className="awp-input awp-mono" readOnly value={code} />
      </Field>
      {surfaces.includes("Widget") && (
        <p className="awp-small awp-muted" style={{ margin: 0 }}>
          {t(
            "The embed script for an external site is on the deployment page once it is created.",
            "سكربت التضمين للمواقع الخارجية متاح في صفحة النشر بعد إنشائه.",
          )}
        </p>
      )}
      {note && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {note}
        </p>
      )}
    </Modal>
  );
}
