import { loadRecordAudit } from "@/features/governance/service";
import { requirePermission, visibleProjectIds } from "@/lib/session";
import * as repository from "./repository";
import type { Task, WorkItemDetail, WorkItemInquiry, WorkItemReportFacts } from "./types";

/**
 * D388: a work item as a report — its header, description, fields, history with times, the
 * items below it at every depth, attachments, and its audit trail for whoever may read the audit.
 */

export type WorkItemReport = {
  item: Task;
  detail: WorkItemDetail;
  facts: WorkItemReportFacts;
  /** Null when the person may not read the audit log. */
  audit: Awaited<ReturnType<typeof loadRecordAudit>>;
  generatedAt: string;
};

/** The report of work item `key`, or null when there is none or the person does not see it. Requires `work_items:read`. */
export async function loadWorkItemReport(key: string): Promise<WorkItemReport | null> {
  const session = await requirePermission("work_items:read");
  const listed = await repository.listWorkItemPage(await visibleProjectIds("work_items:read"), session.personId, { key }, { limit: 1, offset: 0 });
  const item = listed.rows[0];
  if (!item) return null;
  const [details, facts] = await Promise.all([repository.readDetails([key]), repository.readWorkItemReportFacts(key)]);
  const detail = details[key];
  if (!detail || !facts) return null;
  const audit = await loadRecordAudit("WorkItem", key, new Date(facts.createdAt));
  return { item, detail, facts, audit, generatedAt: new Date().toISOString() };
}

/** D388: opens the Work items report's filters, which only someone who reads work items may use. */
export async function openWorkItemsReport(): Promise<void> {
  await requirePermission("work_items:read");
}

/**
 * D388: the work items a person sees that match a Work items report's filters, at most `limit`,
 * with how many match in all. Requires `work_items:read`.
 */
export async function inquireWorkItems(filter: WorkItemInquiry, limit: number) {
  const session = await requirePermission("work_items:read");
  const matched = await repository.inquireWorkItems(await visibleProjectIds("work_items:read"), session.personId, filter, limit);
  return { ...matched, generatedAt: new Date().toISOString() };
}
