import { loadLetterhead } from "@/features/governance/service";
import { RequestInquiryPdf } from "@/features/requests/components/request-inquiry-pdf";
import { REQUEST_INQUIRY_FIELDS, requestInquiryOf } from "@/features/requests/inquiry";
import { inquireRequests } from "@/features/requests/service";
import { formOf, INQUIRY_PDF_ROWS, type QueryValues } from "@/lib/inquiry";

/** D388: a Requests report as a document, with up to 2000 of the matching requests. */
export default async function Page({ searchParams }: { searchParams: Promise<QueryValues> }) {
  const form = formOf(await searchParams, REQUEST_INQUIRY_FIELDS);
  const [found, letterhead] = await Promise.all([inquireRequests(requestInquiryOf(form), INQUIRY_PDF_ROWS), loadLetterhead()]);
  return <RequestInquiryPdf letterhead={letterhead} form={form} rows={found.rows} total={found.total} types={found.types} generatedAt={found.generatedAt} />;
}
