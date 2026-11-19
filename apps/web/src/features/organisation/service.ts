import { asc, eq, isNotNull, sql } from "drizzle-orm";

import { permittedAnywhere } from "@/authz/evaluate";
import { dbRo, schema as s } from "@/db/client";
import { requireSession } from "@/lib/session";
import type { Agent, Directory, Person } from "@/types/directory";

/**
 * The directory the AI screens name principals from, on Hiwar: the agents of the AI module,
 * the Hiwar staff with a platform role, and no projects. An agent's unit is the customer
 * organization it belongs to; an agent with none is Hiwar's own.
 */

const currentPeriod = sql`(
  select bp.estimated_spend_aed from gov.budget_period bp join gov.agent_budget ab on ab.id = bp.budget_id
  where ab.agent_id = ${s.agent.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc limit 1
)`;
const currentRuns = sql`(
  select bp.runs from gov.budget_period bp join gov.agent_budget ab on ab.id = bp.budget_id
  where ab.agent_id = ${s.agent.id} and bp.period_start <= now() and bp.period_end >= now() - interval '31 days'
  order by bp.period_start desc limit 1
)`;
const primaryModel = sql<string>`(
  select rs.model_name from ai.route_step rs where rs.route_id = ${s.agentVersion.primaryRouteId} order by rs.sort_order limit 1
)`;

async function listAgents(): Promise<Agent[]> {
  const rows = await dbRo()
    .select({
      id: s.agent.code,
      ini: s.agent.initials,
      name: s.agent.nameEn,
      nameAr: s.agent.nameAr,
      unit: s.organizations.name,
      versionNumber: s.agentVersion.versionNumber,
      model: primaryModel,
      status: s.agent.status,
      profile: s.agentVersion.executionProfile,
      runs: sql<number>`coalesce(${currentRuns}, 0)::int`,
      cost: sql<number>`coalesce(${currentPeriod}, 0)::float8`,
      isSystem: s.agent.isSystem,
    })
    .from(s.agent)
    .leftJoin(s.organizations, eq(s.organizations.id, s.agent.orgUnitId))
    .innerJoin(s.agentVersion, eq(s.agentVersion.id, s.agent.activeVersionId))
    .orderBy(asc(s.agent.code));
  const [state] = await dbRo().select({ paused: s.systemState.agentsPaused }).from(s.systemState).limit(1);
  const paused = state?.paused ?? false;
  return rows.map((row) => ({
    id: row.id,
    ini: row.ini,
    name: row.name,
    nameAr: row.nameAr,
    unit: row.unit ?? "Hiwar",
    unitAr: row.unit ?? "حوار",
    ver: `v${row.versionNumber}`,
    model: row.model ?? "",
    status: paused && row.status !== "Draft" ? "Paused" : (row.status as Agent["status"]),
    profile: row.profile,
    runs: row.runs,
    cost: row.cost,
    isSystem: row.isSystem,
  }));
}

const ROLE: Record<string, [string, string]> = {
  platform_admin: ["Platform admin", "مسؤول المنصة"],
  support_operator: ["Support operator", "مشغّل الدعم"],
};

async function listPeople(): Promise<Person[]> {
  const rows = await dbRo()
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, role: s.users.platformRole })
    .from(s.users)
    .where(isNotNull(s.users.platformRole))
    .orderBy(asc(s.users.name));
  return rows.map((row) => ({
    id: row.id,
    ini: row.name.split(/\s+/).map((part) => part[0] ?? "").slice(0, 2).join("").toUpperCase(),
    photo: null,
    name: row.name,
    nameAr: row.name,
    role: ROLE[row.role ?? ""]?.[0] ?? "",
    roleAr: ROLE[row.role ?? ""]?.[1] ?? "",
    email: row.email,
  }));
}

export async function loadDirectory(): Promise<Directory> {
  const session = await requireSession();
  const [agents, people] = await Promise.all([listAgents(), listPeople()]);
  const me = people.find((person) => person.id === session.personId) ?? {
    id: session.personId,
    ini: session.initials,
    photo: null,
    name: session.nameEn,
    nameAr: session.nameAr,
    role: "",
    roleAr: "",
    email: session.email,
  };
  return { me, agents, people, projects: [], may: permittedAnywhere(session.principal) };
}

/** What an agent may belong to: a customer organization, or none for Hiwar's own agents. */
export async function orgUnitChoices(): Promise<{ id: string; nameEn: string; nameAr: string; code: string }[]> {
  await requireSession();
  const rows = await dbRo().select({ id: s.organizations.id, name: s.organizations.name }).from(s.organizations).orderBy(asc(s.organizations.name));
  return rows.map((row) => ({ id: row.id, nameEn: row.name, nameAr: row.name, code: row.id.slice(0, 8) }));
}
