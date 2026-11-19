"use client";

import { useState, useTransition } from "react";

import { removeRoute, saveRoute } from "@/features/models/actions";
import { type ModelRoute, type Provider, type RouteStep } from "@/features/models/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { slug } from "@/components/shared/forms";
import { NoteLine, type Note } from "./note-line";

const USES: [kind: string, en: string, ar: string][] = [
  ["Standard", "Standard", "قياسي"],
  ["Typesafe", "Typesafe (typed output)", "مضبوط النوع (مخرجات مُنمَّطة)"],
  ["Voice", "Voice", "صوت"],
  ["Embedding", "Embedding", "تضمين"],
  ["Decision", "Decision (one choice of named options)", "قرار (اختيار واحد من خيارات مسماة)"],
];

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: { label: { type: "string" }, confidence: { type: "number" } },
    required: ["label"],
  },
  null,
  2,
);

/** The route as the editor holds it, which is exactly what `saveRoute` takes. */
type RouteDraft = {
  alias: string;
  originalAlias?: string;
  kind: string;
  outputSchema: string;
  confidenceThreshold: number;
  maxRetries: number;
  voiceMode: string;
  sttModel: string;
  ttsVoice: string;
  languages: string;
  bargeIn: boolean;
  maxCallMinutes: number;
  chain: RouteStep[];
};

/** The editor's starting draft: the route's values, or a new Standard route's defaults with one empty step. */
function draftOf(route: ModelRoute | null): RouteDraft {
  return {
    alias: route?.a ?? "",
    originalAlias: route?.a,
    kind: route?.kind ?? "Standard",
    outputSchema: route?.typesafe?.schema ?? DEFAULT_SCHEMA,
    confidenceThreshold: route?.typesafe?.threshold ?? 0.8,
    maxRetries: route?.typesafe?.retries ?? 2,
    voiceMode: route?.voiceSettings?.mode ?? "Pipeline",
    sttModel: route?.voiceSettings?.stt ?? "",
    ttsVoice: route?.voiceSettings?.tts ?? "",
    languages: (route?.voiceSettings?.languages ?? ["ar-AE", "en-US"]).join(", "),
    bargeIn: route?.voiceSettings?.bargeIn ?? true,
    maxCallMinutes: route?.voiceSettings?.maxCallMinutes ?? 15,
    chain: route?.chain.length ? route.chain : [["", "", ""]],
  };
}

