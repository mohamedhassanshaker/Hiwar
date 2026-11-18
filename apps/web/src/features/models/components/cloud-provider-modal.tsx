"use client";

import { useState, useTransition } from "react";

import { addCloudProvider } from "@/features/models/actions";
import { CLOUD_PROVIDER_ENDPOINT, CLOUD_PROVIDERS } from "@/features/models/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { NoteLine, type Note } from "./note-line";

/** A provider agentgateway already speaks to natively — Anthropic, OpenAI and the rest. */
export function CloudProviderModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [provider, setProvider] = useState(CLOUD_PROVIDERS[0][0]);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");
  const [manual, setManual] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();

  const endpointSpec = CLOUD_PROVIDER_ENDPOINT[provider];
  const displayName = CLOUD_PROVIDERS.find(([id]) => id === provider)?.[1] ?? provider;
  const models = manual.split(/[\s,]+/).filter(Boolean);

  const add = () =>
    start(async () => {
      setNote(null);
      const result = await addCloudProvider({
        name: name || displayName,
        gatewayProvider: provider,
        endpoint: endpoint || undefined,
        authType: secret ? "ApiKey" : "None",
        secret: secret || undefined,
        models,
      });
      if (result.ok) {
        say(t(`${name || displayName} was added.`, `أُضيف ${name || displayName}.`));
        onDone();
      }
      else setNote({ tone: "bad", text: why(result) });
    });

  return (
    <Modal
      w={620}
      title={t("Add cloud provider", "إضافة مزود سحابي")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={t("Add provider", "إضافة المزود")}
            disabled={pending || models.length === 0 || (!!endpointSpec && !endpoint.trim())}
            onClick={add}
          />
        </>
      }
    >
      <NoteLine note={note} />
      <Field label={t("Provider", "المزود")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(160px,100%),1fr))", gap: 8 }}>
          {CLOUD_PROVIDERS.map(([id, label]) => (
            <button
              key={id}
              className={"awp-chip" + (provider === id ? " on" : "")}
              style={{ height: 44, borderRadius: 12, justifyContent: "center" }}
              onClick={() => {
                setProvider(id);
                setEndpoint("");
              }}
            >
              {label}
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
            placeholder={displayName}
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
      {endpointSpec && (
        <Field label={t(endpointSpec.label, endpointSpec.labelAr)}>
          <input
            className="awp-input awp-mono"
            value={endpoint}
            aria-label={t(endpointSpec.label, endpointSpec.labelAr)}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={endpointSpec.placeholder}
          />
        </Field>
      )}
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
    </Modal>
  );
}
