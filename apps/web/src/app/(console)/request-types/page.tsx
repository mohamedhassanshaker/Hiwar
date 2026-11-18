import { RequestTypes } from "@/features/requests/components/request-types";
import { loadRequestTypeDetail, loadRequestTypes } from "@/features/requests/service";

/** S-30: the request types and the request type designer. */
export default async function Page() {
  const { types, mayWriteTypes, appUrl } = await loadRequestTypes();
  const typeDetails = Object.fromEntries(
    (await Promise.all(types.map(async (type) => [type.c, await loadRequestTypeDetail(type.c, "draft")] as const))).filter(
      (entry): entry is [string, NonNullable<Awaited<ReturnType<typeof loadRequestTypeDetail>>>] => entry[1] !== null,
    ),
  );
  return <RequestTypes types={types} typeDetails={typeDetails} mayWriteTypes={mayWriteTypes} appUrl={appUrl} />;
}
