"use client";

import type { ReactNode } from "react";

import { BrandLogo, type Logos } from "@/components/shared/brand-logo";
import * as D from "@/ds";
import { usePreferences } from "@/lib/preferences";

/**
 * S-05's frame, shared by every screen before sign-in: the organisation's logo, a heading, a
 * line under it, and the screen's own content.
 */
export function AuthCard({ logos, title, intro, children }: { logos: Logos; title: string; intro?: ReactNode; children: ReactNode }) {
  const { t, theme, lang } = usePreferences();
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--surface-page)", padding: 24 }}>
      <main className="awp-card" style={{ width: "min(420px,100%)", padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
          <BrandLogo logos={logos} theme={theme} lang={lang} h={48} alt={t("Organisation logo", "شعار الجهة")} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{title}</h1>
            {intro && (
              <p className="awp-muted" style={{ margin: "6px 0 0" }}>
                {intro}
              </p>
            )}
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

/** A form's submit button in the design system's look; disabled while the form is being sent. */
export function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button type="submit" className={`awp-btn${pending ? "" : " awp-btn-primary"}`} disabled={pending} style={{ width: "100%" }}>
      <D.Button type="default" size="sm" state={pending ? "disabled" : "default"} label={label} />
    </button>
  );
}

/** A refusal or notice under a form. */
export function FormMessage({ tone, children }: { tone: "bad" | "good"; children: ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      data-sign-in-error={tone === "bad" ? "" : undefined}
      className="awp-small"
      style={{ margin: 0, color: tone === "bad" ? "var(--text-danger)" : "var(--feedback-success-text)" }}
    >
      {children}
    </p>
  );
}
