"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PersonAv } from "@/components/ui/avatar";
import { PopSelect } from "@/components/ui/pop-select";
import {
  finishPasskeyRegistration,
  removePasskey,
  revokeSession,
  saveNotificationPreferences,
  saveProfile,
  saveProfilePhoto,
  startPasskeyRegistration,
} from "@/features/organisation/actions";
import { isMobile, isPersonName, PERSON_NAME_MAX, PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/features/organisation/schema";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { orThrow } from "@/lib/outcome";
import { formatDay } from "@/i18n";
import { STALE_WRITE_MESSAGE } from "@/lib/concurrency";
import { STALE_WRITE_DIGEST } from "@/lib/digests";
import type { Person } from "@/types/directory";

export type MyProfileData = {
  me: Person & { unit: string };
  /** D387: the Emirates ID with all but its last four digits hidden, or null when none is recorded. */
  emiratesId: string | null;
  uaePassLinked: boolean;
  mobile: string | null;
  preferredLanguage: string;
  /** `COM-10`: the version the screen read, carried into every write. */
  version: number;
  preference: {
    approvals: boolean;
    mentions: boolean;
    slaWarnings: boolean;
    dailyDigest: boolean;
    requestCreatedEmail: boolean;
    requestUpdatedEmail: boolean;
    requestFinishedEmail: boolean;
    workItemFinishedEmail: boolean;
  };
  passkeys: { id: string; label: string; lastUsedAt: string | null; createdAt: string }[];
  sessions: { token: string; userAgent: string | null; ipAddress: string | null; lastSeenAt: string; expires: string }[];
};

/** Whether a refused write was `COM-10`'s "someone else saved first". */
function isStaleWrite(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { digest?: string }).digest === STALE_WRITE_DIGEST;
}

