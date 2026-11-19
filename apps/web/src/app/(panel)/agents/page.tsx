import { redirect } from "next/navigation";

import { listAgents } from "@/server/agents";
import { requireMember } from "@/server/session";

export const metadata = { title: "Agents" };

/** Opens the first agent, or the empty state when there is none. */
export default async function AgentsIndex() {
  const member = await requireMember("manage_agents", "/agents");
  const agents = await listAgents(member.org.id);
  if (agents.length > 0) redirect(`/agents/${agents[0].id}`);
  const { EmptyAgents } = await import("./empty");
  return <EmptyAgents />;
}
