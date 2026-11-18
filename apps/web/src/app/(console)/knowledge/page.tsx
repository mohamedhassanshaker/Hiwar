import { Knowledge } from "@/features/knowledge/components/knowledge";
import { loadKnowledge } from "@/features/knowledge/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/**
 * S-56 to S-58: the knowledge collections, their sources and retrieval. The collection `?open=`
 * names shows one page of its sources at a time, searched on the server by `?q=` (D349).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const open = one("open") || undefined;
  const page = pageOf(one("page") || undefined);
  const { collections, sources, sourceTotal, lastTest, graphRetrieval, mayReadLogs, logService } = await loadKnowledge(
    open,
    { q: one("q").trim() || undefined },
    { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
  );
  return (
    <Knowledge
      collections={collections}
      opened={open ?? null}
      sources={sources}
      sourcePage={{ page, total: sourceTotal, size: SERVER_PAGE_SIZE }}
      sourceQuery={one("q")}
      lastTest={lastTest}
      graphRetrieval={graphRetrieval}
      mayReadLogs={mayReadLogs}
      logService={logService}
    />
  );
}
