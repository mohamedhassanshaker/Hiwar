import { loadLetterhead } from "@/features/governance/service";
import { WorkItemInquiryPdf } from "@/features/work-items/components/work-item-inquiry-pdf";
import { WORK_ITEM_INQUIRY_FIELDS, workItemInquiryOf } from "@/features/work-items/inquiry";
import { inquireWorkItems } from "@/features/work-items/service";
import { formOf, INQUIRY_PDF_ROWS, type QueryValues } from "@/lib/inquiry";

/** D388: a Work items report as a document, with up to 2000 of the matching work items. */
export default async function Page({ searchParams }: { searchParams: Promise<QueryValues> }) {
  const form = formOf(await searchParams, WORK_ITEM_INQUIRY_FIELDS);
  const [found, letterhead] = await Promise.all([inquireWorkItems(workItemInquiryOf(form), INQUIRY_PDF_ROWS), loadLetterhead()]);
  return <WorkItemInquiryPdf letterhead={letterhead} form={form} rows={found.rows} total={found.total} generatedAt={found.generatedAt} />;
}
