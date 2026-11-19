import { notFound } from "next/navigation";

import { NoRuns, RunViewer } from "@/features/agents/components/run-viewer";
import { loadRun, loadRuns } from "@/features/agents/service";
import { env } from "@/lib/env";

/** S-52: the run the URL names, or the most recent one; a run id that names nothing is 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; agent?: string }> }) {
  const { id, agent } = await searchParams;
  // Without an id, the newest run (of the agent named, if one is), read alone (D349).
  const key = id ?? (await loadRuns({ agentCode: agent || undefined, limit: 1 }))[0]?.id;
  if (!key) return <NoRuns />;
  const detail = await loadRun(key);
  if (!detail) notFound();
  // The browser's address for Phoenix, not the exporter's: a trace link built from the
  // in-cluster URL resolves nowhere (`UC-52.1-07`).
  return <RunViewer detail={detail} phoenixOrigin={env().PHOENIX_PUBLIC_ORIGIN ?? ""} />;
}
