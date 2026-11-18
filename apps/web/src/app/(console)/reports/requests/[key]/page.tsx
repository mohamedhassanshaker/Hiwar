import { notFound } from "next/navigation";

import { loadLetterhead } from "@/features/governance/service";
import { RequestReportView } from "@/features/requests/components/request-report";
import { loadRequestReport } from "@/features/requests/service";

/** D388: one request as a report — header, form, steps, history, sub-requests, work items, audit. */
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [report, letterhead] = await Promise.all([loadRequestReport(decodeURIComponent(key)), loadLetterhead()]);
  if (!report) notFound();
  return <RequestReportView report={report} letterhead={letterhead} />;
}
