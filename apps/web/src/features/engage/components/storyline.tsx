"use client";

import { useEffect, useRef, useState } from "react";

import { useAgents } from "@/components/shared/directory";
import {
  addStorylineStep,
  deleteStorylineStep,
  publishStorylineDraft,
  requestTypeFields,
  saveStorylineStep,
  setStorylineMode,
} from "@/features/engage/actions";
import type { PublishProblem } from "@/features/engage/storyline-publish";
import { FIELD_TYPES, type FieldSpec, type FieldType } from "@/features/engage/fields";
import type { Choice, Presentation, Step, StepConfig } from "@/features/engage/storyline-types";
import { STEP_TYPES } from "@/features/engage/types";
import { stepTone } from "@/i18n/vocabulary";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Seg } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { Simulate, type Simulation } from "./storyline-simulation";

/** The draft a designer edits, as the server hands it over. */
export type DraftView = {
  code: string;
  nameEn: string;
  nameAr: string;
  versionNumber: number;
  mode: string;
  publishedVersionNumber: number | null;
  steps: Step[];
};

const ON_ERRORS: [string, string, string][] = [
  ["RetryOnce", "Retry once", "إعادة مرة"],
  ["GoToStep", "Go to a step", "الانتقال إلى خطوة"],
  ["Handoff", "Hand to a person", "تحويل إلى موظف"],
];

/** What each publish problem means, and what fixes it. */
const PROBLEM_TEXT: Record<PublishProblem["reason"], [string, string]> = {
  NoSteps: ["The storyline has no steps. Add one before publishing.", "لا توجد خطوات في السيناريو. أضف خطوة قبل النشر."],
  NotConfigured: ["it needs its message or settings filled in.", "تحتاج إلى رسالتها أو إعداداتها."],
  NoNextStep: [
    "it has no next step. Set Next step, or add an End or Handoff step after it.",
    "لا توجد خطوة تالية. حدّد الخطوة التالية، أو أضف بعدها خطوة إنهاء أو تحويل.",
  ],
  Unreachable: ["no step leads to it.", "لا تؤدي إليها أي خطوة."],
  MissingArabic: ["its Arabic message is empty.", "رسالتها العربية فارغة."],
  ToolNotAllowed: ["its agent may not use this tool.", "لا يُسمح لوكيلها باستخدام هذه الأداة."],
};

/**
 * S-64: the storyline editor for one storyline's draft: the mode, Simulate and Publish, the step
 * list with Add step, and the selected step's panel. A step's edits are saved 600 ms after typing
 * pauses, one save after another, and before Simulate, Publish, switching step or leaving. A
 * refused publish keeps its list of problems on screen until the next attempt.
 */
