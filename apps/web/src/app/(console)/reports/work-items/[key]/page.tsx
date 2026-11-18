import { notFound } from "next/navigation";

import { loadLetterhead } from "@/features/governance/service";
import { WorkItemReportView } from "@/features/work-items/components/work-item-report";
import { loadWorkItemReport } from "@/features/work-items/service";

/** D388: one work item as a report — header, description, fields, sub-items, history, attachments, audit. */
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [report, letterhead] = await Promise.all([loadWorkItemReport(decodeURIComponent(key)), loadLetterhead()]);
  if (!report) notFound();
  return <WorkItemReportView report={report} letterhead={letterhead} />;
}
