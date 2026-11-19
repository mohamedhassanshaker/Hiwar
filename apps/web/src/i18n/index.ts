/**
 * Decision 4 of `answer-spec-writer-1.md`: the console stays on the inline
 * `t('English', 'العربية')` helper. This module owns the helper, the direction a locale
 * reads in, and the date and number formatting that goes with it; `src/lib/preferences.tsx`
 * owns where the current locale is stored.
 */

export type Lang = "en" | "ar";

/** `T(en, ar)` from the prototype's shell. */
export type Translate = (en: string, ar: string) => string;

/** The `t(en, ar)` helper for `lang`: it returns the Arabic text in Arabic, else the English. */
export function translate(lang: Lang): Translate {
  return (en, ar) => (lang === "ar" ? ar : en);
}

/** The text direction `lang` reads in. */
export function dirOf(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/**
 * Specification section 9: every money value is an estimate and is written in AED, with the
 * currency after the number in Arabic and before it in English.
 */
export function formatMoney(lang: Lang, value: number): string {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === "ar" ? `${n} د.إ` : `AED ${n}`;
}

/** A number with the grouping and digits of `ar-AE` or `en-US`. */
export function formatNumber(lang: Lang, value: number): string {
  return value.toLocaleString(lang === "ar" ? "ar-AE" : "en-US");
}

/** A short day-and-month label, the form the prototype's lists use. */
export function formatDay(lang: Lang, value: Date): string {
  return value.toLocaleDateString(lang === "ar" ? "ar-AE" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
}

/** A 24-hour `HH:MM` time in Dubai time. */
export function formatTime(lang: Lang, value: Date): string {
  return value.toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" });
}

/** A numeric calendar date in Dubai time: `YYYY-MM-DD` in English, the `ar-AE` form in Arabic. */
export function formatDate(lang: Lang, value: Date): string {
  return value.toLocaleDateString(lang === "ar" ? "ar-AE" : "en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Dubai" });
}

/**
 * "2m", "3h", "9d" — how long ago something happened, in the compact form the lists use.
 * The caller writes the surrounding words, because Arabic puts them before the value. `now` is
 * the browser's clock (`useAgo`), never the server's (D160).
 */
export function relativeAge(value: Date | string, now: Date): string {
  const then = typeof value === "string" ? Date.parse(value) : value.getTime();
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
