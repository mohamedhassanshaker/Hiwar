"use client";

import { useState, useTransition } from "react";

import { saveConnection, testConnectionDraft } from "@/features/models/actions";
import { PROVIDER_AUTH, type Provider, type ProviderConnection } from "@/features/models/types";
import { Btn, Toggle } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { orThrow } from "@/lib/outcome";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { AllowedModelRow } from "./allowed-model-row";
import { NoteLine, type Note } from "./note-line";

/** A `Record` without one key, for dropping a model's entry back to its implicit default. */
const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/**
 * `UC-59.1-02` and `UC-59.1-07`: one connection of a provider.
 *
 * The secret is write-only: the field is empty on an edit and an empty field leaves the
 * stored credential alone, because a console that could show a key back would be a second
 * place to steal it from.
 */
export function ConnEditor({
  p,
  conn,
  onDone,
  onClose,
}: {
  p: Provider;
  conn: ProviderConnection | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [c, setC] = useState<ProviderConnection>(
    () =>
      conn ?? {
        id: "",
        n: "",
        ep: p.conns[0]?.ep ?? "",
        auth: "ApiKey",
        region: "",
        on: true,
        allow: [],
        realtime: [],
        kinds: {},
        windows: {},
        st: "NotChecked",
        checkedAt: null,
        lastTest: [],
      },
  );
  const [secret, setSecret] = useState("");
  const [newModel, setNewModel] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [results, setResults] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const toggleModel = (model: string) =>
    setC({
      ...c,
      allow: c.allow.includes(model) ? c.allow.filter((x) => x !== model) : [...c.allow, model],
      // Disallowing a model drops its kind and window too, so they never outlive it.
      kinds: c.allow.includes(model) ? omit(c.kinds, model) : c.kinds,
      windows: c.allow.includes(model) ? omit(c.windows, model) : c.windows,
    });

  const setKind = (model: string, kind: string) => setC({ ...c, kinds: kind === "Chat" ? omit(c.kinds, model) : { ...c.kinds, [model]: kind } });

  const setWindow = (model: string, tokens: number | undefined) =>
    setC({ ...c, windows: tokens === undefined ? omit(c.windows, model) : { ...c.windows, [model]: tokens } });

  // The provider's own list is only what a connection has allowed before; a key that opens
  // up a model this provider has never offered still needs somewhere to name it.
  const allModels = [...new Set([...p.models, ...c.allow])].sort();

  const addModel = () => {
    const name = newModel.trim();
    if (name && !c.allow.includes(name)) setC({ ...c, allow: [...c.allow, name] });
    setNewModel("");
  };

  const save = () =>
    start(async () => {
      setNote(null);
      try {
        orThrow(await saveConnection({
          providerId: p.id,
          connectionId: c.id || undefined,
          name: c.n,
          region: c.region || undefined,
          baseUrl: c.ep,
          authType: c.auth,
          secret: secret || undefined,
          active: c.on,
          allowedModels: c.allow,
          modelKinds: c.kinds,
          contextWindows: c.windows,
        }));
        say(t(`${c.n} was saved.`, `حُفظ ${c.n}.`));
        onDone();
      } catch (problem) {
        // The server's own reason, not a sentence about saving: "that model is not allowed
        // on this connection" is what the person has to act on.
        setNote({
          tone: "bad",
          text: problem instanceof Error ? problem.message : t("The connection could not be saved.", "تعذّر حفظ الاتصال."),
        });
      }
    });

  // `UC-59.1-03`: prove the credential and endpoint the form currently holds, before they are
  // saved — a wrong endpoint or model otherwise surfaces only after save, edit, save again.
  const test = () =>
    start(async () => {
      setNote(null);
      setResults(null);
      const result = await testConnectionDraft({
        connectionId: c.id || undefined,
        provider: p.kind,
        baseUrl: c.ep,
        authType: c.auth,
        secret: secret || undefined,
        models: c.allow.map((name) => ({ name, kind: c.kinds[name] ?? "Chat" })),
      });
      if (!result.ok) {
        setNote({ tone: "bad", text: why(result) });
        return;
      }
      if (result.untestable) {
        setNote({ tone: "bad", text: result.untestable });
        return;
      }
      setResults(result.results.map((one) => `${one.model} · ${one.ok ? "OK" : "FAILED"} · ${one.detail}`));
    });

  return (
    <Modal
      title={(conn ? t("Edit connection", "تعديل الاتصال") : t("Add connection", "إضافة اتصال")) + " · " + p.n}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            type="secondary"
            label={t("Test", "اختبار")}
            disabled={pending || !c.ep.trim() || c.allow.length === 0}
            onClick={test}
          />
          <Btn
            label={t("Save connection", "حفظ الاتصال")}
            disabled={pending || !c.n.trim() || !c.ep.trim()}
            onClick={save}
          />
        </>
      }
    >
      <NoteLine note={note} />
      {results && (
        <div className="awp-card" style={{ padding: 14, background: "var(--surface-card)" }} role="status">
          <div className="awp-col awp-mono awp-small" style={{ gap: 4 }}>
            {results.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Connection name", "اسم الاتصال")}>
          <input
            className="awp-input"
            value={c.n}
            aria-label={t("Connection name", "اسم الاتصال")}
            onChange={(e) => setC({ ...c, n: e.target.value })}
            placeholder={t("e.g. Production", "مثال: الإنتاج")}
          />
        </Field>
        <Field label={t("Region", "المنطقة")}>
          <input className="awp-input" value={c.region} onChange={(e) => setC({ ...c, region: e.target.value })} />
        </Field>
      </div>
      <Field label={t("Endpoint", "نقطة النهاية")}>
        <input
          className="awp-input awp-mono"
          value={c.ep}
          aria-label={t("Endpoint", "نقطة النهاية")}
          onChange={(e) => setC({ ...c, ep: e.target.value })}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Authentication", "المصادقة")}>
          <PopSelect className="awp-input" value={c.auth} onChange={(e) => setC({ ...c, auth: e.target.value })}>
            {Object.entries(PROVIDER_AUTH).map(([value, [en, ar]]) => (
              <option key={value} value={value}>
                {t(en, ar)}
              </option>
            ))}
          </PopSelect>
        </Field>
        <Field
          label={t("Secret", "السر")}
          hint={conn ? t("Leave blank to keep the stored one.", "اتركه فارغاً للإبقاء على المخزّن.") : undefined}
        >
          <input
            className="awp-input"
            type="password"
            value={secret}
            aria-label={t("Secret", "السر")}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
      </div>
      <Field
        label={t("Allowed models on this connection", "النماذج المسموحة على هذا الاتصال")}
        hint={t("Routes can only use models allowed here.", "لا يمكن للمسارات استخدام إلا النماذج المسموحة هنا.")}
      >
        <div className="awp-col" style={{ gap: 8 }}>
          {allModels.length === 0 && (
            <span className="awp-small awp-muted">
              {t("This provider has no models yet.", "لا توجد نماذج لهذا المزود بعد.")}
            </span>
          )}
          {allModels.map((m) => (
            <AllowedModelRow
              key={m}
              model={m}
              allowed={c.allow.includes(m)}
              kind={c.kinds[m] ?? "Chat"}
              contextWindow={c.windows[m]}
              onToggle={() => toggleModel(m)}
              onKind={(kind) => setKind(m, kind)}
              onWindow={(tokens) => setWindow(m, tokens)}
            />
          ))}
          <div className="awp-row" style={{ gap: 8 }}>
            <input
              className="awp-input awp-mono"
              value={newModel}
              aria-label={t("Add a model name", "أضف اسم نموذج")}
              placeholder={t("e.g. meta-llama/llama-3.3-70b", "مثال: meta-llama/llama-3.3-70b")}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addModel();
              }}
            />
            <Btn type="secondary" label={t("Add", "إضافة")} disabled={!newModel.trim()} onClick={addModel} />
          </div>
        </div>
      </Field>
      {/* `UC-59.1-07`: a connection with no model allowed cannot be a step of any route. */}
      {c.allow.length === 0 && (
        <p role="alert" style={{ margin: 0, color: "var(--feedback-warning-text)" }}>
          {t(
            "No models are allowed, so no route can use this connection.",
            "لا نماذج مسموحة، لذا لا يمكن لأي مسار استخدام هذا الاتصال.",
          )}
        </p>
      )}
      <div className="awp-row" style={{ gap: 10 }}>
        <Toggle on={c.on} onChange={(v) => setC({ ...c, on: v })} />
        <span>{t("Connection active", "الاتصال نشط")}</span>
      </div>
    </Modal>
  );
}
