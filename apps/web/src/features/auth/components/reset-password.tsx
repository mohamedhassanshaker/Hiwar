"use client";

import type { Logos } from "@/components/shared/brand-logo";
import { usePreferences } from "@/lib/preferences";
import { resetPasswordAction } from "../actions";
import { AuthCard, FormMessage } from "./auth-card";
import { NewPasswordForm } from "./new-password-form";

/**
 * D387: the page a Forgot password email links to. A link that is open asks for the new
 * password; one that expired or was used says to ask for another.
 */
export function ResetPassword({ token, open, logos }: { token: string; open: boolean; logos: Logos }) {
  const { t } = usePreferences();
  return (
    <AuthCard logos={logos} title={t("Choose a new password", "اختر كلمة مرور جديدة")}>
      {open ? (
        <>
          <NewPasswordForm token={token} submitLabel={t("Change password", "تغيير كلمة المرور")} onSubmit={resetPasswordAction} />
          <span className="awp-small awp-muted">
            {t("Changing it signs you out everywhere you are signed in.", "تغييرها يسجّل خروجك من كل مكان سجّلت الدخول فيه.")}
          </span>
        </>
      ) : (
        <>
          <FormMessage tone="bad">{t("This link has expired or was used. Ask for a new one.", "انتهت صلاحية هذا الرابط أو استُخدم. اطلب رابطاً جديداً.")}</FormMessage>
          <a className="awp-lnk" href="/forgot-password">
            {t("Ask for a new link", "اطلب رابطاً جديداً")}
          </a>
        </>
      )}
    </AuthCard>
  );
}
