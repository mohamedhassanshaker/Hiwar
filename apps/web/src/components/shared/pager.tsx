"use client";

import { useState, type ReactNode } from "react";

import { Btn } from "@/components/ui/button";
import { useAwp } from "@/hooks/use-awp";

/** How many rows a table shows on one page. */
export const PAGE_SIZE = 25;

/**
 * One page of a list the screen already holds, and the control that moves between pages.
 *
 * The page is clamped to the list as it stands, so a filter that shortens the list never
 * leaves the reader on a page past its end.
 */
export function usePaging<T>(rows: T[], size: number = PAGE_SIZE): { shown: T[]; pager: ReactNode } {
  const [requested, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const page = Math.min(requested, last);
  return {
    shown: rows.slice(page * size, page * size + size),
    pager: <Pager page={page} last={last} total={rows.length} size={size} onPage={setPage} />,
  };
}

/** "26–50 of 312" with Previous and Next. Nothing when everything fits on one page. */
export function Pager({
  page,
  last,
  total,
  size,
  onPage,
}: {
  page: number;
  last: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
}) {
  const { t } = useAwp();
  if (last === 0) return null;
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  return (
    // `awp-fab-clear` keeps Next out from under the AI Assistant button on a phone or a tablet (D169).
    <nav
      className="awp-row awp-pager awp-fab-clear"
      aria-label={t("Pages", "الصفحات")}
      style={{ justifyContent: "space-between", gap: 12, paddingBlock: 10, paddingInlineStart: 16, borderTop: "1px solid var(--border-divider)", flexWrap: "wrap" }}
    >
      <span className="awp-small awp-muted" role="status">
        {t(`${from}–${to} of ${total}`, `${from}–${to} من ${total}`)}
      </span>
      <span className="awp-row" style={{ gap: 8 }}>
        <span className="awp-small awp-muted">{t(`Page ${page + 1} of ${last + 1}`, `صفحة ${page + 1} من ${last + 1}`)}</span>
        <Btn type="secondary" label={t("Previous", "السابق")} disabled={page === 0} onClick={() => onPage(page - 1)} />
        <Btn type="secondary" label={t("Next", "التالي")} disabled={page === last} onClick={() => onPage(page + 1)} />
      </span>
    </nav>
  );
}
