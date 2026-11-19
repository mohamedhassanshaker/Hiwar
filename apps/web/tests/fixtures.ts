import { db, schema } from "@/db";
import { defaultAgentConfig } from "@/server/agents";
import type { Role } from "@/server/authz";
import type { MemberContext } from "@/server/session";
import { defaultDeploymentSettings } from "@/server/visitor";

let n = 0;
const run = Math.random().toString(36).slice(2, 8);

/** An organization with a published agent, a live deployment and members of the given roles. */
export async function world(roles: Role[] = ["owner", "support_agent", "support_agent"]) {
  n += 1;
  const [org] = await db.insert(schema.organizations).values({ name: `Org ${n}`, plan: "growth", status: "active" }).returning();
  const members: MemberContext[] = [];
  for (const [i, role] of roles.entries()) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `u${run}-${n}-${i}@test.local`, name: `User ${n}-${i}`, passwordHash: "x", emailVerifiedAt: new Date() })
      .returning();
    await db.insert(schema.members).values({ orgId: org.id, userId: user.id, role });
    members.push({ sessionId: "test", user, org, role, mfaPassed: true, support: null });
  }
  const config = defaultAgentConfig("Layla");
  const [agent] = await db.insert(schema.agents).values({ orgId: org.id, draft: config, liveVersion: 1 }).returning();
  await db.insert(schema.agentVersions).values({ orgId: org.id, agentId: agent.id, number: 1, config });
  const [deployment] = await db
    .insert(schema.deployments)
    .values({ orgId: org.id, name: "Site", agentId: agent.id, status: "live", publicKey: `pk_dep_test${run}${n}`, settings: defaultDeploymentSettings() })
    .returning();
  return { org, members, agent, deployment };
}

export async function conversation(w: Awaited<ReturnType<typeof world>>, state: "AI_ACTIVE" | "HANDOVER_PENDING" | "HUMAN_ACTIVE" = "AI_ACTIVE", owner?: string) {
  const [c] = await db
    .insert(schema.conversations)
    .values({
      orgId: w.org.id,
      deploymentId: w.deployment.id,
      agentId: w.agent.id,
      agentVersion: 1,
      visitorToken: `tok-${Math.random().toString(36).slice(2)}-padding`,
      visitor: { language: "en", name: "Omar" },
      state,
      ownerUserId: owner ?? null,
      waitingSince: state === "HANDOVER_PENDING" ? new Date() : null,
    })
    .returning();
  return c;
}
