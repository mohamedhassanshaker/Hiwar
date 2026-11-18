"use client";

import { useState } from "react";

import { PageHead } from "@/components/shared/page-head";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { orThrow, Refused } from "@/lib/outcome";
import { BrandingUpload } from "./branding-upload";
import { MailSettings } from "./mail-settings";
import { BrandLogo } from "@/components/shared/brand-logo";
import { AA_CONTRAST, accessibleAlternative, contrastAgainstWhite } from "@/lib/contrast";
import { isRenderableImage } from "@/lib/branding";
import { saveBrandColour, saveGeneralSettings } from "@/features/governance/actions";
import type { Settings as SettingsData } from "@/features/governance/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";

/**
 * The Settings screen: General, Branding and Email tabs. General and the brand colour are edited
 * locally and written by one Save; logos, the favicon and Email save
 * from their own controls.
 */
export function Settings({ settings }: { settings: SettingsData }) {
  const { t, lang } = useAwp();
  const [tab, setTab] = useState("general");
  const [brand, setBrand] = useState(settings.brandColour);
  const [org, setOrg] = useState(settings.organisation);
  const [run, pending] = useAction();
  const field = (key: keyof typeof org) => (value: string) => setOrg({ ...org, [key]: value });

  /**
   * `UC-75.1-01` and `UC-75.2-03`: one Save for the screen. General and the brand colour are
   * written separately because they are two different records.
   */
  const save = () =>
    run(async () => {
      const general = await saveGeneralSettings({
        nameEn: org.nameEn,
        nameAr: org.nameAr,
        timeZone: org.timeZone,
        languages: org.languages,
        // The form shows the calendars by name and does not change them.
        workingCalendarId: settings.workingCalendarId,
        holidayCalendarId: settings.holidayCalendarId,
      });
      if (!general.ok) throw new Refused({ reason: general.message });
      if (brand !== settings.brandColour) orThrow(await saveBrandColour({ colour: brand }));
      return t("Settings saved.", "تم حفظ الإعدادات.");
    });
  const swatches = ["#0677FF", "#0848CE", "#12034B", "#6538B5", "#2F784A"];
  // The preview shows what is stored, not the name of the last file chosen. Only a
  // `data:image/...` reference is rendered: the value is validated on write, and the preview
  // is the one place it reaches an `src`.
  const storedLogo = (kind: string): string | null => {
    const asset = settings.branding.find((item) => item.kind === kind)?.contentRef;
    return isRenderableImage(asset) ? asset : null;
  };
  const contrast = contrastAgainstWhite(brand);
  const passes = contrast >= AA_CONTRAST;

  return (
    <div className="awp-page" style={{ maxWidth: 1080 }}>
      <PageHead
        crumb={t("Govern", "الحوكمة")}
        title={t("Settings", "الإعدادات")}
        sub={t(`Validated against schema. Every change is kept in history — version ${settings.versionNumber}.`, `تُتحقق وفق المخطط. يُحفظ كل تغيير في السجل — الإصدار ${settings.versionNumber}.`)}
      >
        <Btn label={t("Save changes", "حفظ التغييرات")} disabled={!passes || pending} onClick={save} />
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[{ id: "general", label: t("General", "عام") }, { id: "branding", label: t("Branding", "الهوية") }, { id: "email", label: t("Email", "البريد") }]} />
      {tab === "email" && <MailSettings mail={settings.mail} />}
      {tab === "general" && (
        <Card title={t("Organisation", "الجهة")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))", gap: 16 }}>
            <Field label={t("Name (English)", "الاسم (إنجليزي)")}><input className="awp-input" value={org.nameEn} onChange={(e) => field("nameEn")(e.target.value)} /></Field>
            <Field label={t("Name (Arabic)", "الاسم (عربي)")}><input className="awp-input" value={org.nameAr} onChange={(e) => field("nameAr")(e.target.value)} dir="rtl" /></Field>
            <Field label={t("Time zone", "المنطقة الزمنية")}><input className="awp-input" value={org.timeZone} onChange={(e) => field("timeZone")(e.target.value)} /></Field>
            <Field label={t("Languages", "اللغات")}>
              <input
                className="awp-input"
                value={org.languages.join(", ")}
                onChange={(e) => setOrg({ ...org, languages: e.target.value.split(",").map((one) => one.trim()).filter(Boolean) })}
              />
            </Field>
            <Field label={t("Working calendar", "تقويم العمل")}><input className="awp-input" defaultValue={t(settings.workingCalendarEn, settings.workingCalendarAr)} /></Field>
            <Field label={t("Holidays", "العطل")}><input className="awp-input" defaultValue={t(settings.holidayCalendarEn, settings.holidayCalendarAr)} /></Field>
          </div>
        </Card>
      )}
      {tab === "branding" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="awp-two">
          <Card title={t("Logo", "الشعار")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="awp-col" style={{ gap: 6 }}>
                  <span className="awp-small awp-muted">{t("Light theme", "السمة الفاتحة")}</span>
                  <div style={{ height: 88, borderRadius: 12, border: "1px solid var(--border-divider)", background: "var(--color-white, #fff)", display: "grid", placeItems: "center", overflow: "hidden" }}>
                    <BrandLogo logos={{ logoLight: storedLogo("LogoLight"), logoDark: null }} theme="light" lang={lang} h={56} alt={t("Light logo", "الشعار الفاتح")} />
                  </div>
                </div>
                <div className="awp-col" style={{ gap: 6 }}>
                  <span className="awp-small awp-muted">{t("Dark theme", "السمة الداكنة")}</span>
                  <div style={{ height: 88, borderRadius: 12, border: "1px solid var(--border-divider)", background: "var(--color-navy-900, #12034B)", display: "grid", placeItems: "center", overflow: "hidden" }}>
                    {/* The Juman mark's text reads its colour from these tokens, so the dark
                        preview sets them to the dark theme's. */}
                    <div data-theme="dark" style={{ ["--text-primary" as string]: "#fff", ["--text-secondary" as string]: "#c9d2ff" }}>
                      <BrandLogo logos={{ logoLight: null, logoDark: storedLogo("LogoDark") }} theme="dark" lang={lang} h={56} alt={t("Dark logo", "الشعار الداكن")} />
                    </div>
                  </div>
                </div>
              </div>
              <BrandingUpload kind="LogoLight" label={t("Upload light logo", "رفع شعار فاتح")} stored={!!storedLogo("LogoLight")} />
              <BrandingUpload kind="LogoDark" label={t("Upload dark logo", "رفع شعار داكن")} stored={!!storedLogo("LogoDark")} />
              <BrandingUpload kind="Favicon" label={t("Upload favicon", "رفع أيقونة المتصفح")} stored={settings.branding.some((item) => item.kind === "Favicon")} />
              <div className="awp-small awp-muted">
                {t(`${settings.branding.length} branding assets stored.`, `${settings.branding.length} من أصول الهوية محفوظة.`)}
              </div>
            </div>
          </Card>
          <Card title={t("Application colours", "ألوان التطبيق")}>
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Primary brand colour", "لون الهوية الأساسي")}>
                <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: 48, height: 44, border: "1px solid var(--border-divider)", borderRadius: 12, padding: 2, background: "var(--surface-input)", cursor: "pointer" }} aria-label={t("Pick colour", "اختر اللون")} />
                  <input className="awp-input awp-mono" style={{ width: 120 }} value={brand} onChange={(e) => setBrand(e.target.value)} />
                  {swatches.map((c) => (
                    <button key={c} onClick={() => setBrand(c)} aria-label={c} style={{ width: 32, height: 32, borderRadius: 8, background: c, cursor: "pointer", border: brand === c ? "3px solid var(--border-selected)" : "1px solid var(--border-divider)" }} />
                  ))}
                </div>
              </Field>
              <div
                className="awp-card"
                style={{ padding: 14, background: passes ? "var(--feedback-success-bg)" : "var(--feedback-danger-bg)", color: passes ? "var(--feedback-success-text)" : "var(--feedback-danger-text)" }}
                role={passes ? undefined : "alert"}
              >
                {passes
                  ? t(`Contrast ${contrast}:1 against white — passes WCAG 2.2 AA.`, `التباين ${contrast}:1 مقابل الأبيض — يجتاز WCAG 2.2 AA.`)
                  : t(
                      `Contrast ${contrast}:1 against white fails WCAG 2.2 AA (4.5:1). Try ${accessibleAlternative(brand)}.`,
                      `التباين ${contrast}:1 مقابل الأبيض لا يجتاز WCAG 2.2 AA (4.5:1). جرّب ${accessibleAlternative(brand)}.`,
                    )}
                {!passes && (
                  <button className="awp-chip" style={{ marginInlineStart: 10 }} onClick={() => setBrand(accessibleAlternative(brand))}>
                    {t("Use the suggestion", "استخدام المقترح")}
                  </button>
                )}
              </div>
              <div className="awp-card" style={{ padding: 16, background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="awp-small awp-muted">{t("Preview", "معاينة")}</span>
                <div className="awp-row" style={{ gap: 10 }}>
                  <span style={{ height: 40, padding: "0 16px", borderRadius: 12, background: brand, color: "#fff", display: "inline-flex", alignItems: "center", fontWeight: 900 }}>{t("Primary button", "زر أساسي")}</span>
                  <span style={{ height: 40, padding: "0 16px", borderRadius: 12, border: `1px solid ${brand}`, color: brand, display: "inline-flex", alignItems: "center", fontWeight: 500 }}>{t("Secondary", "ثانوي")}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: "var(--surface-sunken)" }}>
                  <div style={{ width: "60%", height: "100%", borderRadius: 99, background: brand }} />
                </div>
              </div>
              <p className="awp-small awp-muted" style={{ margin: 0 }}>
                {t("Applied to buttons, links, active navigation and the embedded widget. Contrast is checked against WCAG 2.2 AA before saving.", "يُطبق على الأزرار والروابط والتنقل النشط والويدجت المضمّن. يُفحص التباين وفق WCAG 2.2 AA قبل الحفظ.")}
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
