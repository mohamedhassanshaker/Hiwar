"use client";

import Image from "next/image";

import { usePreferences } from "@/lib/preferences";

/**
 * D387: Sign in with UAE PASS, as UAE PASS's official button (its button guidelines' "Sign in"
 * default black button, from the asset pack in `public/uaepass/`, without the white artboard behind
 * it), in the page's language, on both themes. A link, not a form, because the sign-in starts with
 * a plain redirect (`/api/uaepass/start`). The image's alt text is the button's accessible name.
 */
export function UaePassButton({ next, lang }: { next?: string; lang: "en" | "ar" }) {
  const { t } = usePreferences();
  const query = new URLSearchParams({ lang, ...(next ? { next } : {}) });
  return (
    <a href={`/api/uaepass/start?${query.toString()}`} data-uaepass style={{ display: "flex", justifyContent: "center", borderRadius: 12 }}>
      {/* `unoptimized`: an official SVG, served as shipped rather than re-encoded. */}
      <Image
        src={`/uaepass/sign-in-${lang}-black.svg`}
        alt={t("Sign in with UAE PASS", "تسجيل الدخول بالهوية الرقمية")}
        width={310}
        height={54}
        unoptimized
        style={{ maxWidth: "100%", height: "auto" }}
      />
    </a>
  );
}
