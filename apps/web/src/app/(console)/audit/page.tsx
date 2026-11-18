import { Audit } from "@/features/governance/components/govern";
import { loadAuditPage } from "@/features/governance/service";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/** One of the periods the Audit screen's period filter offers, or every entry. */
const PERIODS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

/** S-73: the append-only audit log. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // `UC-73.1-02`: the filter lives in the URL, so the server does the filtering and an
  // auditor can share or bookmark exactly what they were looking at.
  const actorParam = one("actor");
  const actor = actorParam === "human" || actorParam === "agent" ? actorParam : undefined;
  const periodKey = one("period");
  const sinceDays = periodKey ? PERIODS[periodKey] : undefined;

  const page = pageOf(one("page"));
  const { rows, total } = await loadAuditPage({
    actor,
    action: one("action") || undefined,
    sinceDays,
    limit: SERVER_PAGE_SIZE,
    offset: (page - 1) * SERVER_PAGE_SIZE,
  });

  return (
    <Audit
      rows={rows}
      page={{ page, total, size: SERVER_PAGE_SIZE }}
      actor={actor ?? "all"}
      period={periodKey ?? "all"}
      action={one("action") ?? ""}
    />
  );
}
