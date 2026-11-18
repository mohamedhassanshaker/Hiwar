import { loadToolConfiguration } from "@/features/agents/tool-configuration-service";
import { BUILTIN_AGENT_CODE } from "@/features/agents/builtin";
import { Agents } from "@/features/agents/components/agents";
import { loadAgent, loadAgentChoices, loadRunCount, loadRunPage } from "@/features/agents/service";
import { loadDirectory } from "@/features/organisation/service";
import { runPeriodOf } from "@/features/agents/run-periods";
import { SERVER_PAGE_SIZE, pageOf } from "@/lib/paging";

/**
 * S-50 and S-51: the agents and what each one is configured to do.
 *
 * `dir` is configured natively, not by a designer, and carries no screen of its own, so it
 * is not offered here — the same way `UC-50.2-04` already refuses "System" trust to any
 * agent a designer tries to create. The built-in Assistant is offered: D65 keeps its
 * skills, tools, knowledge, memory, model and budgets configurable, and only its existence
 * fixed.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; tab?: string; runStatus?: string; runPeriod?: string; runQ?: string; page?: string }>;
}) {
  const { agent: open, tab, runStatus, runPeriod, runQ, page: pageParam } = await searchParams;
  const [{ agents }, { units, routes }] = await Promise.all([loadDirectory(), loadAgentChoices()]);
  const configurable = agents.filter((agent) => !agent.isSystem || agent.id === BUILTIN_AGENT_CODE);
  const details = Object.fromEntries(
    (await Promise.all(configurable.map(async (agent) => [agent.id, await loadAgent(agent.id)] as const))).filter(
      (entry): entry is [string, NonNullable<Awaited<ReturnType<typeof loadAgent>>>] => entry[1] !== null,
    ),
  );
  // #20b: read for the open agent alone. The grant needs the whole platform catalogue and
  // the run payload behind it, which is not work worth doing for every card in the list.
  const toolConfiguration = open && open in details ? await loadToolConfiguration(open) : null;
  // D349: the open agent's Runs tab, one page at a time, filtered on the server.
  let runs = null;
  let runCount: number | undefined;
  if (open && open in details && tab !== "runs") runCount = await loadRunCount({ agentCode: open });
  if (open && open in details && tab === "runs") {
    const page = pageOf(pageParam);
    const filters = { status: runStatus ?? "all", period: runPeriodOf(runPeriod), q: runQ ?? "" };
    const listed = await loadRunPage({
      agentCode: open,
      status: filters.status === "all" ? undefined : filters.status,
      sinceHours: filters.period || undefined,
      text: filters.q.trim() || undefined,
      limit: SERVER_PAGE_SIZE,
      offset: (page - 1) * SERVER_PAGE_SIZE,
    });
    runs = { rows: listed.runs, page: { page, total: listed.total, size: SERVER_PAGE_SIZE }, filters };
    runCount = filters.status === "all" && !filters.period && !filters.q.trim() ? listed.total : await loadRunCount({ agentCode: open });
  }
  return <Agents details={details} units={units} routes={routes} toolConfiguration={toolConfiguration} runs={runs} runCount={runCount} />;
}
