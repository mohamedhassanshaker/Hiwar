"use client";

import { useState, useTransition } from "react";

import { addCustomProvider, discoverModels } from "@/features/models/actions";
import { ENGINES } from "@/features/models/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { NoteLine, type Note } from "./note-line";

/** `UC-59.1-05` and `UC-59.1-06`: a self-hosted engine as a provider of its own. */
export function CustomProviderModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [engine, setEngine] = useState(ENGINES[0][0]);
  const [url, setUrl] = useState(ENGINES[0][1]);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [found, setFound] = useState<string[] | null>(null);
  const [allow, setAllow] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();

  const discover = () =>
    start(async () => {
      setNote(null);
      const result = await discoverModels({
        baseUrl: url,
        authType: secret ? "ApiKey" : "None",
        secret: secret || undefined,
      });
      if (result.ok) {
        setFound(result.models);
        setAllow(result.models.slice(0, 1));
        return;
      }
      // `UC-59.1-06`: discovery failed, so the names are entered by hand instead.
      setFound(null);
      setNote({
        tone: "bad",
        text: `${why(result)} ${t("Enter the model names instead.", "أدخل أسماء النماذج يدوياً.")}`,
      });
    });

  const chosen = found ? allow : manual.split(/[\s,]+/).filter(Boolean);

  const add = () =>
    start(async () => {
      setNote(null);
      const result = await addCustomProvider({
        name: name || engine,
        engine,
        baseUrl: url,
        authType: secret ? "ApiKey" : "None",
        secret: secret || undefined,
        models: chosen,
      });
      if (result.ok) {
        say(t(`${name || engine} was added.`, `أُضيف ${name || engine}.`));
        onDone();
      }
      else setNote({ tone: "bad", text: why(result) });
    });

  return (
    <Modal
      w={620}
      title={t("Add custom provider", "إضافة مزود مخصص")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Add provider", "إضافة المزود")}
            disabled={pending || chosen.length === 0}
            onClick={add}
          />
        </>
      }
    >
      <NoteLine note={note} />
      <Field label={t("Inference engine", "محرك الاستدلال")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(160px,100%),1fr))", gap: 8 }}>
          {ENGINES.map(([name_, url_]) => (
            <button
              key={name_}
              className={"awp-chip" + (engine === name_ ? " on" : "")}
              style={{ height: 44, borderRadius: 12, justifyContent: "center" }}
              onClick={() => {
                setEngine(name_);
                setUrl(url_);
                setFound(null);
              }}
            >
              {name_}
            </button>
          ))}
        </div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Display name", "الاسم المعروض")}>
          <input
            className="awp-input"
            value={name}
            aria-label={t("Display name", "الاسم المعروض")}
            onChange={(e) => setName(e.target.value)}
            placeholder={engine + " — DC1"}
          />
        </Field>
        <Field label={t("API key (optional)", "مفتاح API (اختياري)")}>
          <input
            className="awp-input"
            type="password"
            value={secret}
            aria-label={t("API key", "مفتاح API")}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("Base URL", "الرابط الأساسي")}>
        <div className="awp-row" style={{ gap: 8 }}>
          <input
            className="awp-input awp-mono"
            value={url}
            aria-label={t("Base URL", "الرابط الأساسي")}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Btn
            type="secondary"
            label={t("Discover models", "اكتشاف النماذج")}
            disabled={pending}
            onClick={discover}
          />
        </div>
      </Field>
      {found ? (
        <Field label={t("Models found — choose which to allow", "النماذج المكتشفة — اختر المسموح منها")}>
          <div className="awp-col" style={{ gap: 8 }}>
            {found.map((m) => (
              <label key={m} className="awp-row" style={{ gap: 10 }}>
                <input
                  type="checkbox"
                  checked={allow.includes(m)}
                  onChange={() => setAllow(allow.includes(m) ? allow.filter((x) => x !== m) : [...allow, m])}
                />
                <span className="awp-mono">{m}</span>
              </label>
            ))}
          </div>
        </Field>
      ) : (
        <Field
          label={t("Model names", "أسماء النماذج")}
          hint={t("One per line, or separated by commas.", "واحد في كل سطر أو مفصولة بفواصل.")}
        >
          <textarea
            className="awp-input"
            rows={3}
            value={manual}
            aria-label={t("Model names", "أسماء النماذج")}
            onChange={(e) => setManual(e.target.value)}
          />
        </Field>
      )}
    </Modal>
  );
}
