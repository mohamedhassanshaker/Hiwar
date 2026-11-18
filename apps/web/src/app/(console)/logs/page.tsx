import { Logs } from "@/features/governance/components/govern";
import { loadLogs } from "@/features/governance/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** S-74: the service log. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // `UC-74.1-02` and `UC-74.1-03`: level, service and run are applied in the query, so a
  // run's lines are the newest lines of that run rather than whichever of the newest two
  // hundred lines happen to belong to it.
  const level = one("level");
  const service = one("service");
  const runId = one("run");
  const page = pageOf(one("page"));
  const { rows, services, total } = await loadLogs({
    level,
    service,
    runId,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });

  return (
    <Logs
      rows={rows}
      page={{ page, total, size: SERVER_PAGE_SIZE }}
      services={services}
      level={level ?? "all"}
      service={service ?? "all"}
      runId={runId ?? ""}
    />
  );
}
