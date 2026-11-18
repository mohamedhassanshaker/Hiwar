import { Requests } from "@/features/requests/components/requests";
import { loadRequest, loadRequests } from "@/features/requests/service";
import { SERVER_PAGE_SIZE, dayAfter, dayStart, pageOf } from "@/lib/paging";

/** S-27 to S-29: one page of the request list, filtered on the server, and the request `?open=` names (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const page = pageOf(one("page") || undefined);
  const filters = {
    q: one("q").trim(),
    project: one("project"),
    by: one("by"),
    type: one("type"),
    status: one("status"),
    from: one("from"),
    to: one("to"),
  };

  const [listed, opened] = await Promise.all([
    loadRequests(
      {
        q: filters.q || undefined,
        projectKey: filters.project || undefined,
        requester: filters.by || undefined,
        typeCode: filters.type || undefined,
        status: filters.status || undefined,
        submittedFrom: dayStart(filters.from),
        // The "to" day is included: requests submitted before the next day begins.
        submittedBefore: dayAfter(filters.to),
      },
      { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
    ),
    one("open") ? loadRequest(one("open")) : null,
  ]);

  return (
    <Requests
      requests={listed.requests}
      page={{ page, total: listed.total, size: SERVER_PAGE_SIZE }}
      types={listed.types}
      filters={filters}
      opened={opened}
    />
  );
}
