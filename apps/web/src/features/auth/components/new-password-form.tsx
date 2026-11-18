"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Field } from "@/components/ui/field";
import { PASSWORD_MIN } from "@/lib/password-rules";
import { usePreferences } from "@/lib/preferences";
import type { AuthOutcome } from "../actions";
import { FormMessage, SubmitButton } from "./auth-card";

/**
 * D387: choosing a password, typed twice — from a Forgot password link or an invitation. The
 * server applies the rules (12 to 128 characters, not the email address) and says which failed.
 */
export function NewPasswordForm({
  token,
  submitLabel,
  onSubmit,
}: {
  token: string;
  submitLabel: string;
  onSubmit: (input: { token: string; password: string; confirm: string }) => Promise<AuthOutcome>;
}) {
  const { t } = usePreferences();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      setProblem(null);
      const outcome = await onSubmit({ token, password: String(form.get("password")), confirm: String(form.get("confirm")) });
      if (outcome && !outcome.ok) setProblem(t(outcome.message, outcome.messageAr));
    });
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
      <Field
        label={t("New password", "كلمة المرور الجديدة")}
        hint={t(`At least ${PASSWORD_MIN} characters. A phrase of several words is easy to remember.`, `${PASSWORD_MIN} حرفاً على الأقل. عبارة من عدة كلمات يسهل تذكرها.`)}
      >
        <input className="awp-input" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} dir="ltr" />
      </Field>
      <Field label={t("Type it again", "أعد كتابتها")}>
        <input className="awp-input" name="confirm" type="password" autoComplete="new-password" required dir="ltr" />
      </Field>
      {problem && <FormMessage tone="bad">{problem}</FormMessage>}
      <SubmitButton label={submitLabel} pending={pending} />
    </form>
  );
}
