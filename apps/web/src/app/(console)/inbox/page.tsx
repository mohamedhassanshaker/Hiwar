import { mayRaiseTasks } from "@/features/comments/service";
import { Inbox } from "@/features/inbox/components/inbox";
import { loadInbox } from "@/features/inbox/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/**
 * S-12: the approvals, questions, mentions and warnings waiting for me, a page at a time with
 * the filter (`?filter=`) in the URL, and the quick-request threads raised from a comment on a
 * dashboard card.
 *
 * The threads themselves come from the console layout, which already reads them for the
 * badge and the peek; only whether this person may raise a task from one is read here.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const filter = one("filter") || "all";
  const page = pageOf(one("page") || undefined);
  const [inbox, raiseTasks] = await Promise.all([
    // Quick requests are the layout's comment threads; no Inbox rows are read for them.
    filter === "quick"
      ? loadInbox({ filter: "all", sel: one("sel") }, { limit: 0, offset: 0 })
      : loadInbox({ filter, sel: one("sel") }, { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE }),
    mayRaiseTasks(),
  ]);
  return (
    <Inbox
      items={inbox.items}
      counts={inbox.counts}
      selected={inbox.selected}
      filter={filter}
      page={{ page, total: filter === "quick" ? 0 : inbox.total, size: SERVER_PAGE_SIZE }}
      mayRaiseTasks={raiseTasks}
    />
  );
}
