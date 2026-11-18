"use client";

import { useEffect, useState } from "react";

import { DataTable } from "@/components/shared/layout";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { RichText } from "@/components/ui/rich-text";
import { Tg } from "@/components/ui/tag";
import { MAIL_TEMPLATE_KINDS } from "@/db/schema/enums";
import { loadRecentNotifications, saveMailSettings, saveMailTemplate, sendTestEmail, testSavedMailSettings } from "@/features/governance/actions";
import type { MailView } from "@/features/governance/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { orThrow } from "@/lib/outcome";

type Notice = Awaited<ReturnType<typeof loadRecentNotifications>>[number];

const STATUS_TONE: Record<string, string> = { Sent: "success", Failed: "danger", Skipped: "neutral", Queued: "warning", Sending: "warning" };

type TemplateKind = (typeof MAIL_TEMPLATE_KINDS)[number];
type Template = MailView["templates"][TemplateKind];

/** Each email's name and who receives it when, in both languages. */
const TEMPLATE_LABELS: Record<TemplateKind, [[string, string], [string, string]]> = {
  requestCreated: [
    ["Request created", "إنشاء طلب"],
    ["To the requester, when a request is submitted.", "إلى مقدّم الطلب عند تقديمه."],
  ],
  requestUpdated: [
    ["Request updated", "تحديث طلب"],
    ["To the requester, when the request moves to another step or is returned by someone else.", "إلى مقدّم الطلب عند انتقاله إلى خطوة أخرى أو إعادته من شخص آخر."],
  ],
  requestFinished: [
    ["Request finished", "اكتمال طلب"],
    ["To the requester, when the request is completed, rejected, closed or cancelled.", "إلى مقدّم الطلب عند إكماله أو رفضه أو إغلاقه أو إلغائه."],
  ],
  workItemFinished: [
    ["Work item finished", "اكتمال بند عمل"],
    ["To its creator, assignee and reviewer, when it is done or cancelled.", "إلى منشئه والمكلّف به ومراجعه عند إنجازه أو إلغائه."],
  ],
  invitation: [
    ["User invitation", "دعوة مستخدم"],
    ["To a person invited to the platform, with the link to accept.", "إلى شخص دُعي إلى المنصة، مع رابط القبول."],
  ],
};

/** The placeholders each template can use, in the order the editor offers them. */
const PLACEHOLDERS: Record<TemplateKind, string[]> = {
  requestCreated: ["key", "title", "step", "at", "link"],
  requestUpdated: ["key", "title", "step", "outcome", "summary", "at", "link"],
  requestFinished: ["key", "title", "outcome", "summary", "completedAt", "link"],
  workItemFinished: ["key", "title", "outcome", "summary", "completedAt", "link"],
  invitation: ["name", "inviter", "role", "organisation", "link", "expiresAt"],
};

