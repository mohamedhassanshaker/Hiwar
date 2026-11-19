import { listSources, listUnanswered, storageUsed } from "@/server/knowledge";
import { orgPlan, PLAN_LABEL } from "@/server/plans";
import { requireMember } from "@/server/session";
import { KnowledgeClient } from "./knowledge-client";

export const metadata = { title: "Knowledge" };

/** C-Knowledge (KNO-001, KNO-002). */
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const member = await requireMember("manage_agents", "/knowledge");
  const { view } = await searchParams;
  const sources = await listSources(member.org.id);
  const unanswered = await listUnanswered(member.org.id);
  const { limits } = await orgPlan(member.org);
  const bytes = await storageUsed(member.org.id);
  return (
    <KnowledgeClient
      readOnly={Boolean(member.support)}
      initialView={view === "unanswered" ? "un" : "src"}
      stats={{
        ready: sources.filter((s) => s.status === "ready" && s.enabled).length,
        total: sources.length,
        chunks: sources.filter((s) => s.enabled && s.status === "ready").reduce((sum, s) => sum + s.chunks, 0),
        storage: `${(bytes / 1024 ** 3).toFixed(1)} GB`,
        storageLimit: `${limits.storageGb} GB on the ${PLAN_LABEL[member.org.plan]} plan`,
        unansweredWeek: unanswered.reduce((sum, q) => sum + q.weekCount, 0),
      }}
      sources={sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        enabled: s.enabled,
        reason: s.reason,
        chunks: s.chunks,
        updated: s.updatedAt.toISOString(),
        detail:
          s.type === "file"
            ? `${(s.bytes / 1024 / 1024).toFixed(1)} MB${s.languages ? ` · ${s.languages}` : ""}`
            : s.type === "website"
              ? `Crawl depth ${s.details.depth ?? 2} · manual re-crawl`
              : "Written by hand",
      }))}
      unanswered={unanswered.map((q) => ({ ...q, lastAskedAt: q.lastAskedAt.toISOString() }))}
    />
  );
}
