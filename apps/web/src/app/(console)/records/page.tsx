import { Records } from "@/features/home/components/records";
import { loadRecords } from "@/features/home/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** S-11: the drill-down the dashboard KPI links to, filtered and paged on the server (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const page = pageOf(one("page") || undefined);
  const filters = { q: one("q"), project: one("project") || "any", status: one("status") || "any" };
  const data = await loadRecords(one("kind") || undefined, {
    term: filters.q.trim() || undefined,
    project: filters.project,
    status: filters.status,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });
  return <Records data={data} page={{ page, total: data.total, size: SERVER_PAGE_SIZE }} filters={filters} />;
}