/** `UC-60.1-02` … `-09`: build or change a route. */
export function RouteEditor({
  route,
  provs,
  onDone,
  onClose,
}: {
  route: ModelRoute | null;
  provs: Provider[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [x, setX] = useState<RouteDraft>(() => draftOf(route));
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();

  // Only a live provider with a live connection can serve a call, so only those are offered.
  const live = provs.filter((p) => p.on && p.conns.some((c) => c.on));
  const realtime = x.kind === "Voice" && x.voiceMode === "Realtime";

  const set = (index: number, slot: number, value: string) =>
    setX({
      ...x,
      chain: x.chain.map((step, k) => {
        if (k !== index) return step;
        const next: RouteStep = [...step];
        next[slot] = value;
        // A connection belongs to one provider and a model to one connection, so changing
        // the left of a step empties what hung off it rather than leaving a stale pair.
        if (slot === 0) {
          next[1] = "";
          next[2] = "";
        }
        if (slot === 1) next[2] = "";
        return next;
      }),
    });

  const suggested =
    x.alias ||
    (x.chain[0][2] ? slug(`${x.kind} ${x.chain[0][2].split("-").slice(0, 2).join(" ")}`) : "");

  const save = () =>
    start(async () => {
      setNote(null);
      const chain = x.chain.filter((step) => step[0] && step[1] && step[2]);
      // `UC-60.1-06`: a route with no complete step has nothing to call. The server refuses
      // it too; saying so here is what stops the admin losing the form to find out.
      if (chain.length === 0) {
        setNote({
          tone: "bad",
          text: t(
            "Choose a provider, a connection and a model for at least one step.",
            "اختر مزوداً واتصالاً ونموذجاً لخطوة واحدة على الأقل.",
          ),
        });
        return;
      }
      const result = await saveRoute({
        alias: suggested,
        originalAlias: x.originalAlias,
        kind: x.kind,
        outputSchema: x.kind === "Typesafe" ? x.outputSchema : undefined,
        confidenceThreshold: x.kind === "Typesafe" ? x.confidenceThreshold : undefined,
        maxRetries: x.kind === "Typesafe" ? x.maxRetries : undefined,
        voiceMode: x.kind === "Voice" ? x.voiceMode : undefined,
        sttModel: x.kind === "Voice" ? x.sttModel : undefined,
        ttsVoice: x.kind === "Voice" ? x.ttsVoice : undefined,
        languages:
          x.kind === "Voice" ? x.languages.split(/[\s,]+/).filter(Boolean) : undefined,
        bargeIn: x.kind === "Voice" ? x.bargeIn : undefined,
        maxCallMinutes: x.kind === "Voice" ? x.maxCallMinutes : undefined,
        chain: chain.map(([providerId, connectionId, modelName]) => ({
          providerId,
          connectionId,
          modelName,
        })),
      });
      if (result.ok) {
        say(t(`The route ${x.alias} was saved.`, `حُفظ المسار ${x.alias}.`));
        onDone();
      }
      else setNote({ tone: "bad", text: why(result) });
    });

  const remove = () =>
    start(async () => {
      setNote(null);
      const alias = x.originalAlias ?? x.alias;
      const result = await removeRoute({ alias });
      if (result.ok) {
        say(t(`The route ${alias} was removed.`, `أُزيل المسار ${alias}.`));
        onDone();
      }
      // `UC-60.1-09`: blocked, with the agents and collections that still call it.
      else setNote({ tone: "bad", text: why(result), items: result.blockedBy });
    });

  return (
    <Modal
      w={720}
      title={route ? t("Edit route", "تعديل المسار") + " · " + route.a : t("New route", "مسار جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          {route && <Btn type="danger" label={t("Delete route", "حذف المسار")} disabled={pending} onClick={remove} />}
          <Btn label={t("Save route", "حفظ المسار")} disabled={pending} onClick={save} />
        </>
      }
    >
      <NoteLine note={note} />
      <Field label={t("Use", "الاستخدام")}>
        <PopSelect className="awp-input" value={x.kind} onChange={(e) => setX({ ...x, kind: e.target.value })}>
          {USES.map(([kind, en, ar]) => (
            <option key={kind} value={kind}>
              {t(en, ar)}
            </option>
          ))}
        </PopSelect>
      </Field>
      {x.kind === "Typesafe" && (
        <div
          className="awp-card"
          style={{ padding: 14, background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div className="awp-row">
            <Tg tone="info" label={t("Typesafe", "مضبوط النوع")} />
            <span className="awp-small awp-muted">
              {t(
                "Responses must validate against the schema; invalid output is retried, then routed to the fallback.",
                "يجب أن تطابق الاستجابات المخطط؛ تُعاد المخرجات غير الصالحة ثم تُحوّل إلى البديل.",
              )}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("Confidence threshold", "حد الثقة")}>
              <input
                className="awp-input"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={x.confidenceThreshold}
                aria-label={t("Confidence threshold", "حد الثقة")}
                onChange={(e) => setX({ ...x, confidenceThreshold: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("Max retries on invalid", "أقصى إعادة عند عدم الصلاحية")}>
              <input
                className="awp-input"
                type="number"
                min="0"
                max="10"
                value={x.maxRetries}
                aria-label={t("Max retries on invalid", "أقصى إعادة عند عدم الصلاحية")}
                onChange={(e) => setX({ ...x, maxRetries: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label={t("Output schema", "مخطط المخرجات")}>
            <textarea
              className="awp-input awp-mono"
              rows={8}
              value={x.outputSchema}
              aria-label={t("Output schema", "مخطط المخرجات")}
              style={{ direction: "ltr", textAlign: "left" }}
              onChange={(e) => setX({ ...x, outputSchema: e.target.value })}
            />
          </Field>
        </div>
      )}
      {x.kind === "Voice" && (
        <div
          className="awp-card"
          style={{
            padding: 14,
            background: "var(--surface-card)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))",
            gap: 12,
          }}
        >
          <Field label={t("Mode", "الوضع")}>
            <PopSelect className="awp-input" value={x.voiceMode} onChange={(e) => setX({ ...x, voiceMode: e.target.value })}>
              <option value="Realtime">{t("Realtime speech-to-speech", "كلام إلى كلام لحظي")}</option>
              <option value="Pipeline">{t("Pipeline: STT → LLM → TTS", "تسلسل: نص ← نموذج ← صوت")}</option>
            </PopSelect>
          </Field>
          <Field label={t("Speech-to-text", "تحويل الكلام إلى نص")}>
            <input
              className="awp-input awp-mono"
              value={x.sttModel}
              aria-label={t("Speech-to-text", "تحويل الكلام إلى نص")}
              onChange={(e) => setX({ ...x, sttModel: e.target.value })}
            />
          </Field>
          <Field label={t("Text-to-speech voice", "صوت تحويل النص إلى كلام")}>
            <input
              className="awp-input awp-mono"
              value={x.ttsVoice}
              aria-label={t("Text-to-speech voice", "صوت تحويل النص إلى كلام")}
              onChange={(e) => setX({ ...x, ttsVoice: e.target.value })}
            />
          </Field>
          <Field label={t("Languages", "اللغات")}>
            <input
              className="awp-input"
              value={x.languages}
              aria-label={t("Languages", "اللغات")}
              onChange={(e) => setX({ ...x, languages: e.target.value })}
            />
          </Field>
          <Field label={t("Barge-in", "المقاطعة")}>
            <PopSelect
              className="awp-input"
              value={x.bargeIn ? "on" : "off"}
              onChange={(e) => setX({ ...x, bargeIn: e.target.value === "on" })}
            >
              <option value="on">{t("Allowed", "مسموحة")}</option>
              <option value="off">{t("Off", "معطّلة")}</option>
            </PopSelect>
          </Field>
          <Field label={t("Max call length (minutes)", "أقصى مدة للمكالمة (دقائق)")}>
            <input
              className="awp-input"
              type="number"
              min="1"
              value={x.maxCallMinutes}
              aria-label={t("Max call length", "أقصى مدة للمكالمة")}
              onChange={(e) => setX({ ...x, maxCallMinutes: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}
      {x.kind === "Embedding" && (
        <div className="awp-card" style={{ padding: 14, background: "var(--surface-card)" }}>
          <div className="awp-row">
            <Tg tone="info" label={t("Embedding", "تضمين")} />
            <span className="awp-small awp-muted">
              {t(
                "Used by knowledge collections to embed text; the vector size comes from the model's own response, not from configuration here.",
                "تستخدمه مجموعات المعرفة لتضمين النص؛ يُحدَّد حجم المتجه من استجابة النموذج نفسه، وليس من إعداد هنا.",
              )}
            </span>
          </div>
        </div>
      )}
      {x.kind === "Decision" && (
        <div className="awp-card" style={{ padding: 14, background: "var(--surface-card)" }}>
          <div className="awp-row">
            <Tg tone="info" label={t("Decision", "قرار")} />
            <span className="awp-small awp-muted">
              {t(
                "Picks one of the options the caller names, at the provider's decisions endpoint. Choosing which agent answers uses the route agent-choice.",
                "يختار واحداً من الخيارات التي يسميها المستدعي، عبر نقطة القرارات لدى المزوّد. يستخدم اختيار الوكيل الذي يجيب المسار agent-choice.",
              )}
            </span>
          </div>
        </div>
      )}
      <Field label={t("Chain — tried in order", "السلسلة — تُجرب بالترتيب")}>
        <div className="awp-col" style={{ gap: 10 }}>
          {x.chain.map((step, i) => {
            const provider = provs.find((q) => q.id === step[0]);
            const connection = provider?.conns.find((q) => q.id === step[1]);
            // `UC-60.1-05` and `-07`: only models the connection allows, and for realtime
            // speech-to-speech only the ones that carry audio. A decision model answers only on
            // a Decision route (D290).
            const models = (connection ? (realtime ? connection.realtime : connection.allow) : []).filter(
              (m) => (connection?.kinds[m] === "Decision") === (x.kind === "Decision"),
            );
            return (
              <div key={i} className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Tg tone={i ? "neutral" : "brand"} label={i ? t("Fallback ", "بديل ") + i : t("Primary", "أساسي")} />
                <PopSelect
                  className="awp-input"
                  style={{ flex: 1, minWidth: 140 }}
                  value={step[0]}
                  aria-label={t("Provider", "المزود")}
                  onChange={(e) => set(i, 0, e.target.value)}
                >
                  <option value="">{t("Provider", "المزود")}</option>
                  {live.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.n}
                    </option>
                  ))}
                </PopSelect>
                <PopSelect
                  className="awp-input"
                  style={{ flex: 1, minWidth: 140 }}
                  value={step[1]}
                  disabled={!provider}
                  aria-label={t("Connection", "الاتصال")}
                  onChange={(e) => set(i, 1, e.target.value)}
                >
                  <option value="">{t("Connection", "الاتصال")}</option>
                  {provider?.conns
                    .filter((q) => q.on)
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.n}
                      </option>
                    ))}
                </PopSelect>
                {/*
                  The one select handoff v2 leaves native. The model list is long, changes
                  with the connection, and is read as monospaced identifiers; the browser's
                  own list types ahead through it, which the popover does not.
                */}
                <select
                  className="awp-input awp-mono"
                  style={{ flex: 1, minWidth: 160 }}
                  value={step[2]}
                  disabled={!connection}
                  aria-label={t("Model", "النموذج")}
                  onChange={(e) => set(i, 2, e.target.value)}
                >
                  <option value="">{t("Model", "النموذج")}</option>
                  {models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                {x.chain.length > 1 && (
                  <button
                    className="awp-iconbtn"
                    style={{ width: 36, height: 36 }}
                    aria-label={t("Remove", "إزالة")}
                    onClick={() => setX({ ...x, chain: x.chain.filter((_, k) => k !== i) })}
                  >
                    <Ic n="X" s={16} />
                  </button>
                )}
              </div>
            );
          })}
          <div>
            <Btn
              type="secondary"
              label={t("Add fallback", "إضافة بديل")}
              icon="AddCircle"
              onClick={() => setX({ ...x, chain: [...x.chain, ["", "", ""]] })}
            />
          </div>
        </div>
      </Field>
      <Field
        label={t("Alias", "الاسم المستعار")}
        hint={
          route
            ? t("Agents reference this alias.", "يشير الوكلاء إلى هذا الاسم.")
            : t(
                "Suggested from use and primary model. You can change it.",
                "مقترح من الاستخدام والنموذج الأساسي. يمكنك تغييره.",
              )
        }
      >
        <input
          className="awp-input awp-mono"
          value={suggested}
          aria-label={t("Alias", "الاسم المستعار")}
          onChange={(e) => setX({ ...x, alias: e.target.value })}
          placeholder={t("auto", "تلقائي")}
        />
      </Field>
    </Modal>
  );
}