/** D247: one template's subjects and rich text bodies, in both languages. */
function TemplateModal({ kind, template, onClose }: { kind: TemplateKind; template: Template; onClose: () => void }) {
  const { t } = useAwp();
  const [run, pending] = useAction();
  const [draft, setDraft] = useState(template);
  const set = (patch: Partial<Template>) => setDraft({ ...draft, ...patch });
  const save = () =>
    run(async () => {
      orThrow(await saveMailTemplate({ kind, template: draft }));
      onClose();
      return t("Template saved.", "حُفظ القالب.");
    });
  return (
    <Modal
      w={900}
      title={t(...TEMPLATE_LABELS[kind][0])}
      onClose={onClose}
      dirty={draft !== template}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn label={t("Save template", "حفظ القالب")} disabled={pending} onClick={save} />
        </>
      }
    >
      <p className="awp-small awp-muted" style={{ marginTop: 0 }}>
        {t(...TEMPLATE_LABELS[kind][1])} {t("The email goes in the recipient's language.", "يُرسل البريد بلغة المستلم.")}
      </p>
      <div className="awp-row" style={{ gap: 12, marginBottom: 16 }}>
        <Toggle on={draft.enabled} onChange={(enabled) => set({ enabled })} />
        <span>{t("Send this email", "إرسال هذا البريد")}</span>
      </div>
      <div className="awp-col" style={{ gap: 14 }}>
        <Field label={t("Subject (English)", "الموضوع (إنجليزي)")}>
          <input className="awp-input" value={draft.subjectEn} onChange={(e) => set({ subjectEn: e.target.value })} />
        </Field>
        <Field label={t("Body (English)", "النص (إنجليزي)")}>
          <RichText label={t("Body (English)", "النص (إنجليزي)")} dir="ltr" value={draft.bodyEn} onChange={(bodyEn) => set({ bodyEn })} placeholders={PLACEHOLDERS[kind]} />
        </Field>
        <Field label={t("Subject (Arabic)", "الموضوع (عربي)")}>
          <input className="awp-input" dir="rtl" value={draft.subjectAr} onChange={(e) => set({ subjectAr: e.target.value })} />
        </Field>
        <Field label={t("Body (Arabic)", "النص (عربي)")}>
          <RichText label={t("Body (Arabic)", "النص (عربي)")} dir="rtl" value={draft.bodyAr} onChange={(bodyAr) => set({ bodyAr })} placeholders={PLACEHOLDERS[kind]} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Settings → Email (D240): the platform's mail server, the templates of the finished-request
 * and finished-work-item emails, a test send, and what was sent lately and why not.
 */
export function MailSettings({ mail }: { mail: MailView }) {
  const { t } = useAwp();
  const { ago } = useAgo();
  const [run, pending] = useAction();
  const [form, setForm] = useState(mail);
  // Write-only: empty keeps the stored password, unless Remove was chosen.
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testSaid, setTestSaid] = useState<string | null>(null);
  const [serverSaid, setServerSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [editing, setEditing] = useState<TemplateKind | null>(null);

  const refresh = () => void loadRecentNotifications().then(setNotices, () => setNotices([]));
  useEffect(refresh, []);

  const save = () =>
    run(async () => {
      orThrow(await saveMailSettings({ ...form, templates: undefined, ...(removePassword ? { password: "" } : password ? { password } : {}) }));
      setPassword("");
      return t("Email settings saved.", "حُفظت إعدادات البريد.");
    });

  // What is stored, not what is typed: the connection test and the icon speak for the saved settings.
  const saved = mail.host.trim() !== "" && mail.fromAddress.trim() !== "";

  const testServer = () =>
    run(async () => {
      const outcome = await testSavedMailSettings();
      setServerSaid(
        outcome.ok
          ? { ok: true, text: t(`Connected to ${mail.host}:${mail.port}.`, `تم الاتصال بـ ${mail.host}:${mail.port}.`) }
          : { ok: false, text: t(`Could not connect: ${outcome.reason}`, `تعذّر الاتصال: ${outcome.reason}`) },
      );
      return null;
    });

  const test = () =>
    run(async () => {
      const outcome = await sendTestEmail({ to: testTo });
      setTestSaid(outcome.sent ? t(`Sent to ${testTo}.`, `أُرسل إلى ${testTo}.`) : t(`Not sent: ${outcome.reason}`, `لم يُرسل: ${outcome.reason}`));
      refresh();
      return null;
    });

  return (
    <div className="awp-col" style={{ gap: 16 }}>
      <Card
        title={t("Mail server", "خادم البريد")}
        actions={
          saved && (
            <span className="awp-row awp-small" style={{ gap: 6 }}>
              <Ic n="TickCircle" s={18} c="var(--feedback-success-icon)" />
              {t("Configuration saved", "الإعدادات محفوظة")}
            </span>
          )
        }
      >
        <div className="awp-row" style={{ gap: 12, marginBottom: 16 }}>
          <Toggle on={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} />
          <span>{t("Send email from the platform", "إرسال البريد من المنصة")}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 16 }}>
          <Field label={t("Host", "المضيف")}><input className="awp-input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field>
          <Field label={t("Port", "المنفذ")}>
            <input className="awp-input" inputMode="numeric" value={String(form.port)} onChange={(e) => setForm({ ...form, port: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </Field>
          <Field label={t("Security", "الأمان")}>
            <PopSelect className="awp-input" value={form.security} onChange={(e) => setForm({ ...form, security: e.target.value as MailView["security"] })}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">TLS</option>
              <option value="none">{t("None (local only)", "بدون (محلي فقط)")}</option>
            </PopSelect>
          </Field>
          <Field label={t("Username", "اسم المستخدم")}><input className="awp-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field
            label={t("Password", "كلمة المرور")}
            hint={form.hasPassword && !removePassword ? t("A password is stored. Leave blank to keep it.", "كلمة مرور مخزّنة. اتركه فارغاً للإبقاء عليها.") : undefined}
          >
            <input className="awp-input" type="password" autoComplete="new-password" value={password} disabled={removePassword} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t("From address", "عنوان المرسل")}><input className="awp-input" type="email" value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} /></Field>
          <Field label={t("From name", "اسم المرسل")}><input className="awp-input" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} /></Field>
        </div>
        {form.hasPassword && (
          <label className="awp-row awp-small" style={{ gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />
            {t("Remove the stored password", "إزالة كلمة المرور المخزّنة")}
          </label>
        )}
        <div className="awp-row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {serverSaid && (
            <span className="awp-small" role="status" style={{ marginInlineEnd: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Ic n={serverSaid.ok ? "TickCircle" : "WarningSign"} s={18} c={serverSaid.ok ? "var(--feedback-success-icon)" : "var(--feedback-danger-text)"} />
              {serverSaid.text}
            </span>
          )}
          <Btn type="secondary" label={t("Test saved settings", "اختبار الإعدادات المحفوظة")} disabled={pending || mail.host.trim() === ""} onClick={testServer} />
          <Btn label={t("Save email settings", "حفظ إعدادات البريد")} disabled={pending} onClick={save} />
        </div>
      </Card>

      <Card title={t("Templates", "القوالب")} pad={false}>
        <DataTable
          rows={MAIL_TEMPLATE_KINDS.map((kind) => ({ kind, ...mail.templates[kind] }))}
          cols={[
            {
              h: t("Email", "البريد"),
              r: (row) => (
                <div>
                  <b>{t(...TEMPLATE_LABELS[row.kind][0])}</b>
                  <div className="awp-small awp-muted">{t(...TEMPLATE_LABELS[row.kind][1])}</div>
                </div>
              ),
            },
            { h: t("Subject", "الموضوع"), r: (row) => <span className="awp-small">{t(row.subjectEn, row.subjectAr)}</span> },
            { h: t("Status", "الحالة"), r: (row) => (row.enabled ? <Tg tone="success" label={t("On", "مفعّل")} /> : <Tg label={t("Off", "متوقف")} />) },
            { h: "", end: true, r: (row) => <Lnk onClick={() => setEditing(row.kind)}>{t("Edit", "تعديل")}</Lnk> },
          ]}
        />
      </Card>
      {editing && <TemplateModal kind={editing} template={mail.templates[editing]} onClose={() => setEditing(null)} />}

      <Card title={t("Test and recent emails", "اختبار ورسائل حديثة")}>
        <div className="awp-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input className="awp-input" type="email" style={{ maxWidth: 320 }} placeholder="name@example.com" aria-label={t("Send a test to", "إرسال اختبار إلى")} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Btn type="secondary" label={t("Send test email", "إرسال بريد اختبار")} disabled={pending || !testTo.includes("@")} onClick={test} />
          {testSaid && <span className="awp-small" role="status">{testSaid}</span>}
        </div>
        <DataTable<Notice>
          rows={notices ?? []}
          empty={notices === null ? t("Loading…", "جارٍ التحميل…") : t("No emails yet.", "لا توجد رسائل بعد.")}
          cols={[
            { h: t("When", "متى"), r: (notice) => ago(notice.createdAt) },
            { h: t("Kind", "النوع"), r: (notice) => notice.kind },
            { h: t("To", "إلى"), r: (notice) => notice.recipient ?? "—" },
            { h: t("Outcome", "النتيجة"), r: (notice) => notice.outcome },
            { h: t("Status", "الحالة"), r: (notice) => <Tg tone={STATUS_TONE[notice.status] ?? "neutral"} label={notice.status} /> },
            { h: t("Why", "السبب"), r: (notice) => notice.reason ?? "" },
          ]}
        />
      </Card>
    </div>
  );
}
