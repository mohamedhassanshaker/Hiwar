import { SessionsList } from "@/features/rooms/components/rooms-list";
import { loadRooms } from "@/features/rooms/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/**
 * S-22: the discussion rooms the signed-in person may see, a page at a time, with the filters
 * in the URL. The status is Active unless the URL names another, or `any` (`UC-22.1-01`).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const status = one("status") || "Active";
  const page = pageOf(one("page") || undefined);
  const { rooms, total, counts } = await loadRooms(
    { status: status === "any" ? undefined : status, projectKey: one("project") || undefined, text: one("q").trim() || undefined },
    { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
  );
  return (
    <SessionsList
      rooms={rooms}
      counts={counts}
      page={{ page, total, size: SERVER_PAGE_SIZE }}
      filters={{ status, project: one("project"), q: one("q") }}
    />
  );
}
