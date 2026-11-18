"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The Juman brand mark, English and Arabic, as handoff v2 supplies it.
 *
 * The two markup strings are the artwork itself — the rule is to use the logo exactly as
 * given, no fill changes and no restyling — so they are inserted as they are rather than
 * retyped as JSX, where a renamed attribute would be a silent edit to someone's logo. They
 * are build-time constants in this file; nothing from outside reaches them.
 *
 * The viewBox is fitted after the fonts load. The wordmark is live text in the platform
 * font, so its width is not known until that font is resolved: drawn against the nominal
 * 520-unit box it is clipped in one language and padded in the other.
 */
const JUMAN_SVG: Record<"en" | "ar", string> = {
  en: "<svg class=\"jm-en\" role=\"img\" aria-label=\"Juman Platform\" xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 520 150\"><style>.jm-en .st7{font-size:54px}.jm-en .st5{font-weight:900}.jm-en .st4{font-weight:400}.jm-en .st6{font-size:31px;fill:var(--text-secondary)}.jm-en .st0{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR);stroke-width:5;stroke-linejoin:round}.jm-en .st1{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR1);stroke-width:5;stroke-linejoin:round}.jm-en .st2{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR2);stroke-width:5;stroke-linejoin:round}.jm-en .st3{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR3);stroke-width:5;stroke-linejoin:round}.jm-en text{font-family:var(--font),var(--font-family-primary),sans-serif;fill:var(--text-primary)}</style><defs><linearGradient id=\"TAHSEEL_MAIN_COLOR\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"98.27\" y1=\"67.7\" x2=\"133.31\" y2=\"7.02\" gradientUnits=\"userSpaceOnUse\"><stop offset=\".25\" stop-color=\"#0677ff\"></stop><stop offset=\".61\" stop-color=\"#0675fc\"></stop><stop offset=\".76\" stop-color=\"#066ef5\"></stop><stop offset=\".87\" stop-color=\"#0662e9\"></stop><stop offset=\".96\" stop-color=\"#0751d7\"></stop><stop offset=\"1\" stop-color=\"#0848ce\"></stop></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR1\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"98.26\" y1=\"142.95\" x2=\"133.02\" y2=\"82.74\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR2\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"22.92\" y1=\"67.35\" x2=\"57.73\" y2=\"7.05\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR3\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"22.69\" y1=\"143\" x2=\"57.71\" y2=\"82.35\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient></defs><text class=\"st7\" transform=\"translate(176.98 67.11)\"><tspan class=\"st5\" x=\"0\" y=\"0\">Juman</tspan><tspan class=\"st4\" xml:space=\"preserve\"> Platform</tspan></text><text class=\"st6\" transform=\"translate(176.98 116.01)\"><tspan x=\"0\" y=\"0\">Autonomous AI Agents</tspan></text><g><path class=\"st0\" d=\"M93.77,13.71c12.95-12.16,33.31-11.52,45.47,1.44,12.16,12.95,11.52,33.31-1.44,45.47l.05.05c-4.68,4.68-11.11,6.54-17.18,5.58l-28.32-5.58-5.58-28.32c-.96-6.07.9-12.5,5.58-17.18l1.41-1.46Z\"></path><path class=\"st1\" d=\"M139.29,90.82c12.16,12.95,11.52,33.31-1.44,45.47-12.95,12.16-33.31,11.52-45.47-1.44l-.05.05c-4.68-4.68-6.54-11.11-5.58-17.18l5.58-28.32,28.32-5.58c6.07-.96,12.5.9,17.18,5.58l1.46,1.41Z\"></path><path class=\"st3\" d=\"M62.18,13.71C49.23,1.56,28.87,2.2,16.71,15.15c-12.16,12.95-11.52,33.31,1.44,45.47l-.05.05c4.68,4.68,11.11,6.54,17.18,5.58l28.32-5.58,5.58-28.32c.96-6.07-.9-12.5-5.58-17.18l-1.41-1.46Z\"></path><path class=\"st2\" d=\"M16.71,90.82c-12.16,12.95-11.52,33.31,1.44,45.47,12.95,12.16,33.31,11.52,45.47-1.44l.05.05c4.68-4.68,6.54-11.11,5.58-17.18l-5.58-28.32-28.32-5.58c-6.07-.96-12.5.9-17.18,5.58l-1.46,1.41Z\"></path></g></svg>",
  ar: "<svg class=\"jm-ar\" role=\"img\" aria-label=\"منصة جمان\" xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 520 150\"><style>.jm-ar .st4{font-size:54px;font-weight:400}.jm-ar .st5{font-size:31px;fill:var(--text-secondary)}.jm-ar .jm-b{font-size:54px;font-weight:900}.jm-ar .st0{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR);stroke-width:5;stroke-linejoin:round}.jm-ar .st1{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR1);stroke-width:5;stroke-linejoin:round}.jm-ar .st2{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR2);stroke-width:5;stroke-linejoin:round}.jm-ar .st3{fill:none;stroke:url(#TAHSEEL_MAIN_COLOR3);stroke-width:5;stroke-linejoin:round}.jm-ar text{font-family:var(--font),var(--font-family-primary),sans-serif;fill:var(--text-primary)}</style><defs><linearGradient id=\"TAHSEEL_MAIN_COLOR\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"451.56\" y1=\"36.77\" x2=\"518.32\" y2=\"36.77\" gradientUnits=\"userSpaceOnUse\"><stop offset=\".25\" stop-color=\"#0677ff\"></stop><stop offset=\".61\" stop-color=\"#0675fc\"></stop><stop offset=\".76\" stop-color=\"#066ef5\"></stop><stop offset=\".87\" stop-color=\"#0662e9\"></stop><stop offset=\".96\" stop-color=\"#0751d7\"></stop><stop offset=\"1\" stop-color=\"#0848ce\"></stop></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR1\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"56.69\" y1=\"11709.6\" x2=\"123.45\" y2=\"11709.6\" gradientTransform=\"translate(15033.7358 23.2006) rotate(90)\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR2\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"10432\" y1=\"36.77\" x2=\"14493.26\" y2=\"36.77\" gradientTransform=\"translate(14868.3855) scale(-1 1)\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient><linearGradient id=\"TAHSEEL_MAIN_COLOR3\" data-name=\"TAHSEEL MAIN COLOR\" x1=\"56.69\" y1=\"573.84\" x2=\"123.45\" y2=\"573.84\" gradientTransform=\"translate(-165.35 23.2) rotate(90) scale(1 -1)\" xlink:href=\"#TAHSEEL_MAIN_COLOR\"></linearGradient></defs><path class=\"st1\" d=\"M461.48,14.75c12.94-12.15,33.29-11.51,45.44,1.44,12.15,12.94,11.51,33.29-1.44,45.44l.05.05c-4.67,4.67-11.1,6.53-17.17,5.57l-28.3-5.57-5.57-28.3c-.96-6.07.9-12.49,5.57-17.17l1.41-1.46Z\"></path><path class=\"st3\" d=\"M506.97,89.81c12.15,12.94,11.51,33.29-1.44,45.44-12.94,12.15-33.29,11.51-45.44-1.44l-.05.05c-4.67-4.67-6.53-11.1-5.57-17.17l5.57-28.3,28.3-5.57c6.07-.96,12.49.9,17.17,5.57l1.46,1.41Z\"></path><g><path class=\"st0\" d=\"M431.96,14.75c-12.94-12.15-33.29-11.51-45.44,1.44-12.15,12.94-11.51,33.29,1.44,45.44l-.05.05c4.67,4.67,11.1,6.53,17.17,5.57l28.3-5.57,5.57-28.3c.96-6.07-.9-12.49-5.57-17.17l-1.41-1.46Z\"></path><path class=\"st2\" d=\"M386.47,89.81c-12.15,12.94-11.51,33.29,1.44,45.44,12.94,12.15,33.29,11.51,45.44-1.44l.05.05c4.67-4.67,6.53-11.1,5.57-17.17l-5.57-28.3-28.3-5.57c-6.07-.96-12.49.9-17.17,5.57l-1.46,1.41Z\"></path></g><text class=\"st4\" direction=\"rtl\" text-anchor=\"start\" transform=\"translate(343.02 68.19)\">منصة <tspan class=\"jm-b\">جمان</tspan></text><text class=\"st5\" direction=\"rtl\" text-anchor=\"start\" transform=\"translate(343.02 117.96)\"><tspan x=\"0\" y=\"0\">للذكاء الاصطناعي المستقل</tspan></text></svg>",
};

