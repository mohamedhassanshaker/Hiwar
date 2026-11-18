import { Routines } from "@/features/schedules/components/scheduled-work-items";
import { loadSchedulePage } from "@/features/schedules/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** S-31: the work items the platform creates on a schedule or an event, filtered and paged on the server (D349). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const audience = one("audience") === "agent" || one("audience") === "human" ? (one("audience") as "agent" | "human") : undefined;
  const page = pageOf(one("page") || undefined);
  const listed = await loadSchedulePage({
    audience,
    projectKey: one("project") || undefined,
    text: one("q").trim() || undefined,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });
  return (
    <Routines
      schedules={listed.rows}
      page={{ page, total: listed.total, size: SERVER_PAGE_SIZE }}
      active={listed.active}
      filters={{ audience: audience ?? "all", project: one("project") || "any", q: one("q") }}
    />
  );
}
