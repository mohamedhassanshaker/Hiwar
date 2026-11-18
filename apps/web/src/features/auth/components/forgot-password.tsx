"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { Logos } from "@/components/shared/brand-logo";
import { Field } from "@/components/ui/field";
import { usePreferences } from "@/lib/preferences";
import { requestPasswordResetAction } from "../actions";
import { AuthCard, FormMessage, SubmitButton } from "./auth-card";

/**
 * D387: Forgot password. The answer is the same whether or not the address has an account, so
 * the screen cannot be used to find out who works here.
 */
export function ForgotPassword({ logos }: { logos: Logos }) {
  const { t } = usePreferences();
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    start(async () => {
      setProblem(null);
      const outcome = await requestPasswordResetAction({ email });
      if (outcome.ok) setSent(true);
      else setProblem(t(outcome.message, outcome.messageAr));
    });
  };

  return (
    <AuthCard
      logos={logos}
      title={t("Forgot your password?", "نسيت كلمة المرور؟")}
      intro={t("Enter your email. If it belongs to an account here, we email you a link to choose a new password.", "أدخل بريدك الإلكتروني. إن كان لحساب هنا فسنرسل إليك رابطاً لاختيار كلمة مرور جديدة.")}
    >
      {sent ? (
        <FormMessage tone="good">
          {t(
            "If that address has an account, a link is on its way. It works once, for 30 minutes. Check your spam folder if it does not arrive.",
            "إن كان لهذا العنوان حساب فالرابط في طريقه إليك. يعمل مرة واحدة لمدة 30 دقيقة. تحقق من مجلد الرسائل غير المرغوب فيها إن لم يصل.",
          )}
        </FormMessage>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
          <Field label={t("Email", "البريد الإلكتروني")}>
            <input className="awp-input" name="email" type="email" autoComplete="username" required dir="ltr" />
          </Field>
          {problem && <FormMessage tone="bad">{problem}</FormMessage>}
          <SubmitButton label={t("Email me a link", "أرسل لي رابطاً")} pending={pending} />
        </form>
      )}
      <a className="awp-lnk awp-small" href="/sign-in" style={{ textAlign: "center" }}>
        {t("Back to sign in", "العودة إلى تسجيل الدخول")}
      </a>
    </AuthCard>
  );
}
