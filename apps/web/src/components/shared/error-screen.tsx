"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { Ic } from "@/components/ui/icon";
import { NOT_PERMITTED_DIGEST, STALE_WRITE_DIGEST } from "@/lib/digests";
import { usePreferences } from "@/lib/preferences";

/**
 * What a route-level error boundary shows (`nextjs-rules.md` rule 12).
 *
 * The boundary never sees the server's error text — Next.js replaces it in production —
 * so the three cases the console distinguishes travel as a digest the thrower sets:
 * `COM-07`'s refusal, `COM-10`'s stale write, and everything else, which gets `COM-06`'s
 * non-technical banner with Retry. Nothing here renders the message, the stack or the
 * digest itself.
 */
export type ErrorScreenProps = { digest?: string; onRetry?: () => void };

/** A centred card with an icon, a title, a line of text and an optional action. */
function Frame({ icon, tone, title, body, action }: { icon: string; tone: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="awp-page">
      <section className="awp-card" style={{ maxWidth: 560, margin: "48px auto", textAlign: "center" }}>
        <div className="awp-card-b awp-col" style={{ gap: 12, alignItems: "center", padding: 32 }}>
          <Ic n={icon} s={40} c={tone} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{title}</h2>
          <p className="awp-muted" style={{ margin: 0 }}>{body}</p>
          {action}
        </div>
      </section>
    </div>
  );
}

/**
 * The error boundary's screen, chosen by digest: the access refusal (no action), the stale
 * write (Reload), or the generic failure (Retry). Both actions call `onRetry`.
 */
export function ErrorScreen({ digest, onRetry }: ErrorScreenProps) {
  const { t } = usePreferences();

  if (digest === NOT_PERMITTED_DIGEST) {
    return (
      <Frame
        icon="SquareLock02"
        tone="var(--icon-tertiary)"
        title={t("You don't have access", "ليس لديك صلاحية الوصول")}
        body={t(
          "This screen is not part of what you may see. Ask your administrator if you need it.",
          "هذه الشاشة ليست ضمن ما يمكنك عرضه. راجع مسؤول النظام إذا كنت بحاجة إليها.",
        )}
      />
    );
  }

  if (digest === STALE_WRITE_DIGEST) {
    return (
      <Frame
        icon="InformationDiamond"
        tone="var(--icon-warning)"
        title={t("This record was changed by someone else.", "تم تغيير هذا السجل بواسطة شخص آخر.")}
        body={t("Reload the screen to see the current version, then apply your change again.", "أعد تحميل الشاشة لعرض النسخة الحالية ثم أعد تطبيق تغييرك.")}
        action={
          <button className="awp-chip" onClick={onRetry}>
            {t("Reload", "إعادة التحميل")}
          </button>
        }
      />
    );
  }

  return (
    <Frame
      icon="InformationDiamond"
      tone="var(--icon-danger)"
      title={t("Something went wrong", "حدث خطأ ما")}
      body={t("We could not load this screen. Try again in a moment.", "تعذّر تحميل هذه الشاشة. حاول مرة أخرى بعد قليل.")}
      action={
        <button className="awp-chip" onClick={onRetry}>
          {t("Retry", "إعادة المحاولة")}
        </button>
      }
    />
  );
}

/**
 * The 404 screen. Rendered outside the shell, so it carries its own way back — and that
 * label goes through `t()` like every other string in the console, rather than showing
 * both languages at once.
 */
export function NotFound() {
  const { t } = usePreferences();
  return (
    <Frame
      icon="Search"
      tone="var(--icon-tertiary)"
      title={t("This screen does not exist", "هذه الشاشة غير موجودة")}
      body={t("The address you opened is not part of the console.", "العنوان الذي فتحته ليس جزءاً من المنصة.")}
      action={
        <Link href="/dashboard" className="awp-chip">
          {t("Dashboard", "لوحة المعلومات")}
        </Link>
      }
    />
  );
}
