"use client";

import type { CSSProperties, ReactNode } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";
import { Btn } from "@/components/ui/button";
import type { Letterhead } from "@/types/letterhead";
import { useAwp } from "@/hooks/use-awp";
import { formatDay, formatTime } from "@/i18n";

/**
 * A report as a document (D388): a toolbar to print it or save it as PDF with the browser, then
 * the sheet — the organisation's letterhead (logo, name, report title, when and by whom), the
 * report, and a footer. On paper only the sheet prints, on A4 in the given orientation, with the
 * letterhead and footer on every page and the page number in the margin (`dash3.css`). The browser
 * draws the PDF, so Arabic and the console's fonts come out as on screen.
 */
export function ReportFrame({
  letterhead,
  title,
  subject,
  generatedAt,
  orientation = "portrait",
  back,
  children,
}: {
  letterhead: Letterhead;
  title: string;
  /** What the report is about, under its title: a record's key and name, or a count. */
  subject?: string;
  generatedAt: string;
  orientation?: "portrait" | "landscape";
  back?: { label: string; href: string };
  children: ReactNode;
}) {
  const { t, lang } = useAwp();
  const organisation = t(letterhead.organisation.nameEn, letterhead.organisation.nameAr);
  const generated = `${formatDay(lang, new Date(generatedAt))}, ${formatTime(lang, new Date(generatedAt))}`;
  const brand = letterhead.brandColour ? ({ "--report-brand": letterhead.brandColour } as CSSProperties) : undefined;
  return (
    <div className="awp-page">
      <div className="awp-row awp-print-hide" style={{ gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        {back ? (
          <a className="awp-lnk" href={back.href}>
            {back.label}
          </a>
        ) : (
          <span />
        )}
        <Btn label={t("Print or save as PDF", "طباعة أو حفظ PDF")} icon="Download04" onClick={() => window.print()} />
      </div>
      <div className="awp-report-sheet" style={brand}>
        {/* The page size of this report alone; a `@page` rule cannot be scoped any other way. */}
        <style>{`@page{size:A4 ${orientation}}`}</style>
        {/* The letterhead and the footer are the layout table's header and footer rows, which
            the browser repeats on every printed page. */}
        <table className="awp-report-layout" role="presentation">
          <thead>
            <tr>
              <td>
                <header className="awp-report-letterhead">
                  <BrandLogo logos={letterhead.logos} theme="light" lang={lang} h={44} printable alt={organisation || t("Organisation logo", "شعار الجهة")} />
                  <div className="awp-report-org">
                    <span>{organisation}</span>
                    <h1>{title}</h1>
                    {subject && <span>{subject}</span>}
                  </div>
                  <div className="awp-report-stamp">
                    <span>
                      {t("Generated", "أُنشئ")} {generated}
                    </span>
                    <span>
                      {t("Prepared by", "أعدّه")} {t(letterhead.preparedBy.en, letterhead.preparedBy.ar)}
                    </span>
                  </div>
                </header>
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td>
                <footer className="awp-report-footer">
                  <span>
                    {organisation} · {title}
                  </span>
                  <span>{t("Confidential — for internal use", "سري — للاستخدام الداخلي")}</span>
                  <span>{generated}</span>
                </footer>
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
                <article className="awp-report">{children}</article>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One titled part of a report. */
export function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Label and value pairs, two pairs to a row on paper. */
export function ReportFacts({ facts }: { facts: [label: string, value: ReactNode][] }) {
  return (
    <dl className="awp-report-kv">
      {facts.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The filters a report was made with, as chips; `none` when it was made with none. */
export function ReportFilters({ filters, none }: { filters: [label: string, value: string][]; none: string }) {
  const used = filters.filter(([, value]) => value);
  if (used.length === 0) return <p className="awp-report-empty">{none}</p>;
  return (
    <ul className="awp-report-chips">
      {used.map(([label, value]) => (
        <li key={label}>
          {label}: <b>{value}</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * A table of rows under headings; `empty` when there are no rows. The columns named in `noWrap`
 * (keys, codes, dates, statuses) keep their text on one line; `widths` gives a column its share of
 * the page, so one long title cannot squeeze the rest.
 */
export function ReportTable({
  headings,
  rows,
  empty,
  noWrap = [],
  widths = {},
}: {
  headings: string[];
  rows: ReactNode[][];
  empty: string;
  noWrap?: number[];
  widths?: Record<number, string>;
}) {
  if (rows.length === 0) return <p className="awp-report-empty">{empty}</p>;
  return (
    <table className="awp-report-tbl">
      <thead>
        <tr>
          {headings.map((heading, column) => (
            <th key={heading} scope="col" style={widths[column] ? { width: widths[column] } : undefined}>
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, column) => (
              <td key={column} className={noWrap.includes(column) ? "awp-report-nw" : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
