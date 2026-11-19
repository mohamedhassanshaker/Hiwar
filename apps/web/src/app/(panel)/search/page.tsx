import { and, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";

import { db, schema } from "@/db";
import { can } from "@/server/authz";
import { requireMember } from "@/server/session";

export const metadata = { title: "Search" };

/** PLT-008 FR-005: conversations, agents and sources, only what the role may see. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const member = await requireMember(undefined, "/search");
  const q = ((await searchParams).q ?? "").trim();
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const orgId = member.org.id;
  const showConversations = can(member.role, "conversations") && (!member.support || member.support.includeConversations);
  const showBuild = can(member.role, "manage_agents");
  const [conversations, agents, sources] = q
    ? await Promise.all([
        showConversations
          ? db
              .select({ id: schema.conversations.id, name: sql<string>`coalesce(${schema.conversations.visitor}->>'name', 'Visitor')`, state: schema.conversations.state })
              .from(schema.conversations)
              .where(
                and(
                  eq(schema.conversations.orgId, orgId),
                  or(
                    sql`${schema.conversations.visitor}->>'name' ilike ${like}`,
                    sql`exists (select 1 from messages m where m.conversation_id = ${schema.conversations.id} and m.kind in ('visitor','ai','staff') and m.text ilike ${like})`,
                  ),
                ),
              )
              .limit(20)
          : Promise.resolve([]),
        showBuild
          ? db
              .select({ id: schema.agents.id, name: sql<string>`${schema.agents.draft}->>'name'` })
              .from(schema.agents)
              .where(and(eq(schema.agents.orgId, orgId), sql`${schema.agents.draft}->>'name' ilike ${like}`))
              .limit(20)
          : Promise.resolve([]),
        showBuild
          ? db.select({ id: schema.sources.id, name: schema.sources.name }).from(schema.sources).where(and(eq(schema.sources.orgId, orgId), ilike(schema.sources.name, like))).limit(20)
          : Promise.resolve([]),
      ])
    : [[], [], []];
  const groups = [
    { title: "Conversations", show: showConversations, items: conversations.map((c) => ({ href: `/conversations?c=${c.id}`, label: c.name })) },
    { title: "Agents", show: showBuild, items: agents.map((a) => ({ href: `/agents/${a.id}`, label: a.name })) },
    { title: "Sources", show: showBuild, items: sources.map((s) => ({ href: "/knowledge", label: s.name })) },
  ].filter((g) => g.show);
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Search</h1>
          <p className="lead">{q ? `Results for “${q}”` : "Type in the search field above."}</p>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.title} className="card p-16 col gap-8">
          <h2 className="h3">{g.title}</h2>
          {g.items.length === 0 && <span className="sm muted">No matches.</span>}
          {g.items.map((i) => (
            <Link key={i.href + i.label} href={i.href}>
              {i.label}
            </Link>
          ))}
        </section>
      ))}
    </>
  );
}