/** S-04: my profile, my notifications and my security. */
export function MyProfile({ data }: { data: MyProfileData }) {
  const { t, lang, nm } = useAwp();
  const { age, ago } = useAgo();
  const router = useRouter();
  const p = data.me;
  const [notif, setNotif] = useState(data.preference);
  const [form, setForm] = useState({
    nameEn: p.name,
    nameAr: p.nameAr,
    mobile: data.mobile ?? "",
    preferredLanguage: data.preferredLanguage,
  });
  const [mobileTouched, setMobileTouched] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const photoInput = useRef<HTMLInputElement>(null);

  const rows: [keyof typeof notif, string][] = [
    ["approvals", t("Approvals waiting for me", "اعتمادات بانتظاري")],
    ["mentions", t("Mentions in discussion rooms", "الإشارات في اجتماعات العمل")],
    ["slaWarnings", t("SLA warnings on my work items", "تنبيهات اتفاقية الخدمة لبنود عملي")],
    ["dailyDigest", t("Daily email digest", "ملخص يومي بالبريد")],
    ["requestCreatedEmail", t("Email when I submit a request", "بريد عند تقديمي طلباً")],
    ["requestUpdatedEmail", t("Email when a request of mine moves on or is returned", "بريد عند انتقال طلب لي أو إعادته")],
    ["requestFinishedEmail", t("Email when a request of mine finishes", "بريد عند اكتمال طلب لي")],
    ["workItemFinishedEmail", t("Email when a work item I am on finishes", "بريد عند اكتمال بند عمل أشارك فيه")],
  ];

  const toggle = (key: keyof typeof notif, value: boolean) => {
    const next = { ...notif, [key]: value };
    setNotif(next);
    start(async () => {
      orThrow(await saveNotificationPreferences(next));
    });
  };

  // COM-12 and UC-04.1-04: Save stays blocked while the mobile is not one, and the message
  // sits on the field. The server refuses the same value through `profileInput`.
  const mobileValid = isMobile(form.mobile);
  // COM-12: an empty or over-long name is refused on its field too, rather than by the server after Save.
  const namesValid = isPersonName(form.nameEn) && isPersonName(form.nameAr);
  const nameHint = (value: string) =>
    isPersonName(value) ? undefined : (
      <span role="alert" style={{ color: "var(--text-danger)" }}>
        {value.trim()
          ? t(`A name has at most ${PERSON_NAME_MAX} characters.`, `يتكوّن الاسم من ${PERSON_NAME_MAX} حرفاً على الأكثر.`)
          : t("Enter a name.", "أدخل الاسم.")}
      </span>
    );

  const save = () => {
    setSaved(false);
    setMobileTouched(true);
    if (!mobileValid || !namesValid) return;
    start(async () => {
      try {
        orThrow(await saveProfile({ ...form, mobile: form.mobile.trim(), version: data.version }));
        setStale(false);
        setSaved(true);
        router.refresh();
      } catch (error) {
        if (!isStaleWrite(error)) throw error;
        setStale(true);
      }
    });
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const limit = Math.round(PHOTO_MAX_BYTES / 1024) + " KB";
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type) || file.size > PHOTO_MAX_BYTES) {
      setPhotoError(
        t(
          "Use a PNG, JPEG or WebP image of at most " + limit + ".",
          "استخدم صورة PNG أو JPEG أو WebP بحجم لا يتجاوز " + limit + ".",
        ),
      );
      return;
    }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const photo = String(reader.result);
      start(async () => {
        try {
          orThrow(await saveProfilePhoto({ photo, version: data.version }));
          router.refresh();
        } catch (error) {
          if (!isStaleWrite(error)) throw error;
          setStale(true);
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const addPasskey = () => {
    setPasskeyError(null);
    start(async () => {
      try {
        const options = await startPasskeyRegistration();
        const response = await startRegistration({ optionsJSON: options });
        orThrow(await finishPasskeyRegistration({
          label: t("This browser", "هذا المتصفح"),
          response: response as unknown as Record<string, unknown>,
        }));
        router.refresh();
      } catch {
        // The ceremony is the browser's; it fails when the person cancels it or the device
        // refuses. Nothing technical is shown, as `COM-06` asks.
        setPasskeyError(t("That passkey was not registered. Try again.", "لم يتم تسجيل مفتاح المرور. حاول مرة أخرى."));
      }
    });
  };

  return (
    <div className="awp-page" style={{ maxWidth: 960 }}>
      <PageHead title={t("My profile", "ملفي الشخصي")}>
        <Btn label={t("Save changes", "حفظ التغييرات")} disabled={pending || !mobileValid || !namesValid} onClick={save} />
      </PageHead>
      {stale && (
        <div className="awp-card" role="alert">
          <div className="awp-card-b awp-row" style={{ gap: 12 }}>
            <span style={{ flex: 1 }}>{t(STALE_WRITE_MESSAGE[0], STALE_WRITE_MESSAGE[1])}</span>
            <Btn type="secondary" label={t("Reload", "إعادة التحميل")} onClick={() => router.refresh()} />
          </div>
        </div>
      )}
      {saved && (
        <p className="awp-small awp-muted" role="status" style={{ margin: 0 }}>
          {t("Your profile is saved.", "تم حفظ ملفك الشخصي.")}
        </p>
      )}
      <Card>
        <div className="awp-row" style={{ gap: 16, flexWrap: "wrap" }}>
          <PersonAv p={p} s={72} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{nm(p)}</div>
            <div className="awp-muted">
              {t(p.role, p.roleAr)} · {p.unit} · {p.email}
            </div>
            {photoError && (
              <p className="awp-small" role="alert" style={{ color: "var(--text-danger)", margin: "6px 0 0" }}>
                {photoError}
              </p>
            )}
          </div>
          <input
            ref={photoInput}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            data-testid="photo"
            style={{ display: "none" }}
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
          <Btn type="secondary" label={t("Change photo", "تغيير الصورة")} disabled={pending} onClick={() => photoInput.current?.click()} />
        </div>
      </Card>
      <Card title={t("Personal details", "البيانات الشخصية")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 16 }}>
          <Field label={t("Name (English)", "الاسم (إنجليزي)")} hint={nameHint(form.nameEn)}>
            <input
              className="awp-input"
              value={form.nameEn}
              aria-invalid={!isPersonName(form.nameEn)}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            />
          </Field>
          <Field label={t("Name (Arabic)", "الاسم (عربي)")} hint={nameHint(form.nameAr)}>
            <input
              className="awp-input"
              value={form.nameAr}
              dir="rtl"
              aria-invalid={!isPersonName(form.nameAr)}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            />
          </Field>
          <Field
            label={t("Mobile", "الجوال")}
            hint={
              !mobileValid && (mobileTouched || form.mobile.length > 0) ? (
                <span role="alert" style={{ color: "var(--text-danger)" }}>
                  {t("Enter a mobile number, for example +971 50 123 4567.", "أدخل رقم جوال صحيحاً، مثل +971 50 123 4567.")}
                </span>
              ) : undefined
            }
          >
            <input
              className="awp-input"
              value={form.mobile}
              aria-invalid={!mobileValid}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            />
          </Field>
          <Field label={t("Preferred language", "اللغة المفضلة")}>
            <PopSelect className="awp-input" value={form.preferredLanguage} onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </PopSelect>
          </Field>
          <Field
            label={t("Email", "البريد الإلكتروني")}
            hint={t("You sign in with it; an administrator changes it.", "تسجّل الدخول به؛ ويغيّره مسؤول النظام.")}
          >
            <input className="awp-input" value={p.email} disabled readOnly />
          </Field>
        </div>
      </Card>
      <Card title={t("Notifications", "الإشعارات")}>
        {rows.map(([key, label]) => (
          <div key={key} className="awp-row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border-divider)" }}>
            <span style={{ flex: 1 }}>{label}</span>
            <Toggle on={notif[key]} onChange={(v) => toggle(key, v)} />
          </div>
        ))}
      </Card>
      <Card
        title={t("Security", "الأمان")}
        actions={<Btn type="secondary" label={t("Add a passkey", "إضافة مفتاح مرور")} disabled={pending} onClick={addPasskey} />}
      >
        {passkeyError && (
          <p className="awp-small" role="alert" style={{ color: "var(--text-danger)", marginTop: 0 }}>
            {passkeyError}
          </p>
        )}
        <dl className="awp-kv" style={{ margin: 0 }}>
          <dt>{t("Sign-in", "تسجيل الدخول")}</dt>
          <dd>
            {data.uaePassLinked
              ? t("Password · UAE PASS · WebAuthn", "كلمة المرور · الهوية الرقمية · WebAuthn")
              : t("Password · WebAuthn", "كلمة المرور · WebAuthn")}
          </dd>
          <dt>{t("Emirates ID", "رقم الهوية الإماراتية")}</dt>
          <dd>
            {data.emiratesId ? <span dir="ltr">{data.emiratesId}</span> : t("Not recorded — an administrator adds it so you can sign in with UAE PASS.", "غير مسجّل — يضيفه مسؤول النظام لتتمكن من الدخول بالهوية الرقمية.")}
          </dd>
        </dl>
        <div style={{ marginTop: 16 }}>
          <div className="awp-small awp-muted" style={{ marginBottom: 8 }}>
            {t("Passkeys", "مفاتيح المرور")} · {data.passkeys.length}
          </div>
          {data.passkeys.length ? (
            data.passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="awp-row"
                data-passkey={passkey.id}
                style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)" }}
              >
                <span style={{ flex: 1 }}>{passkey.label}</span>
                <span className="awp-small awp-muted">
                  {passkey.lastUsedAt
                    ? `${t("Last used", "آخر استخدام")} ${ago(passkey.lastUsedAt)}`
                    : t("Never used", "لم يُستخدم")}
                </span>
                <Lnk
                  danger
                  onClick={() =>
                    start(async () => {
                      orThrow(await removePasskey({ id: passkey.id }));
                      router.refresh();
                    })
                  }
                >
                  {t("Remove", "إزالة")}
                </Lnk>
              </div>
            ))
          ) : (
            <p className="awp-muted awp-small" style={{ margin: 0 }}>
              {t("No passkey registered yet.", "لا يوجد مفتاح مرور مسجل بعد.")}
            </p>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="awp-small awp-muted" style={{ marginBottom: 8 }}>
            {t("Active sessions", "الجلسات النشطة")} · {data.sessions.length}
          </div>
          {data.sessions.map((session) => (
            <div
              key={session.token}
              className="awp-row"
              data-session={session.token.slice(0, 8)}
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)" }}
            >
              <div style={{ flex: 1 }}>
                <div>{session.userAgent ?? t("This browser", "هذا المتصفح")}</div>
                <div className="awp-small awp-muted">
                  {session.ipAddress ?? "—"} · {t("last seen", "آخر ظهور")} {age(session.lastSeenAt)} · {t("expires", "تنتهي")}{" "}
                  {formatDay(lang, new Date(session.expires))}
                </div>
              </div>
              <Lnk
                danger
                onClick={() =>
                  start(async () => {
                    orThrow(await revokeSession({ token: session.token }));
                    router.refresh();
                  })
                }
              >
                {t("Revoke", "إلغاء")}
              </Lnk>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
