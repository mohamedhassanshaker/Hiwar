import type { SLA_UNITS } from "@/db/schema/enums";

/** Requests and request types (S-27 to S-30). */

/** An SLA interval: `Minutes`, `Hours`, `Days` or `BusinessDays`. */
export type SlaUnit = (typeof SLA_UNITS)[number];

/** How each interval reads in a sentence, singular and plural, in both languages. */
const SLA_UNIT_WORDS: Record<SlaUnit, [en: string, enPlural: string, ar: string]> = {
  Minutes: ["minute", "minutes", "دقيقة"],
  Hours: ["hour", "hours", "ساعة"],
  Days: ["day", "days", "يوم"],
  BusinessDays: ["business day", "business days", "يوم عمل"],
};

/** "30 minutes", "2 business days", or an em dash when the type sets no SLA. */
export function formatSla(value: number | null, unit: SlaUnit | string | null): string {
  if (value === null || unit === null) return "—";
  const words = SLA_UNIT_WORDS[unit as SlaUnit];
  if (!words) return `${value} ${unit}`;
  return `${value} ${value === 1 ? words[0] : words[1]}`;
}

/** The same in Arabic, where the count comes after the noun for one and two. */
export function formatSlaAr(value: number | null, unit: SlaUnit | string | null): string {
  if (value === null || unit === null) return "—";
  const words = SLA_UNIT_WORDS[unit as SlaUnit];
  if (!words) return `${value} ${unit}`;
  return value === 1 ? words[2] : `${value} ${words[2]}`;
}

export type RequestType = {
  c: string;
  n: string;
  nAr: string;
  cat: string;
  v: string;
  st: string;
  ch: string;
  dec: string;
  sla: string;
  open: number;
  /** The default project's key, or "" when the type names none. */
  p: string;
};

export type Request = {
  k: string;
  t: string;
  tAr: string;
  ty: string;
  p: string;
  /** The requester: a person id, or `ext` when the request came from outside. */
  by: string;
  st: string;
  submittedAt: string;
  ch: string;
  mode: string;
};

export type RequestStep = {
  n: string;
  nAr: string;
  isTerminal: boolean;
  /** What a request is left as when it ends here. Meaningless while `isTerminal` is false. */
  terminalOutcome: string;
  /** `UC-30.1-01`: the step's own clock, a count of `slaUnit`. */
  slaValue: number | null;
  slaUnit: SlaUnit | null;
  /** Each audience of the step: its label in both languages, and its access. */
  aud: [en: string, ar: string, access: string][];
  out: [string, string, string][];
};

/** One choice of a list attribute: the value stored on the request and its label in each language. */
export type AttributeOption = { value: string; labelEn: string; labelAr: string };

/** One attribute of a request type version (data model section 6). */
export type AttributeDefinition = {
  key: string;
  labelEn: string;
  labelAr: string;
  dataType: string;
  required: boolean;
  /** A list's choices; null for every other data type. */
  enumValues: AttributeOption[] | null;
  /** The step it is asked at, or null for the request form. */
  stepName: string | null;
};

/** Everything the request type designer shows for one version (S-29). */
export type RequestTypeDetail = {
  code: string;
  /** The version shown, and whether it is the draft, the published one or a retired one. */
  version: number;
  status: string;
  steps: RequestStep[];
  attributes: AttributeDefinition[];
  defaultProject: string | null;
  intakeChannels: string[];
  entryModes: string[];
  decomposition: string;
  slaValue: number | null;
  slaUnit: SlaUnit | null;
};

/** Everything the request detail shows for one request (S-28). */
export type RequestDetail = {
  key: string;
  descEn: string;
  descAr: string;
  steps: RequestStep[];
  currentStep: number;
  attributes: [string, string][];
  /** The attribute definitions of the pinned version, which label the values and say what each step asks. */
  fields: AttributeDefinition[];
  schemaLabel: string;
  dueAt: string | null;
  /** `UC-29.1-06`: the SLA is close enough to its deadline to be worth flagging. */
  slaAtRisk: boolean;
  attachments: [string, string][];
  /** Latest first; `attributes` are the values the action supplied (D314). */
  history: { at: string; who: string; detailEn: string; detailAr: string; attributes: [string, string][] | null }[];
  subRequests: { k: string; t: string; tAr: string; st: string }[];
  workItems: { k: string; t: string; tAr: string; who: string; st: string }[];
  parent: string | null;
};

/** The request list's filters (S-27), each optional; `key` names one request. */
export type RequestFilters = {
  key?: string;
  q?: string;
  projectKey?: string;
  /** A person's id, or `ext` for requests raised by an external contact. */
  requester?: string;
  typeCode?: string;
  status?: string;
  submittedFrom?: Date;
  submittedBefore?: Date;
};

/** D388: a request below another in a report, with its parent so the tree can be drawn. */
export type RequestReportNode = {
  key: string;
  parentKey: string;
  titleEn: string;
  titleAr: string;
  typeEn: string;
  typeAr: string;
  status: string;
  stepEn: string;
  stepAr: string;
  submittedAt: string | null;
  dueAt: string | null;
};

/** D388: a work item raised for a request in a report; `assignee` is a person id or an agent code. */
export type RequestReportWorkItem = {
  key: string;
  requestKey: string;
  parentKey: string | null;
  titleEn: string;
  titleAr: string;
  status: string;
  priority: string;
  assignee: string;
  dueAt: string | null;
};

/** D388: the Requests report's filters, each optional; dates are bounds, `before` is exclusive. */
export type RequestInquiry = {
  q?: string;
  projectKey?: string;
  typeCode?: string;
  status?: string;
  /** A person's id, or `ext` for an external contact. */
  requester?: string;
  channel?: string;
  /** The English name of the step a request is on. */
  step?: string;
  submittedFrom?: Date;
  submittedBefore?: Date;
  dueFrom?: Date;
  dueBefore?: Date;
  /** Past its due date and not finished. */
  overdue?: boolean;
  /** `top` for requests with no parent, `sub` for sub-requests; both when absent. */
  level?: "top" | "sub";
};

/** D388: one request a Requests report lists. */
export type RequestInquiryRow = {
  key: string;
  parentKey: string | null;
  titleEn: string;
  titleAr: string;
  typeEn: string;
  typeAr: string;
  projectKey: string;
  requester: string;
  status: string;
  stepEn: string;
  stepAr: string;
  channel: string;
  submittedAt: string | null;
  dueAt: string | null;
};

/** D388: the values the Requests report's filters offer, from the requests that exist. */
export type RequestInquiryOptions = { statuses: string[]; channels: string[]; steps: [en: string, ar: string][] };
