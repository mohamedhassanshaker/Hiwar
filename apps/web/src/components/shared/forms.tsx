"use client";

import { useEffect, useState } from "react";

import { useProjects } from "@/components/shared/directory";
import { Field } from "@/components/ui/field";
import { Ic } from "@/components/ui/icon";
import { Lnk } from "@/components/ui/button";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/** `projOpts()` in the prototype. */
export function useProjOpts(): () => [string, string][] {
  const { t } = useAwp();
  const projects = useProjects();
  return () => [["any", t("All projects", "كل المشاريع")], ...projects.map((p) => [p.k, p.k + " — " + t(p.n, p.nAr)] as [string, string])];
}

/**
 * A dashed file picker that shows the chosen file's name. It keeps the name only; the file is
 * not read or uploaded.
 */
export function DropZone({ text }: { text?: string }) {
  const { t } = useAwp();
  const [f, setF] = useState<string | null>(null);
  return (
    <label
      style={{ border: "2px dashed var(--border-divider)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", background: "var(--surface-card)" }}
    >
      <Ic n="Download04" s={28} c="var(--icon-brand)" />
      <b>{f || text || t("Drop a file here or browse", "أفلت ملفاً هنا أو تصفح")}</b>
      <input type="file" style={{ display: "none" }} onChange={(e) => setF(e.target.files?.[0] ? e.target.files[0].name : null)} />
    </label>
  );
}

/**
 * A select over the directory's projects, by key. Controlled when `onChange` is given,
 * otherwise uncontrolled with `value` as its initial choice.
 */
export function ProjectSelect({ value, onChange }: { value?: string; onChange?: (key: string) => void }) {
  const { t } = useAwp();
  const projects = useProjects();
  return (
    <PopSelect
      className="awp-input"
      {...(onChange ? { value: value ?? "", onChange: (event) => onChange(event.target.value) } : { defaultValue: value })}
    >
      {projects.map((p) => (
        <option key={p.k} value={p.k}>
          {p.k} — {t(p.n, p.nAr)}
        </option>
      ))}
    </PopSelect>
  );
}

/**
 * A lower-case, dash-separated code from a name, at most 40 characters. Only ASCII letters,
 * digits, spaces and dashes survive, so accents are dropped and Arabic yields nothing.
 */
export const slug = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);

/**
 * An upper-case key from a name: the initials of its Latin-letter words, or the first three
 * letters of a single word, at most 4 characters.
 */
export const keyOf = (s: string) => {
  const w = (s || "")
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (w.length > 1 ? w.map((x) => x[0]).join("") : (w[0] || "").slice(0, 3)).toUpperCase().slice(0, 4);
};

/**
 * `COM-13`: a code field suggested from the name, which the writer may override.
 *
 * `onChange` reports the effective value — the suggestion while it stands, the override
 * once there is one — so a form that submits a code can read it. Without it the field can
 * only be decorative, which is why it is part of the primitive rather than something each
 * form reimplements.
 */
export function CodeField({
  label,
  from,
  mode = "slug",
  prefix = "",
  onChange,
}: {
  label?: string;
  from?: string;
  mode?: "slug" | "key";
  prefix?: string;
  onChange?: (code: string) => void;
}) {
  const { t } = useAwp();
  const [edited, setEdited] = useState<string | null>(null);
  const sug = from ? prefix + (mode === "key" ? keyOf(from) : slug(from)) : "";
  const v = edited !== null ? edited : sug;

  // The suggestion changes as the name is typed, so the owner is told about that too, not
  // only about a keystroke in this field.
  useEffect(() => {
    onChange?.(v);
  }, [v, onChange]);

  return (
    <Field
      label={label || t("Code", "الرمز")}
      hint={
        edited === null ? (
          sug ? (
            t("Suggested from the name. You can change it.", "مقترح من الاسم. يمكنك تغييره.")
          ) : (
            t("Filled in automatically once you enter a name.", "يُعبأ تلقائياً بعد إدخال الاسم.")
          )
        ) : (
          <Lnk onClick={() => setEdited(null)}>{t("Use suggestion", "استخدام المقترح")}</Lnk>
        )
      }
    >
      <input className="awp-input awp-mono" value={v} onChange={(event) => setEdited(event.target.value)} placeholder={t("auto", "تلقائي")} />
    </Field>
  );
}
