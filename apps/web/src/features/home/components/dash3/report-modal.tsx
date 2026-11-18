"use client";

import { useEffect, useRef, useState } from "react";

import { useAwp } from "@/hooks/use-awp";
import { Ic } from "@/components/ui/icon";
import { buildReport } from "@/features/home/actions";
import { REPORT_NAME_MAX } from "@/features/home/schema";
import type { Report } from "@/features/home/service";
import { CARD_IDS, CARD_NAMES, type CardId } from "./cards";
import { CheckMark } from "./filter-menu";
import { boundsOf, isoDay, PRESETS, rangeLabel, type Range } from "./range";

/**
 * "Create report" (handoff v2 section 3).
 *
 * The rows come from the server, where the export permission is checked, the money
 * sections are gated by the same rule the cards use and the whole thing is audited. This
 * chooses the name, the period, the sections and the format, and then turns what comes
 * back into a file or a printable page.
 */

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] as string);

/** A UTF-8 BOM, so Excel opens the Arabic rows as Arabic rather than as mojibake. */
const BOM = "﻿";

/** Saves the report's rows, under `headings`, as a UTF-8 CSV file named `filename`. */
function downloadCsv(report: Report, headings: string[], filename: string) {
  const csv = BOM + [headings, ...report.rows].map((row) => row.map(quote).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The print-ready page, opened in a new window.
 *
 * `print()` is called from here rather than from a script written into that window: the
 * console's content policy has no place for an inline script, and the opener can drive
 * the window it just opened.
 */
function openPrintable(report: Report, rtl: boolean, generated: string) {
  const sheet = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#323C50;margin:40px;max-width:760px}
h1{font-size:24px;margin:0 0 4px}
p{color:#656D7C;margin:0 0 24px;font-size:13px}
h2{font-size:15px;margin:24px 0 8px;color:#0848CE}
table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:8px 0;border-bottom:1px solid #E7EDFB}
td:last-child{text-align:end;font-weight:600}`;
  let body = "";
  let section: string | null = null;
  for (const [heading, item, value] of report.rows) {
    if (heading !== section) {
      if (section !== null) body += "</tbody></table>";
      body += `<h2>${escapeHtml(heading)}</h2><table><tbody>`;
      section = heading;
    }
    body += `<tr><td>${escapeHtml(item)}</td><td>${escapeHtml(value)}</td></tr>`;
  }
  if (section !== null) body += "</tbody></table>";

  const window_ = window.open("", "_blank");
  if (!window_) return false;
  window_.document.write(
    `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>${sheet}</style></head><body><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.period)} · ${escapeHtml(generated)}</p>${body}</body></html>`,
  );
  window_.document.close();
  // A tick, so the document it was just handed has been laid out before it is printed.
  setTimeout(() => window_.print(), 300);
  return true;
}

/**
 * Mounted only while it is open, so the form starts from the dashboard's current range
 * and cards every time it is opened without an effect that resets it afterwards.
 */
export function ReportModal({
  onClose,
  range,
  hidden,
}: {
  onClose: () => void;
  /** The dashboard's own range, which the report starts on. */
  range: Range;
  /** The cards on the dashboard, which the sections start as. */
  hidden: CardId[];
}) {
  const { t, lang } = useAwp();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";
  const [name, setName] = useState(
    () => `${t("Dashboard report", "تقرير اللوحة")} – ${new Date().toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`,
  );
  const [period, setPeriod] = useState<Range>(range);
  const [sections, setSections] = useState<CardId[]>(() => CARD_IDS.filter((id) => !hidden.includes(id)));
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: CardId) => setSections(sections.includes(id) ? sections.filter((one) => one !== id) : [...sections, id]);
  const all = sections.length === CARD_IDS.length;

  const generate = async () => {
    if (name.trim().length > REPORT_NAME_MAX) {
      setProblem(t(`A report name has at most ${REPORT_NAME_MAX} characters.`, `يتكوّن اسم التقرير من ${REPORT_NAME_MAX} حرفاً على الأكثر.`));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const bounds = boundsOf(period);
      const report = await buildReport({
        name: name.trim() || t("Dashboard report", "تقرير اللوحة"),
        from: isoDay(bounds.from),
        to: isoDay(bounds.to),
        sections,
        format,
        lang,
      });
      if (format === "csv") {
        const headings = [t("Section", "القسم"), t("Item", "البند"), t("Value", "القيمة")];
        const filename = `${report.title.replace(/[^\w؀-ۿ\- ]+/g, "").trim() || "report"}.csv`;
        downloadCsv(report, headings, filename);
        setDone(t("Report downloaded.", "تم تنزيل التقرير."));
      } else {
        const generated = `${t("Generated", "أُنشئ")} ${new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}`;
        const opened = openPrintable(report, lang === "ar", generated);
        setDone(
          opened
            ? t("Report ready to save as PDF.", "التقرير جاهز للحفظ بصيغة PDF.")
            : t("Allow pop-up windows to open the report.", "اسمح بالنوافذ المنبثقة لفتح التقرير."),
        );
      }
    } catch {
      // The server refuses an export this person may not take; the modal says so rather
      // than closing as though a file had been produced.
      setProblem(t("The report could not be produced.", "تعذّر إنشاء التقرير."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d3-modal-wrap" role="presentation">
      <div className="d3-modal-scrim" onClick={onClose} />
      <div className="d3-modal" role="dialog" aria-modal="true" aria-labelledby="d3-report-title">
        <div className="d3-ch">
          <h3 id="d3-report-title">{t("Create report", "إنشاء تقرير")}</h3>
          <button className="d3-ibtn" onClick={onClose} aria-label={t("Close", "إغلاق")}>
            <Ic n="Cancel01" s={16} />
          </button>
        </div>
        <label className="d3-fld">
          <span>{t("Report name", "اسم التقرير")}</span>
          <input ref={nameField} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="d3-fld">
          <span>{t("Period", "الفترة")}</span>
          <div className="d3-seg" role="radiogroup" aria-label={t("Period", "الفترة")}>
            {PRESETS.map((id) => (
              <button key={id} role="radio" aria-checked={period.id === id} className={period.id === id ? "on" : ""} onClick={() => setPeriod({ id })}>
                {rangeLabel({ id }, t, locale)}
              </button>
            ))}
            {range.id === "custom" && (
              <button role="radio" aria-checked={period.id === "custom"} className={period.id === "custom" ? "on" : ""} onClick={() => setPeriod(range)}>
                {rangeLabel(range, t, locale)}
              </button>
            )}
          </div>
        </div>
        <div className="d3-fld">
          <span className="d3-row">
            {t("Include", "يتضمن")}
            <button className="d3-link" onClick={() => setSections(all ? [] : [...CARD_IDS])}>
              {all ? t("Clear all", "إلغاء الكل") : t("Select all", "تحديد الكل")}
            </button>
          </span>
          <div className="d3-rep-secs">
            {CARD_IDS.map((id) => {
              const on = sections.includes(id);
              return (
                <label key={id} className={"d3-flt-o" + (on ? " on" : "")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                  <span className="d3-flt-box" aria-hidden="true">
                    {on && <CheckMark />}
                  </span>
                  <span>{t(...CARD_NAMES[id])}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="d3-fld">
          <span>{t("Format", "الصيغة")}</span>
          <div className="d3-seg" role="radiogroup" aria-label={t("Format", "الصيغة")}>
            <button role="radio" aria-checked={format === "pdf"} className={format === "pdf" ? "on" : ""} onClick={() => setFormat("pdf")}>
              PDF
            </button>
            <button role="radio" aria-checked={format === "csv"} className={format === "csv" ? "on" : ""} onClick={() => setFormat("csv")}>
              {t("CSV (Excel)", "CSV (إكسل)")}
            </button>
          </div>
        </div>
        {done && (
          <p className="d3-sub" role="status">
            {done}
          </p>
        )}
        {problem && (
          <p className="d3-sub" role="alert" style={{ color: "var(--text-danger)" }}>
            {problem}
          </p>
        )}
        <div className="d3-modal-f">
          <button className="d3-pill" onClick={onClose}>
            {done ? t("Close", "إغلاق") : t("Cancel", "إلغاء")}
          </button>
          <button className="d3t-next" disabled={sections.length === 0 || busy} onClick={() => void generate()}>
            {busy ? t("Preparing…", "جارٍ التحضير…") : t("Generate report", "إنشاء التقرير")}
          </button>
        </div>
      </div>
    </div>
  );
}
