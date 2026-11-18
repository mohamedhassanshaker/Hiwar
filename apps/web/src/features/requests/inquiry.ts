import { dayAfter, dayStart } from "@/lib/paging";
import type { RequestInquiry } from "./types";

/** D388: the Requests report's filters as they appear in its address. */
export const REQUEST_INQUIRY_FIELDS = ["q", "project", "type", "status", "by", "channel", "step", "from", "to", "dueFrom", "dueTo", "overdue", "level"] as const;

export type RequestInquiryForm = Record<(typeof REQUEST_INQUIRY_FIELDS)[number], string>;

/** The filters a Requests report's address names; a "to" day is included. */
export function requestInquiryOf(form: RequestInquiryForm): RequestInquiry {
  return {
    q: form.q || undefined,
    projectKey: form.project || undefined,
    typeCode: form.type || undefined,
    status: form.status || undefined,
    requester: form.by || undefined,
    channel: form.channel || undefined,
    step: form.step || undefined,
    submittedFrom: dayStart(form.from),
    submittedBefore: dayAfter(form.to),
    dueFrom: dayStart(form.dueFrom),
    dueBefore: dayAfter(form.dueTo),
    overdue: form.overdue === "1" || undefined,
    level: form.level === "top" || form.level === "sub" ? form.level : undefined,
  };
}
