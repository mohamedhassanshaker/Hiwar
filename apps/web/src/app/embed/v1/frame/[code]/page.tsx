import { WidgetFrame } from "@/features/engage/components/widget-frame";
import { publicConfig } from "@/features/engage/widget-session";

import "./widget.css";

/**
 * The embedded widget's frame (widget specification sections 2 and 4, D231): the chat the
 * loader opens over a host page. Served from the platform, so the host page holds no secret
 * and reaches the conversation only through `postMessage`; the proxy lets only the
 * deployment's allowed origins frame it.
 */

export const instant = false;

/**
 * Renders the widget frame for an enabled deployment, in Arabic when `?lang=ar` and English
 * otherwise, passing on `page`, `host` and `preview=1`; a deployment that is not enabled gets a
 * one-line "not available" notice instead.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
  const config = await publicConfig(code);
  const lang = one("lang") === "ar" ? "ar" : "en";
  if (!config) {
    return (
      <main className="awp-wf-off" dir={lang === "ar" ? "rtl" : "ltr"}>
        {lang === "ar" ? "هذا المساعد غير متاح." : "This assistant is not available."}
      </main>
    );
  }
  return <WidgetFrame config={config} lang={lang} page={one("page")} host={one("host")} preview={one("preview") === "1"} />;
}
