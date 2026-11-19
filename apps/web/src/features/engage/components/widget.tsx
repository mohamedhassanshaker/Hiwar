"use client";

import { useState } from "react";

import { LogoMark } from "@/components/brand";
import { Btn } from "@/components/ui/button";
import type { Deployment } from "@/features/engage/types";
import { useAwp } from "@/hooks/use-awp";

/**
 * S-65: the embedded widget, as a visitor sees it.
 *
 * The preview is the product: it is the same frame a host page embeds, talking to the same
 * `/embed/v1` API, so what it says is what the published storylines say. It runs as the
 * designer (`preview=1`), which skips the origin check and shows the one-time code that a
 * preview has nowhere to deliver.
 */
export function Widget({ deployment, embedSnippet }: { deployment: Deployment; embedSnippet: string }) {
  const { t, lang } = useAwp();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);
  // A new key restarts the frame, and so the preview conversation, from the start.
  const [round, setRound] = useState(0);

  return (
    <div className="awp-col" style={{ gap: 16 }}>
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 12 }}>
        <span className="awp-muted" style={{ flex: 1 }}>
          {t("Preview as a visitor sees it, against the published storylines.", "معاينة كما يراها الزائر، وفق السيناريوهات المنشورة.")}
        </span>
        <Btn type="secondary" label={t("Restart preview", "إعادة المعاينة")} onClick={() => setRound(round + 1)} />
        <Btn
          type="secondary"
          label={copied ? t("Copied", "تم النسخ") : t("Copy embed code", "نسخ كود التضمين")}
          icon="Copy01"
          onClick={() => {
            void navigator.clipboard.writeText(embedSnippet);
            setCopied(true);
          }}
        />
      </div>
      <pre className="awp-mono awp-small awp-muted" style={{ margin: 0, overflowX: "auto", padding: 8 }}>
        {embedSnippet}
      </pre>

      <div style={{ position: "relative", borderRadius: 20, border: "1px solid var(--border-divider)", background: "var(--surface-card)", minHeight: 720, overflow: "hidden" }}>
        <div style={{ height: 64, borderBottom: "1px solid var(--border-divider)", background: "var(--surface-raised)", display: "flex", alignItems: "center", padding: "0 24px", gap: 12 }}>
          <LogoMark size={32} />
          <span style={{ flex: 1 }} />
          <span className="awp-muted awp-small">{t("Host website (placeholder)", "الموقع المضيف (عنصر نائب)")}</span>
        </div>
        <div style={{ padding: 32, display: "grid", gap: 16, maxWidth: 520 }}>
          {[80, 60, 70, 45].map((width, index) => (
            <div key={width} style={{ height: index ? 14 : 28, width: `${width}%`, borderRadius: 8, background: "var(--surface-sunken)" }} />
          ))}
        </div>
        {open && (
          <iframe
            key={`${round}:${lang}`}
            title={t(`${deployment.n} preview`, `معاينة ${deployment.nAr || deployment.n}`)}
            src={`/embed/v1/frame/${encodeURIComponent(deployment.id)}?preview=1&lang=${lang}`}
            allow="microphone; clipboard-write"
            style={{ position: "absolute", bottom: 92, insetInlineEnd: 24, width: "min(400px,calc(100% - 48px))", height: 600, border: 0, borderRadius: 24, boxShadow: "0 16px 48px var(--elevation-shadow-md)", background: "transparent" }}
          />
        )}
        <button
          type="button"
          className="awp-wf-launcher"
          aria-label={open ? t("Close the assistant", "إغلاق المساعد") : t("Open the assistant", "فتح المساعد")}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={{ position: "absolute", bottom: 20, insetInlineEnd: 24, width: 60, height: 60, borderRadius: "50%", border: 0, cursor: "pointer", background: deployment.accentColour ?? "var(--action-primary-bg)", color: "#fff", fontSize: 22 }}
        >
          <span aria-hidden="true">{open ? "✕" : "✦"}</span>
        </button>
      </div>
    </div>
  );
}
