"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { Logos } from "@/components/shared/brand-logo";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { PASSWORD_MIN } from "@/lib/password-rules";
import { usePreferences } from "@/lib/preferences";
import { registerAction, registerWithUaePassAction } from "../actions";
import { AuthCard, FormMessage, SubmitButton } from "./auth-card";
import { UaePassButton } from "./uae-pass-button";

/**
 * S-05, D393: registering without an invitation. With an email and a password, or with UAE PASS:
 * a UAE PASS account arrives here as `uaePassName` and needs only an email. Either way the
 * person chooses their organization, and the registration waits for an approver, and the person is told so on the sign-in screen.
 */
export function Register({
  uaePass,
  uaePassName,
  units,
  logos,
}: {
  uaePass: boolean;
  uaePassName: { nameEn: string; nameAr: string } | null;
  units: { id: string; nameEn: string; nameAr: string }[];
  logos: Logos;
}) {
  const { t, lang } = usePreferences();
  const [problem, setProblem] = useState<string | null>(null);
  const [orgUnitId, setOrgUnitId] = useState("");
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    if (!orgUnitId) return setProblem(t("Choose your organization.", "اختر جهتك."));
    start(async () => {
      setProblem(null);
      const outcome = uaePassName
        ? await registerWithUaePassAction({ email: field("email"), orgUnitId })
        : await registerAction({ nameEn: field("nameEn"), nameAr: field("nameAr"), email: field("email"), orgUnitId, password: field("password"), confirm: field("confirm") });
      if (outcome && !outcome.ok) setProblem(t(outcome.message, outcome.messageAr));
    });
  };

  return (
    <AuthCard
      logos={logos}
      title={t("Create an account", "إنشاء حساب")}
      intro={t("An administrator approves every registration. We email you when yours is approved.", "يعتمد المسؤول كل طلب تسجيل. سنراسلك عند اعتماد طلبك.")}
    >
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
        {uaePassName ? (
          <p className="awp-small" role="status" style={{ margin: 0 }}>
            {t(`${uaePassName.nameEn}, your UAE PASS is verified. Add the email address to reach you at.`, `${uaePassName.nameAr}، تم التحقق من هويتك الرقمية. أضف البريد الإلكتروني للتواصل معك.`)}
          </p>
        ) : (
          <>
            <Field label={t("Full name (English)", "الاسم الكامل (إنجليزي)")}>
              <input className="awp-input" name="nameEn" autoComplete="name" required />
            </Field>
            <Field label={t("Full name (Arabic, optional)", "الاسم الكامل (عربي، اختياري)")}>
              <input className="awp-input" name="nameAr" dir="rtl" />
            </Field>
          </>
        )}
        <Field label={t("Email", "البريد الإلكتروني")}>
          <input className="awp-input" name="email" type="email" autoComplete="username" required dir="ltr" />
        </Field>
        <Field label={t("Organization", "الجهة")}>
          <PopSelect className="awp-input" value={orgUnitId} onChange={(event) => setOrgUnitId(event.target.value)}>
            <option value="">{t("Select your organization", "اختر جهتك")}</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {t(unit.nameEn, unit.nameAr)}
              </option>
            ))}
          </PopSelect>
        </Field>
        {!uaePassName && (
          <>
            <Field
              label={t("Password", "كلمة المرور")}
              hint={t(`At least ${PASSWORD_MIN} characters. A phrase of several words is easy to remember.`, `${PASSWORD_MIN} حرفاً على الأقل. عبارة من عدة كلمات يسهل تذكرها.`)}
            >
              <input className="awp-input" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} dir="ltr" />
            </Field>
            <Field label={t("Type it again", "أعد كتابتها")}>
              <input className="awp-input" name="confirm" type="password" autoComplete="new-password" required dir="ltr" />
            </Field>
          </>
        )}
        {problem && <FormMessage tone="bad">{problem}</FormMessage>}
        <SubmitButton label={t("Register", "تسجيل")} pending={pending} />
      </form>
      {uaePass && !uaePassName && (
        <>
          <div className="awp-small awp-muted" style={{ textAlign: "center" }}>
            {t("or", "أو")}
          </div>
          <UaePassButton next="/register" lang={lang === "ar" ? "ar" : "en"} />
        </>
      )}
      <a className="awp-lnk awp-small" href="/sign-in" style={{ textAlign: "center" }}>
        {t("Already have an account? Sign in", "لديك حساب؟ سجّل الدخول")}
      </a>
    </AuthCard>
  );
}
