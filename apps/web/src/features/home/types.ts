import type { Session } from "@/features/rooms/types";

/** The dashboard (S-10) and its drill-downs (S-11). */

export type RecordRow = (string | number | null)[];

/** One drill-down list. `kind` is the key the dashboard KPI links to. */
export type RecordSet = {
  kind: string;
  title: [string, string];
  sub: [string, string];
  cols: string[];
  /** One page of the rows that match the filters (D349). */
  rows: RecordRow[];
  /** How many rows match the filters. */
  total: number;
  /** The statuses the status filter offers. */
  statuses: string[];
  /** `UC-11.1-05`: whether this person may take the list out of the platform. */
  mayExport: boolean;
};

/** The set as the read model produces it, before the screen's permissions are applied. */
export type RecordSetRows = Omit<RecordSet, "mayExport">;

/** A run on the dashboard's "Runs in progress" card. */
export type DashboardRun = {
  key: string;
  agent: string;
  goalEn: string;
  goalAr: string;
  step: number;
  steps: number;
  cost: number;
  waiting: boolean;
  failed: boolean;
};

/** How wide one point of a chart is (handoff v2 section 2.3). */
export type BucketUnit = "day" | "week" | "month" | "quarter";

/** One point of a chart: when the period starts, and what fell in it. */
export type Bucket = { start: string; count: number };

/**
 * The charts of Dashboard 3 for one range, which the range menus re-read on their own
 * rather than reloading the whole page.
 */
export type DashboardSeries = {
  /** ISO-8601, inclusive at both ends. */
  from: string;
  to: string;
  unit: BucketUnit;
  /** The organisation's time zone, whose days the buckets are (D365), so labels name them alike everywhere. */
  zone: string;
  runs: Bucket[];
  finished: Bucket[];
  /** The same span immediately before, so "14 more than last week" is a real comparison. */
  finishedPrevious: number;
  outcomes: { completed: number; waiting: number; failed: number };
};

export type DashboardData = {
  organisationEn: string;
  organisationAr: string;
  openWorkItems: { total: number; openedToday: number; byStatus: { status: string; count: number }[] };
  runs: { inProgress: number; waitingOnPeople: number; rows: DashboardRun[] };
  approvals: { waiting: number; highRisk: number };
  agentsInError: { count: number; label: string | null };
  cost: { today: number; month: number; limit: number; topAgentEn: string | null; topAgentAr: string | null };
  slaAtRisk: number;
  rooms: Session[];
  /** `UC-10.1-05`: whether this person may see what the platform spends. */
  showCost: boolean;
  /** `UC-10.1-06`: nothing has been put into the platform yet. */
  empty: boolean;

  /**
   * The share of finished runs that needed nobody, over the last eight weeks: the
   * sparkline, and the chip is the difference between its first and last point.
   */
  automation: number[];
  /** This month's estimated cost split between the models and the tools and connectors. */
  costSplit: { models: number; tools: number };
  /** The default range Dashboard 3 opens on: the last 7 days. */
  series: DashboardSeries;
};

/** S-02: the eight kinds the search palette groups its results under, in order. */
export type SearchKind =
  | "room"
  | "workItem"
  | "request"
  | "agent"
  | "skill"
  | "connector"
  | "knowledge"
  | "artifact";

/** One row of the palette: a record the signed-in person may open. */
export type SearchHit = {
  kind: SearchKind;
  /** The key or code the record is known by, shown in the row's leading column. */
  code: string;
  nameEn: string;
  nameAr: string;
  /** Where selecting the row goes, as a screen id of `src/lib/routes.ts`. */
  screen: string;
  params?: Record<string, string>;
};

/** A group of hits of one kind, with the heading the palette draws above them. */
export type SearchGroup = {
  kind: SearchKind;
  headingEn: string;
  headingAr: string;
  hits: SearchHit[];
};
