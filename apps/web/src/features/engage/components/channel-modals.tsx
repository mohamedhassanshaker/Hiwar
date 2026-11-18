"use client";

import { useState, useTransition } from "react";

import { configureChannel, testChannel } from "@/features/engage/actions";
import { CHANNEL_LABEL, type ChannelCheck, type ChannelConfig } from "@/features/engage/types";
import { Btn } from "@/components/ui/button";
import { Drawer, Modal } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/** The credentials each channel asks for. The stored value is never read back. */
const CREDENTIALS: Record<string, [string, string][]> = {
  WhatsApp: [
    ["Access token", "رمز الوصول"],
    ["Webhook signing secret", "سر توقيع الخطاف"],
  ],
  MicrosoftTeams: [
    ["App password", "كلمة مرور التطبيق"],
    ["Webhook signing secret", "سر توقيع الخطاف"],
  ],
  WebWidget: [["Webhook signing secret", "سر توقيع الخطاف"]],
};

export type BindingTarget = { code: string; nameEn: string; nameAr: string };

/**
 * `UC-61.1-02`: one channel's whole configuration. Saving it is enough — the gateway reads
 * the row on every message, so there is nothing to restart.
 */
export function ConfigureChannel({
  config,
  targets,
  onClose,
}: {
  config: ChannelConfig;
  targets: BindingTarget[];
  onClose: () => void;
}) {
  const { t } = useAwp();
  const [binding, setBinding] = useState(config.bindingType ?? "");
  const [deployment, setDeployment] = useState(config.bindingDeploymentCode ?? targets[0]?.code ?? "");
  const [unknown, setUnknown] = useState(config.unknownSenders);
  const [hours, setHours] = useState(config.businessHours);
  const [limit, setLimit] = useState(String(config.rateLimitPerMinute));
  const [endpoint, setEndpoint] = useState(config.endpointUrl ?? "");
  const [offline, setOffline] = useState(config.offlineMessageEn ?? "");
  const [offlineAr, setOfflineAr] = useState(config.offlineMessageAr ?? "");
  const [secret, setSecret] = useState("");
  const [inboundSecret, setInboundSecret] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, save] = useTransition();

  const credentials = CREDENTIALS[config.type] ?? [];
  const name = t(...(CHANNEL_LABEL[config.type] ?? [config.type, config.type]));

  return (
    <Drawer
      title={t("Configure", "إعداد") + " · " + name}
      sub={t("Changes are hot-reloaded", "تُطبق التغييرات دون إعادة تشغيل")}
      onClose={onClose}
      footer={
        <>
          <Btn
            label={t("Save", "حفظ")}
            disabled={saving}
            onClick={() =>
              save(async () => {
                const outcome = await configureChannel({
                  type: config.type,
                  rateLimitPerMinute: Number(limit),
                  unknownSenders: unknown,
                  businessHours: hours,
                  bindingType: binding === "" ? null : binding,
                  bindingDeploymentCode: binding === "EmbeddedDeployment" ? deployment : null,
                  offlineMessageEn: offline === "" ? null : offline,
                  offlineMessageAr: offlineAr === "" ? null : offlineAr,
                  endpointUrl: endpoint === "" ? null : endpoint,
                  ...(secret ? { secret } : {}),
                  ...(inboundSecret ? { inboundSecret } : {}),
                });
                if (outcome.ok) onClose();
                else setProblem(outcome.reason);
              })
            }
          />
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
        </>
      }
    >
      {credentials.map(([en, ar]) => (
        <Field
          key={en}
          label={t(en, ar)}
          hint={config.hasSecret || config.hasInboundSecret ? t("Stored. Type a new one to replace it.", "محفوظ. اكتب قيمة جديدة لاستبداله.") : undefined}
        >
          <input
            className="awp-input"
            type="password"
            autoComplete="off"
            placeholder={config.hasSecret ? "••••••••" : ""}
            value={en.startsWith("Webhook") ? inboundSecret : secret}
            onChange={(event) => (en.startsWith("Webhook") ? setInboundSecret(event.target.value) : setSecret(event.target.value))}
          />
        </Field>
      ))}

      <Field label={t("Outbound endpoint", "نقطة الإرسال")} hint={t("Where messages are sent. The channel test calls it.", "حيث تُرسل الرسائل. يستدعيها اختبار القناة.")}>
        <input className="awp-input awp-mono" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://" />
      </Field>

      <Field label={t("Bind to", "ربط بـ")}>
        <PopSelect className="awp-input" value={binding} onChange={(event) => setBinding(event.target.value)}>
          <option value="">{t("Nothing yet", "لا شيء بعد")}</option>
          <option value="EmbeddedDeployment">{t("Embedded deployment", "نشر مضمّن")}</option>
          <option value="RoomMirror">{t("Discussion rooms (mirror)", "اجتماعات العمل (مرآة)")}</option>
          <option value="RequestIntake">{t("Request intake", "استقبال الطلبات")}</option>
        </PopSelect>
      </Field>
      {binding === "EmbeddedDeployment" && (
        <Field label={t("Deployment", "النشر")}>
          <PopSelect className="awp-input" value={deployment} onChange={(event) => setDeployment(event.target.value)}>
            {targets.map((target) => (
              <option key={target.code} value={target.code}>
                {t(target.nameEn, target.nameAr)}
              </option>
            ))}
          </PopSelect>
        </Field>
      )}

      <Field label={t("Unknown senders", "المرسلون غير المعروفين")}>
        <PopSelect className="awp-input" value={unknown} onChange={(event) => setUnknown(event.target.value)}>
          <option value="ExternalContact">{t("Treat as external contact", "معاملة كجهة خارجية")}</option>
          <option value="Ignore">{t("Ignore", "تجاهل")}</option>
        </PopSelect>
      </Field>

      <Field label={t("Rate limit (messages / minute)", "حد المعدل (رسائل / دقيقة)")}>
        <input className="awp-input" value={limit} onChange={(event) => setLimit(event.target.value.replace(/[^0-9]/g, ""))} />
      </Field>

      <Field label={t("Business hours", "ساعات العمل")}>
        <PopSelect className="awp-input" value={hours} onChange={(event) => setHours(event.target.value)}>
          <option value="AlwaysOn">{t("Always on", "دائماً")}</option>
          <option value="WorkingCalendar">{t("Working calendar", "تقويم العمل")}</option>
        </PopSelect>
      </Field>
      {hours === "WorkingCalendar" && (
        <>
          <Field label={t("Offline message (English)", "رسالة خارج الدوام (إنجليزي)")}>
            <input className="awp-input" value={offline} onChange={(event) => setOffline(event.target.value)} />
          </Field>
          <Field label={t("Offline message (Arabic)", "رسالة خارج الدوام (عربي)")}>
            <input className="awp-input" dir="rtl" value={offlineAr} onChange={(event) => setOfflineAr(event.target.value)} />
          </Field>
        </>
      )}

      {problem && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {problem}
        </p>
      )}
    </Drawer>
  );
}

