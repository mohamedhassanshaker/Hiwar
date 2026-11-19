import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db, schema } from "@/db";
import { listAgents, toolCatalogue } from "@/server/agents";
import { listDeployments, snippet } from "@/server/deployments";
import { requireMember } from "@/server/session";
import { DeploymentClient } from "./deployment-client";

export const metadata = { title: "Deployments" };

/** C-Deployments (DEP-001, DEP-002). */
export default async function DeploymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember("manage_deployments", "/deployments");
  const rows = await listDeployments(member.org.id);
  const current = rows.find((r) => r.d.id === id);
  if (!current) notFound();
  const d = current.d;
  const origins = await db.query.origins.findMany({ where: and(eq(schema.origins.deploymentId, d.id), eq(schema.origins.orgId, member.org.id)), orderBy: schema.origins.createdAt });
  const versions = await db.query.agentVersions.findMany({ where: eq(schema.agentVersions.agentId, d.agentId), columns: { number: true }, orderBy: schema.agentVersions.number });
  const agents = await listAgents(member.org.id);
  const agent = agents.find((a) => a.id === d.agentId);
  const catalogue = await toolCatalogue(member.org.id);
  return (
    <DeploymentClient
      key={d.id}
      readOnly={Boolean(member.support)}
      orgOverage={member.org.limitBehaviour === "overage"}
      list={rows.map((r) => ({ id: r.d.id, name: r.d.name, status: r.d.status, agent: r.agentName }))}
      agents={agents.map((a) => ({ id: a.id, name: a.draft.name }))}
      deployment={{
        id: d.id,
        name: d.name,
        status: d.status,
        agentId: d.agentId,
        agentName: current.agentName,
        agentLive: current.agentLive,
        publicKey: d.publicKey,
        previousKeyExpiresAt: d.previousKeyExpiresAt?.toISOString() ?? null,
        snippet: snippet(d.publicKey),
        settings: d.settings,
      }}
      origins={origins.map((o) => ({ id: o.id, origin: o.checkUrl ?? o.origin, verified: Boolean(o.verifiedAt), reason: o.reason }))}
      versions={versions.map((v) => v.number)}
      tools={catalogue.filter((t) => agent?.draft.tools[t.key]?.enabled).map((t) => ({ key: t.key, name: t.name }))}
    />
  );
}
