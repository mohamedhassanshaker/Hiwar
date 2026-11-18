"use client";

import { useEffect, useState } from "react";

import { Ic } from "@/components/ui/icon";
import { searchHeld } from "@/features/files/actions";
import type { HeldItem } from "@/features/files/service";
import { useAwp } from "@/hooks/use-awp";

/**
 * `UC-25.1-03`: the files or the artifacts this person may read, searched on the server as
 * they type. The list comes back already narrowed to their projects and, for files, to the
 * scope of use, so nothing they may not read reaches the browser.
 */
export function HeldPicker({
  kind,
  picked,
  onPick,
}: {
  kind: "File" | "Artifact";
  /** The ids chosen so far: one for a single attachment, several for a form. */
  picked: string[];
  onPick: (item: HeldItem) => void;
}) {
  const { t, why } = useAwp();
  const [query, setQuery] = useState("");
  const [held, setHeld] = useState<HeldItem[]>([]);
  const [searching, setSearching] = useState(true);
  const [refusal, setRefusal] = useState<object | null>(null);

  // A moment after the person stops typing, rather than once per key.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      const outcome = await searchHeld({ kind, q: query });
      if (!current) return;
      setSearching(false);
      setRefusal(outcome.ok ? null : outcome);
      setHeld(outcome.ok ? outcome.value : []);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [kind, query]);

  const label = kind === "File" ? t("Search files", "ابحث في الملفات") : t("Search artifacts", "ابحث في المخرجات");
  return (
    <div className="awp-col" style={{ gap: 8 }}>
      <input
        className="awp-input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
      <div className="awp-col" role="radiogroup" aria-label={label} style={{ gap: 8, maxHeight: 280, overflow: "auto" }}>
        {held.map((item) => (
          <button
            type="button"
            key={item.id}
            role="radio"
            aria-checked={picked.includes(item.id)}
            className="awp-card"
            style={{ width: "100%", padding: 10, textAlign: "start", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}
            onClick={() => onPick(item)}
          >
            <Ic n="File01" c="var(--icon-brand)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
              <div className="awp-small awp-muted">{item.project}</div>
            </div>
            {picked.includes(item.id) && <Ic n="TickCircleL" c="var(--icon-brand)" />}
          </button>
        ))}
        {searching && held.length === 0 && (
          <p className="awp-small awp-muted" style={{ margin: 0 }}>
            {t("Searching…", "جارٍ البحث…")}
          </p>
        )}
        {!searching && held.length === 0 && refusal === null && (
          <p className="awp-small awp-muted" style={{ margin: 0 }}>
            {kind === "File"
              ? t("No file you may read matches.", "لا يوجد ملف يمكنك قراءته يطابق.")
              : t("No artifact you may read matches.", "لا يوجد مخرج يمكنك قراءته يطابق.")}
          </p>
        )}
        {refusal !== null && (
          <p className="awp-small" role="alert" style={{ margin: 0, color: "var(--text-danger)" }}>
            {why(refusal)}
          </p>
        )}
      </div>
    </div>
  );
}