export function Storyline({
  draft,
  options,
  defaultAgent,
}: {
  draft: DraftView;
  options: { tools: string[]; skills: string[] };
  defaultAgent: string;
}) {
  const { t, lang, nm, aName } = useAwp();
  const agents = useAgents();
  const [selected, setSelected] = useState(draft.steps[0]?.name ?? "");
  const [steps, setSteps] = useState<Step[]>(draft.steps);
  // Which steps exist is the draft's, so one added or removed on the server joins or leaves
  // the list when the page is revalidated. A step's fields stay as typed: every keystroke
  // saves, and an older revalidation must not overwrite a newer one.
  const names = draft.steps.map((one) => one.name).join("\n");
  const [listed, setListed] = useState(names);
  if (names !== listed) {
    setListed(names);
    setSteps(draft.steps.map((one) => steps.find((local) => local.name === one.name) ?? one));
  }
  const [mode, setMode] = useState(draft.mode);
  // `UC-72.3-04`: publishing names every step that is not ready, which is a list to work
  // through rather than a line that goes away, so it stays on the screen.
  const [problems, setProblems] = useState<PublishProblem[] | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [newName, setNewName] = useState("");
  const [attempt, pending] = useAction();

  const step = steps.find((one) => one.name === selected) ?? steps[0];

  /** Every editor change reports what it saved, or the refusal the server returned. */
  const run = (body: () => Promise<{ ok: boolean; reason?: string }>, done?: string) =>
    attempt(async () => {
      const outcome = await body();
      if (!outcome.ok) throw new Refused({ reason: outcome.reason ?? t("That did not work.", "لم ينجح ذلك.") });
      return done ?? t("Saved.", "تم الحفظ.");
    });

  // A step is saved once typing pauses, in order, and quietly; only a refusal is said.
  const saving = useRef<{ next: Step | null; timer: ReturnType<typeof setTimeout> | null; chain: Promise<unknown> }>({
    next: null,
    timer: null,
    chain: Promise.resolve(),
  });
  const flush = (): Promise<unknown> => {
    const pending = saving.current;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    const next = pending.next;
    pending.next = null;
    if (!next) return pending.chain;
    const saved = pending.chain.then(() =>
      saveStorylineStep({
        code: draft.code,
        name: next.name,
        type: next.type,
        messageEn: next.messageEn,
        messageAr: next.messageAr,
        sendVerbatim: next.sendVerbatim,
        slot: next.slot,
        maxAttempts: next.maxAttempts,
        verifyMethod: next.verifyMethod,
        handoffQueue: next.handoffQueue,
        toolRefs: next.toolRefs,
        skillRefs: next.skillRefs,
        agentCode: next.agentCode,
        nextStepName: next.nextStepName,
        onError: next.onError,
        config: next.config as Record<string, unknown>,
      }),
    );
    pending.chain = saved.catch(() => undefined);
    attempt(async () => {
      const outcome = await saved;
      if (!outcome.ok) throw new Refused({ reason: outcome.reason ?? t("That did not work.", "لم ينجح ذلك.") });
    });
    return pending.chain;
  };
  // Leaving the editor saves what was typed last.
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Edits the step in place and saves it once typing pauses, so the draft follows the screen. */
  const change = (patch: Partial<Step>) => {
    const next = { ...step, ...patch };
    setSteps(steps.map((one) => (one.name === step.name ? next : one)));
    // Another step's pending edit is saved first, so switching steps loses nothing.
    if (saving.current.next && saving.current.next.name !== next.name) void flush();
    saving.current.next = next;
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current.timer = setTimeout(() => void flush(), 600);
  };

  const toggleRef = (key: "toolRefs" | "skillRefs", value: string) =>
    change({ [key]: step[key].includes(value) ? step[key].filter((one) => one !== value) : [...step[key], value] } as Partial<Step>);
  const changeField = (patch: Partial<FieldSpec>) =>
    change({ config: { ...step.config, field: { ...(step.config.field ?? { type: "text" }), ...patch } } });
  const changeChoice = (index: number, patch: Partial<Choice>) =>
    change({ config: { ...step.config, choices: (step.config.choices ?? []).map((choice, at) => (at === index ? { ...choice, ...patch } : choice)) } });
  /** A minimum or maximum: a number when it reads as one, otherwise a date. */
  const bound = (text: string): number | string | undefined => (text === "" ? undefined : Number.isFinite(Number(text)) ? Number(text) : text);

  const typeName = (key: string) => {
    const found = STEP_TYPES.find(([id]) => id === key);
    return found ? t(found[1], found[2]) : key;
  };

  /** The editor stores the PascalCase step types; the prototype's words are the labels. */
  const TYPE_VALUE: Record<string, string> = Object.fromEntries(
    STEP_TYPES.map(([word]) => [word, word.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join("")]),
  );
  const wordFor = (type: string) => Object.entries(TYPE_VALUE).find(([, value]) => value === type)?.[0] ?? type.toLowerCase();

  return (
    <div className="awp-col" style={{ gap: 16 }}>
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <b style={{ fontSize: 18 }}>{draft.code}</b>{" "}
          <span className="awp-small awp-muted">
            · {t(`Draft version ${draft.versionNumber}`, `مسودة الإصدار ${draft.versionNumber}`)}
            {draft.publishedVersionNumber
              ? t(` · running version ${draft.publishedVersionNumber}`, ` · الإصدار المنشور ${draft.publishedVersionNumber}`)
              : ""}
          </span>
        </div>
        <Seg
          value={mode}
          onChange={(next) => {
            setMode(next);
            run(() => setStorylineMode({ code: draft.code, mode: next }));
          }}
          items={[
            { id: "Guided", label: t("Guided", "موجّه") },
            { id: "Strict", label: t("Strict", "صارم") },
          ]}
        />
        <Btn type="secondary" label={t("Simulate", "محاكاة")} onClick={() => void flush().then(() => setSimulating(true))} />
        <Btn
          label={t("Publish", "نشر")}
          disabled={pending}
          onClick={() =>
            attempt(async () => {
              setProblems(null);
              await flush();
              const outcome = await publishStorylineDraft(draft.code);
              if (!outcome.ok) {
                setProblems((outcome.problems ?? []) as PublishProblem[]);
                throw new Refused({ reason: outcome.reason });
              }
              return t(`Version ${outcome.value} is published.`, `تم نشر الإصدار ${outcome.value}.`);
            })
          }
        />
      </div>

      {mode === "Strict" && (
        <p className="awp-small awp-muted" style={{ margin: 0 }} role="note">
          {t(
            "In strict mode the agent may only perform the current step, and exact messages are sent verbatim.",
            "في الوضع الصارم ينفّذ الوكيل الخطوة الحالية فقط، وتُرسل الرسائل الحرفية كما هي.",
          )}
        </p>
      )}
      {problems?.length ? (
        <ul className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }}>
          {problems.map((problem) => (
            <li key={`${problem.step}:${problem.reason}:${problem.detail ?? ""}`}>
              {problem.step ? `${problem.step}: ` : ""}
              {t(...PROBLEM_TEXT[problem.reason])}
              {problem.detail ? ` (${problem.detail})` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(320px,1fr)", gap: 16 }} className="awp-two">
        <Card
          title={t("Steps", "الخطوات")}
          actions={
            <div className="awp-row" style={{ gap: 8 }}>
              <input
                className="awp-input awp-mono"
                style={{ width: 150 }}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                aria-label={t("New step name", "اسم الخطوة الجديدة")}
                placeholder="step_name"
              />
              <Btn
                type="secondary"
                label={t("Add step", "إضافة خطوة")}
                icon="AddCircle"
                disabled={pending || newName.trim() === ""}
                onClick={() =>
                  run(async () => {
                    const outcome = await addStorylineStep({ code: draft.code, name: newName, afterName: step?.name ?? null });
                    if (outcome.ok) setNewName("");
                    return outcome;
                  })
                }
              />
            </div>
          }
        >
          <div className="awp-col" style={{ gap: 0 }}>
            {steps.map((one, index) => (
              <div key={one.name} style={{ paddingInlineStart: one.config.branch ? 40 : 0 }}>
                <button
                  onClick={() => setSelected(one.name)}
                  className="awp-card"
                  style={{ width: "100%", padding: "12px 16px", textAlign: "start", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", boxShadow: selected === one.name ? "0 0 0 2px var(--border-selected)" : undefined }}
                >
                  <span className="awp-mono awp-muted" style={{ width: 20 }}>{index + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <b className="awp-mono" style={{ fontSize: 13 }}>{one.name}</b>
                      <Tg tone={stepTone[wordFor(one.type)]} label={typeName(wordFor(one.type))} />
                      {one.sendVerbatim && <Tg label="exact" />}
                    </div>
                    <div className="awp-small awp-muted" style={{ marginTop: 4 }}>
                      {(lang === "ar" ? one.messageAr : one.messageEn) || t("Not configured yet", "لم يُعد بعد")}
                    </div>
                  </div>
                  <span className="awp-row" style={{ gap: 4 }} title={aName(one.agentCode ?? defaultAgent)}>
                    <Who id={one.agentCode ?? defaultAgent} s={24} />
                    {one.agentCode && <Tg tone="brand" label={t("Override", "مخصص")} />}
                  </span>
                </button>
                {index < steps.length - 1 && <div style={{ width: 2, height: 14, background: "var(--border-divider)", marginInlineStart: 25 }} />}
              </div>
            ))}
          </div>
        </Card>

        {step && (
          <Card
            title={t("Step", "الخطوة") + " · " + step.name}
            actions={
              <Lnk
                danger
                onClick={() =>
                  run(async () => {
                    const outcome = await deleteStorylineStep({ code: draft.code, name: step.name });
                    if (!outcome.ok) return outcome;
                    const left = steps.filter((one) => one.name !== step.name);
                    setSteps(left);
                    setSelected(left[0]?.name ?? "");
                    // `UC-64.1-07`: the steps that pointed at it are named so they can be fixed.
                    return outcome.value.toFix.length > 0
                      ? {
                          ok: false,
                          reason: t(
                            `Fix the steps that pointed at ${step.name}: ${outcome.value.toFix.join(", ")}.`,
                            `صحّح الخطوات التي كانت تشير إلى ${step.name}: ${outcome.value.toFix.join("، ")}.`,
                          ),
                        }
                      : outcome;
                  })
                }
              >
                {t("Delete step", "حذف الخطوة")}
              </Lnk>
            }
          >
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Step type", "نوع الخطوة")}>
                <PopSelect className="awp-input" value={step.type} onChange={(event) => change({ type: event.target.value as Step["type"] })}>
                  {STEP_TYPES.map(([word, en, ar]) => (
                    <option key={word} value={TYPE_VALUE[word]}>
                      {t(en, ar)} ({word})
                    </option>
                  ))}
                </PopSelect>
              </Field>

              <Field
                label={t("Agent for this step", "الوكيل لهذه الخطوة")}
                hint={step.agentCode ? t("Overrides the default agent for this step only.", "يتجاوز الوكيل الافتراضي لهذه الخطوة فقط.") : t("Uses the deployment default agent.", "يستخدم الوكيل الافتراضي للنشر.")}
              >
                <PopSelect className="awp-input" value={step.agentCode ?? ""} onChange={(event) => change({ agentCode: event.target.value === "" ? null : event.target.value })}>
                  <option value="">{t("Default agent", "الوكيل الافتراضي")} — {aName(defaultAgent)}</option>
                  {agents.filter((one) => one.id !== defaultAgent).map((one) => (
                    <option key={one.id} value={one.id}>{nm(one)}</option>
                  ))}
                </PopSelect>
              </Field>

              <Field label={["Message", "Ask", "Confirm"].includes(step.type) ? t("Message (English)", "الرسالة (إنجليزي)") : t("Configuration", "الإعداد")}>
                <textarea
                  className="awp-input"
                  style={{ height: 70, padding: 12 }}
                  value={step.messageEn ?? ""}
                  onChange={(event) => change({ messageEn: event.target.value })}
                />
              </Field>
              <Field label={t("Message (Arabic)", "الرسالة (عربي)")}>
                <textarea
                  className="awp-input"
                  dir="rtl"
                  style={{ height: 70, padding: 12 }}
                  value={step.messageAr ?? ""}
                  onChange={(event) => change({ messageAr: event.target.value })}
                />
              </Field>

              {step.type === "Message" && (
                <div className="awp-row">
                  <Toggle on={step.sendVerbatim} onChange={(next) => change({ sendVerbatim: next })} />
                  <span>{t("Send verbatim (exact)", "إرسال حرفي (exact)")}</span>
                </div>
              )}

              {step.type === "Ask" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label={t("Slot", "الحقل")}>
                    <input className="awp-input awp-mono" value={step.slot ?? ""} onChange={(event) => change({ slot: event.target.value || null })} />
                  </Field>
                  <Field label={t("Max attempts", "أقصى محاولات")}>
                    <input
                      className="awp-input"
                      value={step.maxAttempts ?? ""}
                      onChange={(event) => change({ maxAttempts: event.target.value === "" ? null : Number(event.target.value.replace(/[^0-9]/g, "")) })}
                    />
                  </Field>
                </div>
              )}

              {/* Widget specification 7: a step may run in its own phase mode. */}
              <Field label={t("Phase mode", "وضع المرحلة")} hint={t("Guided offers the script and answers anything else with the agent; Strict takes only the script.", "الموجّه يعرض السيناريو ويجيب الوكيل عن أي شيء آخر، والصارم لا يقبل إلا السيناريو.")}>
                <PopSelect className="awp-input" value={step.config.mode ?? ""} onChange={(event) => change({ config: { ...step.config, mode: (event.target.value || undefined) as StepConfig["mode"] } })}>
                  <option value="">{t("The storyline's mode", "وضع السيناريو")}</option>
                  <option value="Guided">{t("Guided", "موجّه")}</option>
                  <option value="Strict">{t("Strict", "صارم")}</option>
                </PopSelect>
              </Field>

              {step.type === "Ask" && (
                <>
                  <Field label={t("Field type", "نوع الحقل")} hint={t("The control the widget shows for the answer, and the rules it must meet.", "عنصر التحكم الذي يعرضه الويدجت للإجابة، والقواعد التي يجب أن تستوفيها.")}>
                    <PopSelect
                      className="awp-input"
                      value={step.config.field?.type ?? ""}
                      onChange={(event) =>
                        change({ config: { ...step.config, field: event.target.value ? { ...(step.config.field ?? {}), type: event.target.value as FieldType } : undefined } })
                      }
                    >
                      <option value="">{t("Free text or the choices below", "نص حر أو الخيارات أدناه")}</option>
                      {FIELD_TYPES.filter((type) => type !== "otp").map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </PopSelect>
                  </Field>
                  {step.config.field && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label={t("Label (English)", "التسمية (إنجليزي)")}>
                        <input className="awp-input" value={step.config.field.labelEn ?? ""} onChange={(event) => changeField({ labelEn: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Label (Arabic)", "التسمية (عربي)")}>
                        <input className="awp-input" dir="rtl" value={step.config.field.labelAr ?? ""} onChange={(event) => changeField({ labelAr: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Placeholder", "نص توضيحي")}>
                        <input className="awp-input" value={step.config.field.placeholder ?? ""} onChange={(event) => changeField({ placeholder: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Example of a valid value", "مثال لقيمة صحيحة")}>
                        <input className="awp-input" value={step.config.field.example ?? ""} onChange={(event) => changeField({ example: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Pattern (regular expression)", "النمط (تعبير نمطي)")} hint={t("Also how a Guided step recognises this value in another answer.", "وهو أيضاً كيف تتعرّف الخطوة الموجّهة على هذه القيمة في إجابة أخرى.")}>
                        <input className="awp-input awp-mono" value={step.config.field.pattern ?? ""} onChange={(event) => changeField({ pattern: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Help", "مساعدة")}>
                        <input className="awp-input" value={step.config.field.help ?? ""} onChange={(event) => changeField({ help: event.target.value || undefined })} />
                      </Field>
                      <Field label={t("Minimum", "الحد الأدنى")}>
                        <input className="awp-input" value={step.config.field.min === undefined ? "" : String(step.config.field.min)} onChange={(event) => changeField({ min: bound(event.target.value) })} />
                      </Field>
                      <Field label={t("Maximum", "الحد الأقصى")}>
                        <input className="awp-input" value={step.config.field.max === undefined ? "" : String(step.config.field.max)} onChange={(event) => changeField({ max: bound(event.target.value) })} />
                      </Field>
                      <label className="awp-row" style={{ gap: 10 }}>
                        <Toggle on={Boolean(step.config.field.mask)} onChange={(next) => changeField({ mask: next || undefined })} />
                        <span>{t("Mask the value once entered", "إخفاء القيمة بعد إدخالها")}</span>
                      </label>
                      <label className="awp-row" style={{ gap: 10 }}>
                        <Toggle on={step.config.field.allowFreeText !== false} onChange={(next) => changeField({ allowFreeText: next ? undefined : false })} />
                        <span>{t("Free text allowed beside the control", "السماح بنص حر بجانب العنصر")}</span>
                      </label>
                    </div>
                  )}
                  <Field label={t("Choices", "الخيارات")} hint={t("Quick replies, and the options of a select field.", "الردود السريعة، وخيارات حقل الاختيار.")}>
                    <div className="awp-col" style={{ gap: 6 }}>
                      {(step.config.choices ?? []).map((choice, index) => (
                        <div key={index} className="awp-row" style={{ gap: 6 }}>
                          <input className="awp-input awp-mono" style={{ maxWidth: 120 }} aria-label={t("Value", "القيمة")} value={choice.value} onChange={(event) => changeChoice(index, { value: event.target.value })} />
                          <input className="awp-input" aria-label={t("English", "إنجليزي")} value={choice.en} onChange={(event) => changeChoice(index, { en: event.target.value })} />
                          <input className="awp-input" dir="rtl" aria-label={t("Arabic", "عربي")} value={choice.ar} onChange={(event) => changeChoice(index, { ar: event.target.value })} />
                          <Btn type="secondary" label={t("Remove", "إزالة")} onClick={() => change({ config: { ...step.config, choices: (step.config.choices ?? []).filter((_, at) => at !== index) } })} />
                        </div>
                      ))}
                      <Lnk onClick={() => change({ config: { ...step.config, choices: [...(step.config.choices ?? []), { value: "", en: "", ar: "" }] } })}>
                        {t("Add a choice", "إضافة خيار")}
                      </Lnk>
                    </div>
                  </Field>
                </>
              )}

              {step.type === "Tool" && (
                <Field label={t("Show the result as", "عرض النتيجة كـ")} hint={t("A list whose row a visitor taps to answer the next step, a card, or a timeline.", "قائمة ينقر الزائر أحد صفوفها للإجابة عن الخطوة التالية، أو بطاقة، أو مخطط زمني.")}>
                  <div className="awp-col" style={{ gap: 8 }}>
                    <PopSelect
                      className="awp-input"
                      value={step.config.present?.as ?? ""}
                      onChange={(event) =>
                        change({ config: { ...step.config, present: event.target.value ? { ...(step.config.present ?? {}), as: event.target.value as Presentation["as"] } : undefined } })
                      }
                    >
                      <option value="">{t("Nothing (keep the values)", "لا شيء (الاحتفاظ بالقيم)")}</option>
                      <option value="list">{t("List", "قائمة")}</option>
                      <option value="card">{t("Card", "بطاقة")}</option>
                      <option value="timeline">{t("Timeline", "مخطط زمني")}</option>
                    </PopSelect>
                    {step.config.present && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {(["rowsAt", "id", "title", "subtitle", "meta", "badge"] as const).map((key) => (
                          <input
                            key={key}
                            className="awp-input awp-mono"
                            aria-label={key}
                            placeholder={key}
                            value={step.config.present?.[key] ?? ""}
                            onChange={(event) => change({ config: { ...step.config, present: { ...step.config.present!, [key]: event.target.value || undefined } } })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              )}

              {step.type === "Verify" && (
                <Field label={t("Method", "الطريقة")}>
                  <PopSelect className="awp-input" value={step.verifyMethod ?? "Otp"} onChange={(event) => change({ verifyMethod: event.target.value })}>
                    <option value="Otp">OTP</option>
                    <option value="Sso">SSO</option>
                    <option value="UaePass">UAE Pass</option>
                  </PopSelect>
                </Field>
              )}

              {(step.type === "CreateWork" || step.type === "Form") && (
                <Field label={t("Request type code", "رمز نوع الطلب")} hint={t("The request type this step raises.", "نوع الطلب الذي تُنشئه هذه الخطوة.")}>
                  <input
                    className="awp-input awp-mono"
                    value={step.config.requestTypeCode ?? ""}
                    onChange={(event) => change({ config: { ...step.config, requestTypeCode: event.target.value || undefined } })}
                  />
                </Field>
              )}

              {step.type === "Form" && (
                <Field
                  label={t("Fields", "الحقول")}
                  hint={t(
                    "Copied from the request type's own attributes — sync again after changing them there.",
                    "منسوخة من سمات نوع الطلب نفسه — أعد المزامنة بعد تغييرها هناك.",
                  )}
                >
                  <div className="awp-col" style={{ gap: 8 }}>
                    <Lnk
                      onClick={() =>
                        run(async () => {
                          if (!step.config.requestTypeCode) {
                            return { ok: false, reason: t("Name a request type code first.", "اذكر رمز نوع الطلب أولاً.") };
                          }
                          const outcome = await requestTypeFields(step.config.requestTypeCode);
                          if (!outcome.ok) return outcome;
                          change({ config: { ...step.config, formFields: outcome.value } });
                          return { ok: true };
                        })
                      }
                    >
                      {t("Sync fields from the request type", "مزامنة الحقول من نوع الطلب")}
                    </Lnk>
                    {step.config.formFields?.length ? (
                      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {step.config.formFields.map((field) => (
                          <li key={field.key} className="awp-small">
                            {t(field.labelEn, field.labelAr)} <span className="awp-mono awp-muted">({field.key})</span>
                            {field.required ? t(" — required", " — إلزامي") : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="awp-small awp-muted">{t("No fields yet.", "لا توجد حقول بعد.")}</span>
                    )}
                  </div>
                </Field>
              )}

              {step.type === "Handoff" && (
                <Field label={t("Queue", "الطابور")} hint={t("The project the conversation is handed to.", "المشروع الذي تُحوّل إليه المحادثة.")}>
                  <input className="awp-input awp-mono" value={step.handoffQueue ?? ""} onChange={(event) => change({ handoffQueue: event.target.value || null })} />
                </Field>
              )}

              <Field label={t("Tools", "الأدوات")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {options.tools.map((tool) => (
                    <button key={tool} className={"awp-chip awp-mono" + (step.toolRefs.includes(tool) ? " on" : "")} style={{ height: 30, fontSize: 12 }} onClick={() => toggleRef("toolRefs", tool)}>
                      {tool}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t("Skills", "المهارات")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {options.skills.map((skill) => (
                    <button key={skill} className={"awp-chip awp-mono" + (step.skillRefs.includes(skill) ? " on" : "")} style={{ height: 30, fontSize: 12 }} onClick={() => toggleRef("skillRefs", skill)}>
                      {skill}
                    </button>
                  ))}
                </div>
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={t("Next step", "الخطوة التالية")}>
                  <PopSelect className="awp-input" value={step.nextStepName ?? ""} onChange={(event) => change({ nextStepName: event.target.value || null })}>
                    <option value="">{t("None", "لا شيء")}</option>
                    {steps.filter((one) => one.name !== step.name).map((one) => (
                      <option key={one.name} value={one.name}>{one.name}</option>
                    ))}
                  </PopSelect>
                </Field>
                <Field label={t("On error", "عند الخطأ")}>
                  <PopSelect className="awp-input" value={step.onError} onChange={(event) => change({ onError: event.target.value as Step["onError"] })}>
                    {ON_ERRORS.map(([value, en, ar]) => (
                      <option key={value} value={value}>{t(en, ar)}</option>
                    ))}
                  </PopSelect>
                </Field>
              </div>
            </div>
          </Card>
        )}
      </div>

      {simulating && (
        <Simulate
          code={draft.code}
          onClose={() => {
            setSimulating(false);
            setSimulation(null);
          }}
          result={simulation}
          onResult={setSimulation}
        />
      )}
    </div>
  );
}
