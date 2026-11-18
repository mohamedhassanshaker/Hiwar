"use client";

import type { Logos } from "@/components/shared/brand-logo";
import { usePreferences } from "@/lib/preferences";
import { acceptInvitationAction } from "../actions";
import { AuthCard, FormMessage } from "./auth-card";
import { NewPasswordForm } from "./new-password-form";

type State = "Open" | "Accepted" | "Expired" | "Withdrawn" | "Unknown";

/**
 * D248 and D387: the page an invitation email links to. An open invitation is accepted by
 * choosing a password, which signs the person in; any other state says what to do instead.
 */
export function Invitation({
  token,
  state,
  name,
  email,
  logos,
}: {
  token: string;
  state: State;
  name: { en: string; ar: string } | null;
  email: string | null;
  logos: Logos;
}) {
  const { t } = usePreferences();
  const message: Record<Exclude<State, "Open">, string> = {
    Accepted: t("This invitation was already accepted. Sign in to continue.", "قُبلت هذه الدعوة من قبل. سجّل الدخول للمتابعة."),
    Expired: t("This invitation has expired. Ask your administrator to send a new one.", "انتهت صلاحية هذه الدعوة. اطلب من المسؤول إرسال دعوة جديدة."),
    Withdrawn: t("This invitation no longer works. Ask your administrator to send a new one.", "لم تعد هذه الدعوة صالحة. اطلب من المسؤول إرسال دعوة جديدة."),
    Unknown: t("This invitation link is not valid.", "رابط الدعوة هذا غير صالح."),
  };
  const intro =
    state === "Open" && name
      ? t(
          `${name.en}, choose a password to join the Agentic Work Platform. You will sign in as ${email}.`,
          `${name.ar}، اختر كلمة مرور للانضمام إلى منصة العمل بالوكلاء. ستسجّل الدخول باسم ${email}.`,
        )
      : undefined;
  return (
    <AuthCard logos={logos} title={t("You are invited", "أنت مدعوّ")} intro={intro}>
      {state === "Open" ? (
        <NewPasswordForm token={token} submitLabel={t("Accept and sign in", "قبول الدعوة وتسجيل الدخول")} onSubmit={acceptInvitationAction} />
      ) : (
        <>
          <FormMessage tone="good">{message[state]}</FormMessage>
          {state === "Accepted" && (
            <a className="awp-lnk" href="/sign-in">
              {t("Sign in", "تسجيل الدخول")}
            </a>
          )}
        </>
      )}
    </AuthCard>
  );
}
