"use client";

import { useRef, useState, useTransition } from "react";

import { removeBrandingAsset, saveBrandingAsset } from "@/features/governance/actions";
import { useAwp } from "@/hooks/use-awp";
import { BRANDING_RULES, type BrandingKind } from "@/lib/branding";

/**
 * `UC-75.2-01`: upload a logo or the favicon. `UC-75.2-02` shows the required size when the
 * file is the wrong one.
 *
 * One control for both kinds, because the only difference between them is the rule, and the
 * rule is already data (`BRANDING_RULES`). The size is checked on the server from the
 * image's own bytes; what this does is carry the file there and show what came back.
 */
export function BrandingUpload({ kind, label, stored }: { kind: BrandingKind; label: string; stored: boolean }) {
  const { t, why } = useAwp();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rule = BRANDING_RULES[kind];
  const requirement = rule.exact
    ? t(`PNG, exactly ${rule.exact.width}×${rule.exact.height}`, `PNG، بمقاس ${rule.exact.width}×${rule.exact.height} بالضبط`)
    : t(`SVG or PNG, at least ${rule.minWidth}×${rule.minHeight}`, `SVG أو PNG، بحد أدنى ${rule.minWidth}×${rule.minHeight}`);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setAccepted(null);

    const reader = new FileReader();
    reader.onerror = () => setProblem(t("That file could not be read.", "تعذّرت قراءة الملف."));
    reader.onload = () =>
      start(async () => {
        const result = await saveBrandingAsset({ kind, dataUrl: String(reader.result) });
        if (result.ok) setAccepted(file.name);
        else setProblem(why(result));
        // Let the same file be chosen again after a rejection.
        if (input.current) input.current.value = "";
      });
    reader.readAsDataURL(file);
  };

  // Back to the platform's own mark (the Juman logo, or the browser's default icon).
  const remove = () =>
    start(async () => {
      setProblem(null);
      setAccepted(null);
      const result = await removeBrandingAsset({ kind });
      if (!result.ok) setProblem(why(result));
    });

  return (
    <div className="awp-col" style={{ gap: 6 }}>
      <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
      <label className="awp-row" style={{ gap: 10 }}>
        <span className="awp-chip" style={{ cursor: pending ? "progress" : "pointer" }}>
          {pending ? t("Uploading…", "جارٍ الرفع…") : label}
        </span>
        <input
          ref={input}
          type="file"
          accept={rule.formats.map((format) => `image/${format}`).join(",")}
          style={{ display: "none" }}
          disabled={pending}
          onChange={(event) => choose(event.target.files?.[0])}
        />
        <span className="awp-small awp-muted">{requirement}</span>
      </label>
      {stored && (
        <button type="button" className="awp-chip" disabled={pending} onClick={remove}>
          {t("Use the default", "استخدام الافتراضي")}
        </button>
      )}
      </div>
      {problem && (
        <span role="alert" className="awp-small" style={{ color: "var(--feedback-danger-text)" }}>
          {problem}
        </span>
      )}
      {accepted && (
        <span role="status" className="awp-small" style={{ color: "var(--feedback-success-text)" }}>
          {t(`${accepted} stored.`, `${accepted} محفوظ.`)}
        </span>
      )}
    </div>
  );
}
