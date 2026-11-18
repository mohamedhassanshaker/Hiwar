import { dayAfter, dayStart } from "@/lib/paging";
import type { WorkItemInquiry } from "./types";

/** D388: the Work items report's filters as they appear in its address. */
export const WORK_ITEM_INQUIRY_FIELDS = [
  "q", "project", "type", "status", "priority", "assignee", "reviewer", "request", "open", "overdue", "level", "dueFrom", "dueTo", "from", "to",
] as const;

export type WorkItemInquiryForm = Record<(typeof WORK_ITEM_INQUIRY_FIELDS)[number], string>;

/** The filters a Work items report's address names; a "to" day is included. */
export function workItemInquiryOf(form: WorkItemInquiryForm): WorkItemInquiry {
  return {
    q: form.q || undefined,
    projectKey: form.project || undefined,
    type: form.type || undefined,
    status: form.status || undefined,
    priority: form.priority || undefined,
    assignee: form.assignee || undefined,
    reviewer: form.reviewer || undefined,
    requestKey: form.request || undefined,
    open: form.open === "1" || undefined,
    overdue: form.overdue === "1" || undefined,
    level: form.level === "top" || form.level === "sub" ? form.level : undefined,
    dueFrom: dayStart(form.dueFrom),
    dueBefore: dayAfter(form.dueTo),
    createdFrom: dayStart(form.from),
    createdBefore: dayAfter(form.to),
  };
}
