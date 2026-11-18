"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { Logos } from "@/components/shared/brand-logo";
import { Field } from "@/components/ui/field";
import { usePreferences } from "@/lib/preferences";
import { cancelUaePassLinkAction, signInWithPasswordAction } from "../actions";
import { SIGN_IN_ERRORS } from "../errors";
import { AuthCard, FormMessage, SubmitButton } from "./auth-card";
import { UaePassButton } from "./uae-pass-button";

type T = (en: string, ar: string) => string;

/**
 * `UC-05.1-02`, `UC-05.1-03` and D387: why a UAE PASS round trip or an Auth.js page ended here,
 * in words. The UAE PASS sentences are its design guidelines' own (Error messages).
 */
function reasonOf(error: string | undefined, t: T): string | null {
  if (!error) return null;
  const words: Record<string, string> = {
    [SIGN_IN_ERRORS.suspended]: t("Your access is suspended — contact your administrator.", "تم تعليق وصولك — تواصل مع مسؤول النظام."),
    [SIGN_IN_ERRORS.invitation]: t(
      "You are invited but have not accepted yet. Open the invitation link from your email, or ask for a new one.",
      "أنت مدعوّ ولم تقبل الدعوة بعد. افتح رابط الدعوة من بريدك، أو اطلب رابطاً جديداً.",
    ),
    [SIGN_IN_ERRORS.pending]: t(
      "Your registration is waiting for approval. We will email you when it is approved.",
      "طلب تسجيلك بانتظار الاعتماد. سنراسلك عبر البريد الإلكتروني عند اعتماده.",
    ),
    [SIGN_IN_ERRORS.cancelled]: t("User cancelled the login.", "قام المستخدم بالغاء تسجيل الدخول"),
    [SIGN_IN_ERRORS.unverified]: t(
      "You are not eligible to access this service. Your account is either not upgraded or you have a visitor account. Please upgrade your UAE PASS account, or sign in with your email and password.",
      "أنت غير مؤهل للوصول إلى هذه الخدمة. حسابك غير مُرقّى أو لديك حساب زائر. يرجى ترقية حسابك في الهوية الرقمية، أو تسجيل الدخول ببريدك الإلكتروني وكلمة المرور.",
    ),
    [SIGN_IN_ERRORS.mismatch]: t(
      "Your UAE PASS cannot be linked to this account: it is linked elsewhere or its Emirates ID is a different one. Ask your administrator.",
      "لا يمكن ربط الهوية الرقمية بهذا الحساب: فهي مرتبطة بحساب آخر أو رقم الهوية الإماراتية مختلف. تواصل مع مسؤول النظام.",
    ),
    [SIGN_IN_ERRORS.failed]: t("Something went wrong during the login, please try again later!", "حدث خطأ ما أثناء تسجيل الدخول، يُرجى المحاولة مرة أخرى لاحقًا!"),
  };
  return words[error] ?? t("Sign-in did not complete. Try again.", "لم يكتمل تسجيل الدخول. حاول مرة أخرى.");
}

/**
 * S-05: the way in (D387). Email and password, with Forgot password beside it, and UAE PASS
 * when it is set up. A UAE PASS account no person is linked to yet arrives here with `linking`:
 * the person signs in once with their password to link it, as UAE PASS's manual linking asks.
 */
export function SignIn({
  error,
  notice,
  linking,
  uaePass,
  next,
  logos,
}: {
  error?: string;
  notice?: "reset" | "registered";
  linking: { nameEn: string; nameAr: string } | null;
  uaePass: boolean;
  next?: string;
  logos: Logos;
}) {
  const { t, lang } = usePreferences();
  const [problem, setProblem] = useState<string | null>(reasonOf(error, t));
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      setProblem(null);
      const outcome = await signInWithPasswordAction({ email: form.get("email"), password: form.get("password"), next });
      if (outcome && !outcome.ok) setProblem(t(outcome.message, outcome.messageAr));
    });
  };

  return (
    <AuthCard logos={logos} title={t("Agentic Work Platform", "منصة العمل بالوكلاء")} intro={t("Sign in to continue.", "سجّل الدخول للمتابعة.")}>
      {linking && (
        <div className="awp-card" role="status" style={{ padding: 12, display: "grid", gap: 8 }}>
          <span className="awp-small">
            {t(
              `${linking.nameEn}, your UAE PASS is not linked to an account here yet. Sign in once with your email and password to link it. If you have no account, register it instead.`,
              `${linking.nameAr}، هويتك الرقمية غير مرتبطة بحساب هنا بعد. سجّل الدخول مرة واحدة ببريدك الإلكتروني وكلمة المرور لربطها. إن لم يكن لديك حساب، فسجّلها بدلاً من ذلك.`,
            )}
          </span>
          <a className="awp-lnk awp-small" href="/register">
            {t("Register with this UAE PASS", "التسجيل بهذه الهوية الرقمية")}
          </a>
          <form action={cancelUaePassLinkAction}>
            <button type="submit" className="awp-lnk" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              {t("Do not link", "عدم الربط")}
            </button>
          </form>
        </div>
      )}
      {notice === "registered" && (
        <FormMessage tone="good">
          {t(
            "Your registration is received and waiting for approval. We will email you when it is approved; then you can sign in.",
            "تم استلام طلب تسجيلك وهو بانتظار الاعتماد. سنراسلك عند اعتماده، وبعدها تستطيع تسجيل الدخول.",
          )}
        </FormMessage>
      )}
      {notice === "reset" && <FormMessage tone="good">{t("Your password was changed. Sign in with it.", "تم تغيير كلمة المرور. سجّل الدخول بها.")}</FormMessage>}
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
        <Field label={t("Email", "البريد الإلكتروني")}>
          <input className="awp-input" name="email" type="email" autoComplete="username" required dir="ltr" />
        </Field>
        <Field label={t("Password", "كلمة المرور")}>
          <input className="awp-input" name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </Field>
        <div className="awp-row" style={{ justifyContent: "space-between" }}>
          <a className="awp-lnk awp-small" href="/register">
            {t("Create an account", "إنشاء حساب")}
          </a>
          <a className="awp-lnk awp-small" href="/forgot-password">
            {t("Forgot password?", "نسيت كلمة المرور؟")}
          </a>
        </div>
        {problem && <FormMessage tone="bad">{problem}</FormMessage>}
        <SubmitButton label={t("Sign in", "تسجيل الدخول")} pending={pending} />
      </form>
      {uaePass && !linking && (
        <>
          <div className="awp-small awp-muted" style={{ textAlign: "center" }}>
            {t("or", "أو")}
          </div>
          <UaePassButton next={next} lang={lang === "ar" ? "ar" : "en"} />
        </>
      )}
    </AuthCard>
  );
}
