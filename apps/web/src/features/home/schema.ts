import { z } from "zod";

import { CARD_IDS } from "./report-sections";

/** Requirement 32: the dashboard action inputs. */

export const exportRecordsInput = z.object({
  kind: z.enum(["open", "runs", "approvals", "agentsErr", "cost", "sla"]),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  // `UC-11.1-05`: the file holds the filtered rows, so what was asked for travels with it.
  term: z.string().trim().max(64).optional(),
  project: z.string().trim().max(32).optional(),
  status: z.string().trim().max(32).optional(),
});

/**
 * The range a chart is read over (handoff v2 section 2.3).
 *
 * Whole days, because that is what the range menus offer and what the buckets are cut on.
 * The earliest is 1 January 2025, the same floor the calendar refuses to go below.
 */
export const seriesInput = z
  .object({ from: z.string().date(), to: z.string().date() })
  .refine((range) => range.from <= range.to, { message: "The range ends before it starts." })
  .refine((range) => range.from >= "2025-01-01", { message: "The earliest date is 1 January 2025." });

/**
 * A dashboard report (handoff v2 section 3).
 *
 * The sections are the nine cards; the rows are built on the server from the same read
 * model the cards drew, so what leaves the platform is what the person was looking at and
 * not what a browser assembled.
 */
/** S-10: the longest report name, which the report dialog checks before asking the server. */
export const REPORT_NAME_MAX = 120;

/** S-02: the longest term the search palette sends. */
export const SEARCH_TERM_MAX = 64;

export const reportInput = z.object({
  name: z.string().trim().min(1).max(REPORT_NAME_MAX),
  from: z.string().date(),
  to: z.string().date(),
  sections: z.array(z.enum(CARD_IDS)).min(1),
  format: z.enum(["pdf", "csv"]),
  /** The report reads in the language the console was in when it was asked for. */
  lang: z.enum(["en", "ar"]),
});

/** S-02: one search term. Longer than 64 characters is a paste, not a search. */
export const searchInput = z.object({ term: z.string().trim().max(SEARCH_TERM_MAX) });

export type ExportRecordsInput = z.infer<typeof exportRecordsInput>;
export type SeriesInput = z.infer<typeof seriesInput>;
export type ReportInput = z.infer<typeof reportInput>;
export type SearchInput = z.infer<typeof searchInput>;