/**
 * The mark in `lang` (Arabic for `ar`, English otherwise), `h` pixels high. After layout and
 * again once fonts are ready, the viewBox is widened to the drawn bounds and the width follows it.
 */
export function JumanLogo({ lang, h = 40 }: { lang: string; h?: number }) {
  const host = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<[x: number, width: number]>([0, 520]);
  useLayoutEffect(() => {
    const fit = () => {
      const svg = host.current?.querySelector("svg");
      if (!svg) return;
      svg.setAttribute("viewBox", "0 0 520 150");
      try {
        const bounds = svg.getBBox();
        const left = Math.min(0, Math.floor(bounds.x));
        const right = Math.max(520, Math.ceil(bounds.x + bounds.width));
        svg.setAttribute("viewBox", `${left} 0 ${right - left} 150`);
        setBox([left, right - left]);
      } catch {
        // getBBox throws on a detached or hidden tree; the nominal box is then correct.
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [lang]);
  return (
    <span
      ref={host}
      className="awp-juman-logo"
      style={{ display: "block", height: h, width: (h * box[1]) / 150, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: JUMAN_SVG[lang === "ar" ? "ar" : "en"] }}
    />
  );
}

/**
 * D388: the same mark as an image, for a printed report's letterhead. Chromium leaves out SVG
 * text set in a web font when it repeats a header on every printed page; an image is repeated
 * whole. An image cannot read the page's CSS variables or fonts, so those two are resolved to the
 * values the light theme gives them, and the box is widened for a fallback font's wider wordmark.
 */
export function jumanLogoImage(lang: string): string {
  const svg = JUMAN_SVG[lang === "ar" ? "ar" : "en"]
    .replaceAll("var(--text-primary)", "#323c50")
    .replaceAll("var(--text-secondary)", "#656d7c")
    .replaceAll("var(--font),var(--font-family-primary),sans-serif", "'Avenir Next','Segoe UI',Tahoma,Arial,sans-serif")
    .replace('viewBox="0 0 520 150"', lang === "ar" ? 'viewBox="-80 0 600 150"' : 'viewBox="0 0 600 150"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
