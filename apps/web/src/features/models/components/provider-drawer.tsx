"use client";

import { useState, useTransition } from "react";

import { removeConnection, removeProvider, setProviderActive, testConnection } from "@/features/models/actions";
import { PROVIDER_AUTH, type Provider, type ProviderConnection } from "@/features/models/types";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlay";
import { Tg } from "@/components/ui/tag";
import { orThrow } from "@/lib/outcome";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { HealthTag } from "./health-tag";
import { ProvIcon } from "./provider-icon";
import { NoteLine, type Note } from "./note-line";
import { ConnEditor } from "./connection-editor";

/**
 * One model provider in a drawer: its active switch, each connection with its health, last test
 * failures and allowed models, and the models the provider offers. Configure, Test and Remove
 * act per connection; a refusal shows in the drawer's note with the routes that block it.
 * Read-only hides every change control.
 */
export function ProviderDrawer({
  p,
  readOnly,
  onDone,
  onClose,
}: {
  p: Provider;
  readOnly: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const { ago } = useAgo();
  const { say } = useToast();
  const [edit, setEdit] = useState<ProviderConnection | "new" | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [results, setResults] = useState<{ connection: string; lines: string[] } | null>(null);
  const [pending, start] = useTransition();

  /** `UC-59.1-03`: a real short completion per allowed model. */
  const test = (c: ProviderConnection) =>
    start(async () => {
      setNote(null);
      setResults(null);
      const result = await testConnection({ connectionId: c.id });
      if (!result.ok) {
        setNote({ tone: "bad", text: why(result) });
        return;
      }
      if (result.untestable) {
        setNote({ tone: "bad", text: result.untestable });
        return;
      }
      setResults({
        connection: c.n,
        lines: result.results.map((one) => `${one.model} · ${one.ok ? "OK" : "FAILED"} · ${one.detail}`),
      });
    });

  const remove = (c: ProviderConnection) =>
    start(async () => {
      setNote(null);
      const result = await removeConnection({ connectionId: c.id });
      if (result.ok) {
        say(t(`${c.n} was removed.`, `أُزيل ${c.n}.`));
        onDone();
      }
      // `UC-59.1-10`: blocked, with the routes that still run through it.
      else setNote({ tone: "bad", text: why(result), items: result.blockedBy });
    });

  const toggleProvider = (active: boolean) =>
    start(async () => {
      orThrow(await setProviderActive({ providerId: p.id, active }));
      say(active ? t(`${p.n} is active.`, `${p.n} نشط.`) : t(`${p.n} is inactive.`, `${p.n} معطّل.`));
      onDone();
    });

  const deleteProvider = () =>
    start(async () => {
      setNote(null);
      const result = await removeProvider({ providerId: p.id });
      if (result.ok) {
        say(t(`${p.n} was deleted.`, `حُذف ${p.n}.`));
        onDone();
        onClose();
      }
      // The routes a provider's own chain still feeds, same shape as a connection's.
      else setNote({ tone: "bad", text: why(result), items: result.blockedBy });
    });

  return (
    <>
      <Drawer
        w={640}
        title={
          <span className="awp-row" style={{ gap: 12 }}>
            <ProvIcon p={p} s={36} />
            {p.n}
          </span>
        }
        sub={(p.engine ? p.engine + " · " : "") + p.conns.length + " " + t("connections", "اتصالات")}
        onClose={onClose}
        footer={
          readOnly ? (
            <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
          ) : (
            <>
              <Btn label={t("Add connection", "إضافة اتصال")} icon="AddCircle" onClick={() => setEdit("new")} />
              <span style={{ flex: 1 }} />
              <Btn type="danger" label={t("Delete provider", "حذف المزوّد")} onClick={() => !pending && deleteProvider()} />
              <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
            </>
          )
        }
      >
        <NoteLine note={note} />
        {results && (
          <div className="awp-card" style={{ padding: 14, background: "var(--surface-card)" }} role="status">
            <b>
              {t("Test connection", "اختبار الاتصال")} · {results.connection}
            </b>
            <div className="awp-col awp-mono awp-small" style={{ gap: 4, marginTop: 8 }}>
              {results.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          </div>
        )}
        <div className="awp-row" style={{ padding: 14, borderRadius: 12, background: "var(--surface-card)" }}>
          <div style={{ flex: 1 }}>
            <b>{t("Provider active", "المزود نشط")}</b>
            <div className="awp-small awp-muted">
              {t(
                "When off, every connection and route step using this provider is skipped.",
                "عند الإيقاف، يُتخطى كل اتصال وخطوة مسار تستخدم هذا المزود.",
              )}
            </div>
          </div>
          <Toggle on={p.on} onChange={readOnly ? () => undefined : toggleProvider} />
        </div>
        <div className="awp-col" style={{ gap: 12 }}>
          <b>{t("Connections", "الاتصالات")}</b>
          {p.conns.length === 0 && (
            <p className="awp-muted" style={{ margin: 0 }}>
              {t(
                "No connections yet. Add one to start using this provider.",
                "لا توجد اتصالات بعد. أضف اتصالاً لبدء استخدام هذا المزود.",
              )}
            </p>
          )}
          {p.conns.map((c) => (
            <div
              key={c.id}
              className="awp-card"
              style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, opacity: c.on && p.on ? 1 : 0.7 }}
            >
              <div className="awp-row">
                <b style={{ flex: 1 }}>{c.n}</b>
                <HealthTag h={c.st} />
              </div>
              <div className="awp-small awp-muted awp-mono">
                {c.ep} · {t(...(PROVIDER_AUTH[c.auth] ?? [c.auth, c.auth]))} · {c.region}
              </div>
              {c.checkedAt && (
                <div className="awp-col awp-small" style={{ gap: 4 }}>
                  <span className="awp-muted">
                    {t("Last tested", "آخر اختبار")} {ago(c.checkedAt)}
                  </span>
                  {c.lastTest
                    .filter((one) => !one.ok)
                    .map((one) => (
                      <span
                        key={one.model}
                        className={"awp-mono" + (one.untestable ? " awp-muted" : "")}
                        style={one.untestable ? undefined : { color: "var(--feedback-danger-text)" }}
                      >
                        {one.model} · {one.detail}
                      </span>
                    ))}
                </div>
              )}
              <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                <span className="awp-small awp-muted">{t("Allowed models", "النماذج المسموحة")}:</span>
                {c.allow.length ? (
                  // `UC-60.1-05`: a model's context window, where one is recorded, reads beside it.
                  c.allow.map((m) => (
                    <Tg key={m} label={c.windows[m] ? `${m} · ${t(`${c.windows[m].toLocaleString()} tokens`, `${c.windows[m].toLocaleString()} رمز`)}` : m} />
                  ))
                ) : (
                  <Tg tone="warning" label={t("None — no route can use it", "لا شيء — لا مسار يستخدمه")} />
                )}
              </div>
              {!readOnly && (
                <div className="awp-row" style={{ gap: 12 }}>
                  <Lnk onClick={() => setEdit(c)}>{t("Configure", "إعداد")}</Lnk>
                  <Lnk onClick={() => !pending && test(c)}>{t("Test", "اختبار")}</Lnk>
                  <Lnk danger onClick={() => !pending && remove(c)}>
                    {t("Remove", "إزالة")}
                  </Lnk>
                </div>
              )}
            </div>
          ))}
        </div>
        <div>
          <b>{t("Models offered by provider", "النماذج التي يقدمها المزود")}</b>
          <div className="awp-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {p.models.map((m) => (
              <Tg key={m} label={m} />
            ))}
          </div>
        </div>
      </Drawer>
      {edit && (
        <ConnEditor
          p={p}
          conn={edit === "new" ? null : edit}
          onDone={() => {
            setEdit(null);
            onDone();
          }}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
