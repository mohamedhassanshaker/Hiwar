import { Tasks } from "@/features/work-items/components/work-items";
import { loadWorkItem, loadWorkItems } from "@/features/work-items/service";
import { SERVER_PAGE_SIZE, dayAfter, dayStart, pageOf } from "@/lib/paging";

/** S-24 and S-25: the work item board or one page of the list, filtered on the server, and the drawer `?open=` names (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const board = one("view") !== "list";
  const page = pageOf(one("page") || undefined);
  const filters = {
    // No scope is the hot items; `all` would read as "no filter", so every item is `every`.
    scope: one("scope") === "comments" ? ("comments" as const) : one("scope") === "every" ? ("all" as const) : ("hot" as const),
    q: one("q").trim(),
    project: one("project"),
    type: one("type"),
    status: one("status"),
    pri: one("pri"),
    who: one("who"),
    from: one("from"),
    to: one("to"),
  };

  const [listed, opened] = await Promise.all([
    loadWorkItems(
      {
        scope: filters.scope,
        q: filters.q || undefined,
        projectKey: filters.project || undefined,
        type: filters.type || undefined,
        status: filters.status || undefined,
        priority: filters.pri || undefined,
        assignee: filters.who || undefined,
        dueFrom: dayStart(filters.from),
        // The "to" day is included: items due before the next day begins.
        dueBefore: dayAfter(filters.to),
      },
      board ? { board: true } : { board: false, limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
    ),
    one("open") ? loadWorkItem(one("open")) : null,
  ]);

  return (
    <Tasks
      items={listed.items}
      board={board}
      page={{ page, total: listed.total, size: SERVER_PAGE_SIZE }}
      columns={listed.columns}
      scopes={listed.scopes}
      filters={filters}
      views={listed.views}
      opened={opened}
    />
  );
}
