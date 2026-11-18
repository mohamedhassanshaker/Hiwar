import { WorkItemInquiry } from "@/features/work-items/components/work-item-inquiry";
import { WORK_ITEM_INQUIRY_FIELDS } from "@/features/work-items/inquiry";
import { openWorkItemsReport } from "@/features/work-items/service";
import { formOf, type QueryValues } from "@/lib/inquiry";

/** D388: the Work items report's filters, and Show report. */
export default async function Page({ searchParams }: { searchParams: Promise<QueryValues> }) {
  await openWorkItemsReport();
  return <WorkItemInquiry form={formOf(await searchParams, WORK_ITEM_INQUIRY_FIELDS)} />;
}