/** `UC-61.1-03` and `UC-61.1-05`: the test, with each check's own result and reason. */
export function TestChannel({ config, onClose }: { config: ChannelConfig; onClose: () => void }) {
  const { t } = useAwp();
  const [sendTo, setSendTo] = useState(config.type === "WhatsApp" ? "+971 50 000 0000" : "tester@tahseel.ae");
  const [message, setMessage] = useState(t("Juman channel test", "اختبار قناة جمان"));
  const [checks, setChecks] = useState<ChannelCheck[]>(config.lastTestChecks);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, run] = useTransition();
  const name = t(...(CHANNEL_LABEL[config.type] ?? [config.type, config.type]));

  return (
    <Modal
      title={t("Test channel", "اختبار القناة") + " · " + name}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
          <Btn
            label={t("Send test message", "إرسال رسالة اختبار")}
            disabled={running || sendTo.trim() === "" || message.trim() === ""}
            onClick={() =>
              run(async () => {
                const outcome = await testChannel({ type: config.type, sendTo, message });
                if (outcome.ok) setChecks(outcome.value);
                else setProblem(outcome.reason);
              })
            }
          />
        </>
      }
    >
      <Field label={t("Send to", "إرسال إلى")}>
        <input className="awp-input" value={sendTo} onChange={(event) => setSendTo(event.target.value)} />
      </Field>
      <Field label={t("Message", "الرسالة")}>
        <input className="awp-input" value={message} onChange={(event) => setMessage(event.target.value)} />
      </Field>
      {problem && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {problem}
        </p>
      )}
      {checks.length > 0 && (
        <div className="awp-col" style={{ gap: 8 }} role="status">
          {checks.map((check) => (
            <div key={check.name} className="awp-row" style={{ gap: 10, alignItems: "flex-start" }}>
              <Ic n={check.ok ? "TickCircle" : "Icon4"} s={18} c={check.ok ? "var(--icon-success)" : "var(--icon-danger)"} />
              <div>
                <b>{check.name}</b>
                <div className="awp-small awp-muted">
                  {check.detail}
                  {check.ms !== null ? ` · ${check.ms} ms` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
