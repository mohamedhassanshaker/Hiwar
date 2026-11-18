import { FeatureOff } from "@/components/shared/feature-off";
import { Conversations } from "@/features/engage/components/conversations";
import { loadConversations } from "@/features/engage/service";
import type { ConversationStatus } from "@/features/engage/types";
import { SERVER_PAGE_SIZE, dayAfter, dayStart, pageOf } from "@/lib/paging";

/** The periods the period filter offers, in days. */
const PERIODS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

const STATUSES: ConversationStatus[] = ["Live", "AgentPaused", "HandedOff", "Ended"];

/** D342: every visitor conversation, newest first, with its filters in the URL. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (key: string): string => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const period = PERIODS[one("period")] ? one("period") : "all";
  const status = STATUSES.find((value) => value === one("status"));
  const page = pageOf(one("page") || undefined);

  const listed = await loadConversations(
    {
      deploymentCode: one("deployment") || undefined,
      sinceDays: PERIODS[period],
      from: dayStart(one("from")),
      // The "to" day is included: conversations started before the next day begins.
      to: dayAfter(one("to")),
      status,
      text: one("q").trim() || undefined,
    },
    { limit: SERVER_PAGE_SIZE, offset: (page - 1) * SERVER_PAGE_SIZE },
  );
  if (!listed.enabled) return <FeatureOff feature="Embedded deployments" featureAr="النشر المضمّن" />;

  return (
    <Conversations
      rows={listed.rows}
      page={{ page, total: listed.total, size: SERVER_PAGE_SIZE }}
      deployments={listed.deployments}
      filters={{ period, from: one("from"), to: one("to"), deployment: one("deployment"), status: status ?? "all", text: one("q") }}
    />
  );
}
