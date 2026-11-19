import { RunList } from "@/features/agents/components/run-list";
import { runPeriodOf } from "@/features/agents/run-periods";
import { runSortOf } from "@/features/agents/run-sort";
import { loadRunPage } from "@/features/agents/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/**
 * D383: every agent's runs on one screen, filtered on the server by agent and by how long ago
 * they started, sorted by the column the address names (newest first by default), a page at a time.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; period?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const query = await searchParams;
  const period = runPeriodOf(query.period);
  const agent = query.agent?.trim() ?? "";
  const sort = runSortOf(query.sort, query.dir);
  const page = pageOf(query.page);
  const { runs, total } = await loadRunPage({
    agentCode: agent || undefined,
    sinceHours: period || undefined,
    sort,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });
  return <RunList rows={runs} page={{ page, total, size: SERVER_PAGE_SIZE }} filters={{ agent, period }} sort={sort} />;
}
