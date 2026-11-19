"use client";

import { useState } from "react";

import { useAgents, useMay, usePeople } from "@/components/shared/directory";
import { createStoryline, deleteDeployment, deploymentConversationCount, saveDeployment } from "@/features/engage/actions";
import { type Deployment, type DeploymentStats, type QuickAction } from "@/features/engage/types";
import { type Go } from "@/lib/routes";
import { PageHead } from "@/components/shared/page-head";
import { useModals } from "@/components/shared/modal-host";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Stars } from "@/components/ui/metrics";
import { Tabs } from "@/components/ui/tabs";
import { orThrow, Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { StTag } from "@/components/shared/status-tags";
import { Storyline, type DraftView } from "./storyline";
import { Widget } from "./widget";

export type DeploymentExtras = {
  /** Each of the deployment's storylines, as the editor shows it: the draft or the published version. */
  drafts: DraftView[];
  options: { tools: string[]; skills: string[] };
  embedSnippet: string;
  activity: DeploymentStats;
  projects: { key: string; nameEn: string; nameAr: string }[];
};

export const SURFACES = ["Widget", "WhatsApp", "Teams"];

/**
 * S-63: one deployment's page, with tabs for its details (settings, quick actions and the last
 * thirty days' activity), its storylines (picker, new storyline, editor) and a live preview, and
 * the header's Copy embed code, Publish, Save and Delete. The form is an edit buffer seeded once
 * from the deployment; Save sends it with the version it was read at, and Publish is the same
 * save with the status Enabled (D263). A refusal about the accent colour is shown beside the
 * field with the suggested colour.
 */
export function DeploymentDetail({
  deployment,
  extras,
  back,
  go,
}: {
  deployment: Deployment;
  extras: DeploymentExtras;
  back: () => void;
  go: Go;
}) {
  const { t, nm } = useAwp();
  const { act: confirmAction } = useModals();
  const agents = useAgents();
  const people = usePeople();
  const may = useMay();
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState({
    nameEn: deployment.n,
    nameAr: deployment.nAr,
    defaultAgentCode: deployment.a,
    status: deployment.st,
    surfaces: deployment.surf ? deployment.surf.split(" · ") : [],
    allowedOrigins: deployment.allowedOrigins.join(", "),
    visitorIdentity: deployment.visitorIdentity,
    visitorJwtFallback: deployment.visitorJwtFallback,
    visitorJwtSecret: "",
    handoffQueue: deployment.handoffQueue ?? "",
    runAs: deployment.runAs ?? "",
    rateLimitPerVisitor: String(deployment.rateLimitPerVisitor ?? 20),
    widgetTitleEn: deployment.widgetTitleEn ?? "",
    widgetTitleAr: deployment.widgetTitleAr ?? "",
    accentColour: deployment.accentColour ?? "#12034B",
    welcomeEn: deployment.welcomeEn ?? "",
    welcomeAr: deployment.welcomeAr ?? "",
    disclaimerEn: deployment.disclaimerEn ?? "",
    disclaimerAr: deployment.disclaimerAr ?? "",
    disclaimerDismissible: deployment.disclaimerDismissible,
    voiceInput: deployment.voiceInput,
    readAloud: deployment.readAloud,
    sessionIdleMinutes: String(deployment.sessionIdleMinutes),
    progressRetentionMinutes: String(deployment.progressRetentionMinutes),
  });
  // Widget specification 8: the chips under the greeting, in order, each starting a storyline.
  const [quickActions, setQuickActions] = useState<QuickAction[]>(deployment.quickActions);
  const [storylineCode, setStorylineCode] = useState(extras.drafts[0]?.code ?? "");
  const [newStoryline, setNewStoryline] = useState({ code: "", nameEn: "", nameAr: "" });
  const editing = extras.drafts.find((draft) => draft.code === storylineCode) ?? extras.drafts[0] ?? null;
  const setAction = (index: number, patch: Partial<QuickAction>) =>
    setQuickActions(quickActions.map((action, at) => (at === index ? { ...action, ...patch } : action)));
  const moveAction = (index: number, by: number) => {
    const next = [...quickActions];
    const [moved] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, moved);
    setQuickActions(next);
  };
  // `UC-72.1-05`: a refusal about the accent colour offers the colour to use instead, so
  // it stays beside the field it is about. Everything else is said in a toast.
  const [note, setNote] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [run, pending] = useAction();

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const toggleSurface = (surface: string) =>
    set({ surfaces: form.surfaces.includes(surface) ? form.surfaces.filter((one) => one !== surface) : [...form.surfaces, surface] });

  const confirmDelete = async () => {
    const conversations = await deploymentConversationCount({ code: deployment.id });
    confirmAction({
      title: t("Delete deployment", "حذف النشر"),
      desc: t(
        `Deleting removes ${conversations} conversations and every surface and storyline built under it. A channel still bound to it blocks the delete.`,
        `الحذف يزيل ${conversations} محادثات وكل سطح وقصة مبنية تحته. يمنع الحذف أي قناة لا تزال مرتبطة به.`,
      ),
      danger: true,
      confirm: t("Delete", "حذف"),
      onDone: () =>
        run(async () => {
          const outcome = await deleteDeployment({ code: deployment.id });
          if (!outcome.ok) {
            setNote(outcome.reason);
            setSuggestion(null);
            throw new Refused({ reason: outcome.reason });
          }
          back();
          return t("The deployment was deleted.", "حُذف النشر.");
        }),
    });
  };

  /** Saves the form; Publish is the same save with the status Enabled. */
  const save = (status: string, done: string) =>
    run(async () => {
      const outcome = await saveDeployment({
        code: deployment.id,
        nameEn: form.nameEn,
        nameAr: form.nameAr,
        defaultAgentCode: form.defaultAgentCode,
        status,
        surfaces: form.surfaces,
        allowedOrigins: form.allowedOrigins.split(/[\s,;]+/).filter((one) => one !== ""),
        visitorIdentity: form.visitorIdentity,
        visitorJwtFallback: form.visitorJwtFallback,
        ...(form.visitorJwtSecret ? { visitorJwtSecret: form.visitorJwtSecret } : {}),
        handoffQueue: form.handoffQueue === "" ? null : form.handoffQueue,
        runAsPersonId: form.runAs === "" ? null : form.runAs,
        rateLimitPerVisitor: Number(form.rateLimitPerVisitor),
        widgetTitleEn: form.widgetTitleEn === "" ? null : form.widgetTitleEn,
        widgetTitleAr: form.widgetTitleAr === "" ? null : form.widgetTitleAr,
        accentColour: form.accentColour,
        welcomeEn: form.welcomeEn === "" ? null : form.welcomeEn,
        welcomeAr: form.welcomeAr === "" ? null : form.welcomeAr,
        disclaimerEn: form.disclaimerEn === "" ? null : form.disclaimerEn,
        disclaimerAr: form.disclaimerAr === "" ? null : form.disclaimerAr,
        disclaimerDismissible: form.disclaimerDismissible,
        quickActions: quickActions.map((action) => ({
          ...action,
          // An id is derived from the English label when it was left out.
          id: action.id || action.labelEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "action",
        })),
        voiceInput: form.voiceInput,
        readAloud: form.readAloud,
        sessionIdleMinutes: Number(form.sessionIdleMinutes),
        progressRetentionMinutes: Number(form.progressRetentionMinutes),
        version: deployment.version,
      });
      setNote(outcome.ok ? null : outcome.reason);
      setSuggestion(outcome.ok ? null : (outcome.suggestion ?? null));
      if (!outcome.ok) throw new Refused({ reason: outcome.reason });
      if (status !== form.status) set({ status });
      return done;
    });

  return (
    <div className="awp-page" style={{ maxWidth: "none" }}>
      <PageHead
        crumb={<Lnk onClick={back}>{t("AI Capabilities / Embedded Deployment", "قدرات الذكاء الاصطناعي / النشر المضمّن")}</Lnk>}
        title={t(deployment.n, deployment.nAr)}
        sub={<span className="awp-mono">{deployment.id}</span>}
      >
        <StTag s={form.status} />
        <Btn
          type="secondary"
          label={copied ? t("Copied", "تم النسخ") : t("Copy embed code", "نسخ كود التضمين")}
          icon="Copy01"
          onClick={() => {
            void navigator.clipboard.writeText(extras.embedSnippet);
            setCopied(true);
          }}
        />
        {deployment.st !== "Enabled" && (
          <Btn
            label={t("Publish", "نشر")}
            disabled={pending}
            title={t("Saves this deployment as Enabled, so its surfaces answer visitors.", "يحفظ النشر مفعّلاً لتجيب واجهاته الزوار.")}
            onClick={() => save("Enabled", t("Published. New conversations use it.", "تم النشر. تستخدمه المحادثات الجديدة."))}
          />
        )}
        <Btn
          type={deployment.st !== "Enabled" ? "secondary" : undefined}
          label={t("Save changes", "حفظ التغييرات")}
          disabled={pending}
          onClick={() => save(form.status, t("Saved. New conversations use it.", "تم الحفظ. تستخدمه المحادثات الجديدة."))}
        />
        <Btn type="danger" label={t("Delete deployment", "حذف النشر")} disabled={pending} onClick={() => void confirmDelete()} />
      </PageHead>

      {note && (
        <p className="awp-small" style={{ margin: 0, color: suggestion ? "var(--text-danger)" : undefined }} role="alert">
          {note}
          {suggestion && (
            <>
              {" "}
              <Lnk onClick={() => set({ accentColour: suggestion })}>{t(`Use ${suggestion}`, `استخدم ${suggestion}`)}</Lnk>
            </>
          )}
        </p>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "details", label: t("Deployment details", "تفاصيل النشر") },
          { id: "storylines", label: t("Storylines", "السيناريوهات"), count: extras.drafts.length },
          { id: "preview", label: t("Preview", "معاينة") },
        ]}
      />

      {tab === "details" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="awp-two">
          <Card title={t("Main details", "البيانات الرئيسية")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Name (English)", "الاسم (إنجليزي)")}>
                <input className="awp-input" value={form.nameEn} onChange={(event) => set({ nameEn: event.target.value })} />
              </Field>
              <Field label={t("Name (Arabic)", "الاسم (عربي)")}>
                <input className="awp-input" dir="rtl" value={form.nameAr} onChange={(event) => set({ nameAr: event.target.value })} />
              </Field>
              <Field label={t("Default agent", "الوكيل الافتراضي")}>
                <div className="awp-row" style={{ gap: 10 }}>
                  <PopSelect className="awp-input" value={form.defaultAgentCode} onChange={(event) => set({ defaultAgentCode: event.target.value })}>
                    {agents.map((one) => (
                      <option key={one.id} value={one.id}>{nm(one)}</option>
                    ))}
                  </PopSelect>
                  <Btn type="secondary" label={t("Agent details", "تفاصيل الوكيل")} onClick={() => go("agents", { agent: form.defaultAgentCode })} />
                </div>
              </Field>
              <Field label={t("Status", "الحالة")}>
                <PopSelect className="awp-input" value={form.status} onChange={(event) => set({ status: event.target.value })}>
                  <option value="Enabled">{t("Enabled", "مفعّل")}</option>
                  <option value="Disabled">{t("Disabled", "معطّل")}</option>
                  <option value="Draft">{t("Draft", "مسودة")}</option>
                </PopSelect>
              </Field>
              <Field label={t("Surfaces", "الواجهات")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {SURFACES.map((surface) => (
                    <button key={surface} className={"awp-chip" + (form.surfaces.includes(surface) ? " on" : "")} onClick={() => toggleSurface(surface)}>
                      {surface}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          <Card title={t("Security & access", "الأمان والوصول")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field
                label={t("Allowed origins", "المصادر المسموحة")}
                hint={t(
                  "Where the page that embeds the widget is served from, exactly, port included: https://example.com, http://localhost:8080. null lets a page opened as a file use it, and also any sandboxed frame on any site: for testing only. A web widget cannot be enabled without one.",
                  "مصدر الصفحة التي تضمّن الويدجت كما هو، مع المنفذ: https://example.com أو http://localhost:8080. القيمة null تسمح لصفحة مفتوحة كملف، ولأي إطار معزول في أي موقع: للاختبار فقط. لا يمكن تفعيل ويدجت الويب بدون مصدر مسموح.",
                )}
              >
                <input className="awp-input" value={form.allowedOrigins} onChange={(event) => set({ allowedOrigins: event.target.value })} placeholder="https://" />
              </Field>
              <Field label={t("Visitor identity", "هوية الزائر")}>
                <PopSelect className="awp-input" value={form.visitorIdentity} onChange={(event) => set({ visitorIdentity: event.target.value })}>
                  <option value="AnonymousOtpStepUp">{t("Anonymous, step-up with OTP", "مجهول مع تحقق برمز")}</option>
                  <option value="SignedJwt">{t("Signed JWT from host site", "JWT موقع من الموقع المضيف")}</option>
                </PopSelect>
              </Field>
              {form.visitorIdentity === "SignedJwt" && (
                <>
                  <Field
                    label={t("Visitor token secret", "سر رمز الزائر")}
                    hint={t("Stored. Type a new one to replace it.", "محفوظ. اكتب قيمة جديدة لاستبداله.")}
                  >
                    <input
                      className="awp-input"
                      type="password"
                      autoComplete="off"
                      value={form.visitorJwtSecret}
                      onChange={(event) => set({ visitorJwtSecret: event.target.value })}
                    />
                  </Field>
                  <Field label={t("Without a valid token", "بدون رمز صالح")}>
                    <PopSelect
                      className="awp-input"
                      value={form.visitorJwtFallback}
                      onChange={(event) => set({ visitorJwtFallback: event.target.value })}
                    >
                      <option value="Anonymous">{t("Treat as anonymous", "معاملة كمجهول")}</option>
                      <option value="Refuse">{t("Refuse the conversation", "رفض المحادثة")}</option>
                    </PopSelect>
                  </Field>
                </>
              )}
              {/* Hiwar has no projects, so there is no queue to choose unless one exists. */}
              {extras.projects.length > 0 && (
                <Field label={t("Human handoff queue", "طابور التحويل البشري")} hint={t("The project a handed-over conversation opens a room in.", "المشروع الذي تُفتح فيه غرفة للمحادثة المحوّلة.")}>
                  <PopSelect className="awp-input" value={form.handoffQueue} onChange={(event) => set({ handoffQueue: event.target.value })}>
                    <option value="">{t("None", "لا شيء")}</option>
                    {extras.projects.map((project) => (
                      <option key={project.key} value={project.key}>{t(project.nameEn, project.nameAr)}</option>
                    ))}
                  </PopSelect>
                </Field>
              )}
              {/* D221: who the agent acts as for an anonymous visitor; an administrator's choice. */}
              <Field
                label={t("Agent acts as", "يعمل الوكيل باسم")}
                hint={t(
                  "The person whose permissions the agent uses to answer a visitor without a storyline. Use a dedicated service account with only what visitors may see. Only an administrator changes it.",
                  "الشخص الذي يستخدم الوكيل صلاحياته للرد على زائر دون سيناريو. استخدم حساب خدمة مخصصاً بما يمكن للزوار رؤيته فقط. لا يغيّره إلا المسؤول.",
                )}
              >
                <PopSelect
                  className="awp-input"
                  value={form.runAs}
                  disabled={!may("agents:configure")}
                  onChange={(event) => set({ runAs: event.target.value })}
                >
                  <option value="">{t("Nobody — the agent does not answer", "لا أحد — الوكيل لا يرد")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{t(person.name, person.nameAr)}</option>
                  ))}
                </PopSelect>
              </Field>
              <Field label={t("Rate limit per visitor", "حد المعدل لكل زائر")}>
                <input
                  className="awp-input"
                  value={form.rateLimitPerVisitor}
                  onChange={(event) => set({ rateLimitPerVisitor: event.target.value.replace(/[^0-9]/g, "") })}
                />
              </Field>
            </div>
          </Card>

          <Card title={t("Branding", "الهوية")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Widget title (English)", "عنوان الويدجت (إنجليزي)")}>
                <input className="awp-input" value={form.widgetTitleEn} onChange={(event) => set({ widgetTitleEn: event.target.value })} />
              </Field>
              <Field label={t("Widget title (Arabic)", "عنوان الويدجت (عربي)")}>
                <input className="awp-input" dir="rtl" value={form.widgetTitleAr} onChange={(event) => set({ widgetTitleAr: event.target.value })} />
              </Field>
              <Field label={t("Accent colour", "لون التمييز")}>
                <div className="awp-row" style={{ gap: 8 }}>
                  <input className="awp-input awp-mono" style={{ width: 130 }} value={form.accentColour} onChange={(event) => set({ accentColour: event.target.value })} />
                  <span aria-hidden style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border-divider)", background: form.accentColour }} />
                </div>
              </Field>
              <Field label={t("Welcome message (English)", "رسالة الترحيب (إنجليزي)")}>
                <input className="awp-input" value={form.welcomeEn} onChange={(event) => set({ welcomeEn: event.target.value })} />
              </Field>
              <Field label={t("Welcome message (Arabic)", "رسالة الترحيب (عربي)")}>
                <input className="awp-input" dir="rtl" value={form.welcomeAr} onChange={(event) => set({ welcomeAr: event.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title={t("Widget", "الويدجت")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Disclaimer (English)", "إخلاء المسؤولية (إنجليزي)")} hint={t("The notice under the widget's header.", "الملاحظة أسفل ترويسة الويدجت.")}>
                <textarea className="awp-input" rows={2} value={form.disclaimerEn} onChange={(event) => set({ disclaimerEn: event.target.value })} />
              </Field>
              <Field label={t("Disclaimer (Arabic)", "إخلاء المسؤولية (عربي)")}>
                <textarea className="awp-input" dir="rtl" rows={2} value={form.disclaimerAr} onChange={(event) => set({ disclaimerAr: event.target.value })} />
              </Field>
              <label className="awp-row" style={{ gap: 10 }}>
                <Toggle on={form.disclaimerDismissible} onChange={(next) => set({ disclaimerDismissible: next })} />
                <span>{t("A visitor may close the disclaimer", "يمكن للزائر إغلاق الملاحظة")}</span>
              </label>
              <label className="awp-row" style={{ gap: 10 }}>
                <Toggle on={form.voiceInput} onChange={(next) => set({ voiceInput: next })} />
                <span>{t("Voice input (the microphone)", "الإدخال الصوتي (الميكروفون)")}</span>
              </label>
              <label className="awp-row" style={{ gap: 10 }}>
                <Toggle on={form.readAloud} onChange={(next) => set({ readAloud: next })} />
                <span>{t("Read aloud on assistant messages", "القراءة بصوت عالٍ لرسائل المساعد")}</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label={t("Session idle timeout (minutes)", "مهلة الخمول (دقائق)")}>
                  <input className="awp-input" inputMode="numeric" value={form.sessionIdleMinutes} onChange={(event) => set({ sessionIdleMinutes: event.target.value.replace(/[^0-9]/g, "") })} />
                </Field>
                <Field label={t("Saved progress retention (minutes)", "مدة حفظ التقدم (دقائق)")}>
                  <input className="awp-input" inputMode="numeric" value={form.progressRetentionMinutes} onChange={(event) => set({ progressRetentionMinutes: event.target.value.replace(/[^0-9]/g, "") })} />
                </Field>
              </div>
            </div>
          </Card>

          <Card title={t("Quick actions", "الإجراءات السريعة")}>
            <div className="awp-col" style={{ gap: 12 }}>
              <p className="awp-small awp-muted" style={{ margin: 0 }}>
                {t(
                  "The chips under the greeting, in order. Each starts one of this deployment's storylines. Pages limit a chip to pages that send that data-context page; * is every page.",
                  "الأزرار أسفل الترحيب بالترتيب. يبدأ كل منها أحد سيناريوهات هذا النشر. تحدّ الصفحات ظهور الزر بالصفحات التي ترسل هذه الصفحة في data-context؛ و* تعني كل الصفحات.",
                )}
              </p>
              {quickActions.map((action, index) => (
                <div key={index} className="awp-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input className="awp-input" aria-label={t("Label (English)", "التسمية (إنجليزي)")} placeholder={t("Label (English)", "التسمية (إنجليزي)")} value={action.labelEn} onChange={(event) => setAction(index, { labelEn: event.target.value })} />
                    <input className="awp-input" dir="rtl" aria-label={t("Label (Arabic)", "التسمية (عربي)")} placeholder={t("Label (Arabic)", "التسمية (عربي)")} value={action.labelAr} onChange={(event) => setAction(index, { labelAr: event.target.value })} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <PopSelect className="awp-input" aria-label={t("Storyline", "السيناريو")} value={action.storyline} onChange={(event) => setAction(index, { storyline: event.target.value })}>
                      <option value="">{t("Choose a storyline…", "اختر سيناريو…")}</option>
                      {deployment.storylines.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </PopSelect>
                    <input
                      className="awp-input"
                      aria-label={t("Pages", "الصفحات")}
                      placeholder="*"
                      value={action.pages.join(", ")}
                      onChange={(event) => setAction(index, { pages: event.target.value.split(/[\s,]+/).filter(Boolean) })}
                    />
                    <PopSelect
                      className="awp-input"
                      aria-label={t("Identity needed to start", "الهوية المطلوبة للبدء")}
                      value={action.minIdentity}
                      onChange={(event) => setAction(index, { minIdentity: event.target.value as QuickAction["minIdentity"] })}
                    >
                      <option value="anonymous">{t("Anyone", "أي زائر")}</option>
                      <option value="otp_verified">{t("Verified by OTP", "متحقق برمز")}</option>
                      <option value="logged_in">{t("Signed in", "مسجّل الدخول")}</option>
                    </PopSelect>
                  </div>
                  <div className="awp-row" style={{ gap: 8 }}>
                    <Btn type="secondary" label={t("Move up", "تحريك لأعلى")} disabled={index === 0} onClick={() => moveAction(index, -1)} />
                    <Btn type="secondary" label={t("Move down", "تحريك لأسفل")} disabled={index === quickActions.length - 1} onClick={() => moveAction(index, 1)} />
                    <span style={{ flex: 1 }} />
                    <Btn type="danger" label={t("Remove", "إزالة")} onClick={() => setQuickActions(quickActions.filter((_, at) => at !== index))} />
                  </div>
                </div>
              ))}
              <Btn
                type="secondary"
                label={t("Add quick action", "إضافة إجراء سريع")}
                icon="AddCircle"
                disabled={quickActions.length >= 12}
                onClick={() => setQuickActions([...quickActions, { id: "", labelEn: "", labelAr: "", storyline: deployment.storylines[0] ?? "", pages: ["*"], minIdentity: "anonymous" }])}
              />
            </div>
          </Card>

          <Card title={t("Last 30 days", "آخر 30 يوماً")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div className="awp-small awp-muted">{t("Conversations", "المحادثات")}</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{extras.activity.conversations.toLocaleString()}</div>
              </div>
              <div>
                <div className="awp-small awp-muted">{t("Rate", "التقييم")}</div>
                {extras.activity.rating ? <Stars v={extras.activity.rating} /> : <span className="awp-muted">{t("No ratings yet", "لا تقييمات بعد")}</span>}
              </div>
              <div>
                <div className="awp-small awp-muted">{t("OTP success", "نجاح التحقق")}</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>
                  {extras.activity.otp.verified + extras.activity.otp.locked
                    ? `${Math.round((extras.activity.otp.verified / (extras.activity.otp.verified + extras.activity.otp.locked)) * 100)}%`
                    : "—"}
                </div>
              </div>
            </div>
            {extras.activity.scenarios.length > 0 && (
              <table className="awp-tbl" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>{t("Scenario", "السيناريو")}</th>
                    <th style={{ textAlign: "end" }}>{t("Started", "بدأ")}</th>
                    <th style={{ textAlign: "end" }}>{t("Completed", "اكتمل")}</th>
                    <th style={{ textAlign: "end" }}>{t("Handed off", "حُوّل")}</th>
                  </tr>
                </thead>
                <tbody>
                  {extras.activity.scenarios.map((one) => (
                    <tr key={one.scenario}>
                      <td className="awp-mono">{one.scenario}</td>
                      <td style={{ textAlign: "end" }}>{one.started}</td>
                      <td style={{ textAlign: "end" }}>{one.started ? `${Math.round((one.completed / one.started) * 100)}%` : "—"}</td>
                      <td style={{ textAlign: "end" }}>{one.started ? `${Math.round((one.handedOff / one.started) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {extras.activity.dropOff.length > 0 && (
              <p className="awp-small awp-muted" style={{ margin: "12px 0 0" }}>
                {t("Most stopped at: ", "أكثر نقاط التوقف: ")}
                {extras.activity.dropOff.map((one) => `${one.scenario} · ${one.step} (${one.count})`).join(", ")}
              </p>
            )}
          </Card>
        </div>
      )}

      {tab === "storylines" && extras.drafts.length > 0 && (
        <Card>
          <div className="awp-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="awp-small awp-muted">{t("Storyline", "السيناريو")}</span>
            <PopSelect className="awp-input" style={{ maxWidth: 260 }} aria-label={t("Storyline", "السيناريو")} value={editing?.code ?? ""} onChange={(event) => setStorylineCode(event.target.value)}>
              {extras.drafts.map((draft) => (
                <option key={draft.code} value={draft.code}>
                  {draft.code} — {t(draft.nameEn, draft.nameAr)}
                </option>
              ))}
            </PopSelect>
            <span style={{ flex: 1 }} />
            <input className="awp-input awp-mono" style={{ maxWidth: 160 }} aria-label={t("New storyline code", "رمز السيناريو الجديد")} placeholder="pay_bills" value={newStoryline.code} onChange={(event) => setNewStoryline({ ...newStoryline, code: event.target.value.toLowerCase() })} />
            <input className="awp-input" style={{ maxWidth: 200 }} aria-label={t("New storyline name", "اسم السيناريو الجديد")} placeholder={t("Name", "الاسم")} value={newStoryline.nameEn} onChange={(event) => setNewStoryline({ ...newStoryline, nameEn: event.target.value })} />
            <Btn
              type="secondary"
              label={t("New storyline", "سيناريو جديد")}
              icon="AddCircle"
              disabled={pending || !newStoryline.code || !newStoryline.nameEn}
              onClick={() =>
                run(async () => {
                  orThrow(await createStoryline({ code: deployment.id, storyline: newStoryline }));
                  setStorylineCode(newStoryline.code);
                  setNewStoryline({ code: "", nameEn: "", nameAr: "" });
                  return t("Storyline created. Add its steps, publish it, then start it from a quick action.", "أُنشئ السيناريو. أضف خطواته وانشره ثم ابدأه من إجراء سريع.");
                })
              }
            />
          </div>
        </Card>
      )}
      {tab === "storylines" &&
        (editing ? (
          <Storyline key={editing.code} draft={editing} options={extras.options} defaultAgent={form.defaultAgentCode} />
        ) : (
          <Card>
            <div className="awp-row" style={{ gap: 12 }}>
              <p className="awp-muted" style={{ margin: 0, flex: 1 }}>{t("This deployment has no storyline.", "لا يوجد سيناريو لهذا النشر.")}</p>
              {/* D219: a deployment is given its storyline here, then built and published in the editor. */}
              <Btn
                label={t("Create storyline", "إنشاء سيناريو")}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    orThrow(await createStoryline({ code: deployment.id }));
                    return t("Storyline created. Add its steps, then publish it.", "أُنشئ السيناريو. أضف خطواته ثم انشره.");
                  })
                }
              />
            </div>
          </Card>
        ))}

      {tab === "preview" && <Widget deployment={deployment} embedSnippet={extras.embedSnippet} />}
    </div>
  );
}
