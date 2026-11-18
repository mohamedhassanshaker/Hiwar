import { RequestInquiry } from "@/features/requests/components/request-inquiry";
import { REQUEST_INQUIRY_FIELDS } from "@/features/requests/inquiry";
import { requestReportChoices } from "@/features/requests/service";
import { formOf, type QueryValues } from "@/lib/inquiry";

/** D388: the Requests report's filters, and Show report. */
export default async function Page({ searchParams }: { searchParams: Promise<QueryValues> }) {
  const form = formOf(await searchParams, REQUEST_INQUIRY_FIELDS);
  const { options, types } = await requestReportChoices();
  return <RequestInquiry form={form} options={options} types={types} />;
}
