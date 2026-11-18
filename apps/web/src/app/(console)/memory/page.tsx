import { Memory } from "@/features/memory/components/memory";
import { loadMemory } from "@/features/memory/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** The review states the "Last reviewed" filter offers. */
const REVIEWED = ["overdue", "never"] as const;

/** S-55: the memory a run may read and write, one page of the tree at a time, filtered on the server (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const page = pageOf(one("page") || undefined);
  const reviewed = REVIEWED.find((value) => value === one("reviewed"));
  const filters = {
    scope: one("scope") || undefined,
    owner: one("owner") || undefined,
    status: one("status") || undefined,
    reviewed,
    source: one("source") || undefined,
    q: one("q").trim() || undefined,
  };
  const loaded = await loadMemory(filters, { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE }, one("open") || undefined);
  return (
    <Memory
      {...loaded}
      page={{ page, total: loaded.total, size: SERVER_PAGE_SIZE }}
      filters={{
        scope: one("scope") || "all",
        owner: one("owner") || "any",
        status: one("status") || "any",
        reviewed: reviewed ?? "any",
        source: one("source") || "any",
        q: one("q"),
      }}
    />
  );
}
