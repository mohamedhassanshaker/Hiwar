import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db, schema } from "@/db";
import { listAgents, toolCatalogue, versionsOf } from "@/server/agents";
import { orgPlan, PLAN_LABEL } from "@/server/plans";
import { requireMember } from "@/server/session";
import { AgentEditor } from "../editor";

export const metadata = { title: "Agents" };

/** C-Agents (AGT-001 to AGT-003). */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember("manage_agents", "/agents");
  const agents = await listAgents(member.org.id);
  const agent = agents.find((a) => a.id === id);
  if (!agent) notFound();
  const sources = await db.query.sources.findMany({ where: eq(schema.sources.orgId, member.org.id), orderBy: schema.sources.createdAt });
  const { limits } = await orgPlan(member.org);
  const versions = await versionsOf(member.org.id, id);
  const live = agent.liveVersion
    ? await db.query.agentVersions.findFirst({
        where: and(eq(schema.agentVersions.agentId, id), eq(schema.agentVersions.number, agent.liveVersion)),
      })
    : null;
  return (
    <AgentEditor
      key={agent.id}
      readOnly={Boolean(member.support)}
      planLabel={PLAN_LABEL[member.org.plan]}
      models={limits.models}
      httpTools={limits.httpTools}
      agents={agents.map((a) => ({ id: a.id, name: a.draft.name, purpose: a.draft.purpose, live: a.liveVersion }))}
      agent={{ id: agent.id, draft: agent.draft, live: agent.liveVersion }}
      liveConfig={JSON.stringify(live?.config ?? null)}
      versions={versions.map((v) => ({ number: v.number, publishedAt: v.publishedAt.toISOString(), publishedBy: v.publishedBy ?? "Unknown" }))}
      sources={sources.map((s) => ({ id: s.id, name: s.name, type: s.type, status: s.status, enabled: s.enabled, chunks: s.chunks, detail: s.details.url ?? s.details.question ?? "" }))}
      tools={await toolCatalogue(member.org.id)}
    />
  );
}
