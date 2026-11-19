import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { ConnectionBanner } from "@/components/connection";
import { Sidebar, TopBar, type NavGroup } from "@/components/shell";
import { Toaster } from "@/components/toast";
import { db, schema } from "@/db";
import { exitSupportAction } from "@/app/ops/actions";
import { audit } from "@/server/audit";
import { can, ROLE_LABEL, type Capability } from "@/server/authz";
import { listNotices } from "@/server/notifications";
import { PLAN_LABEL } from "@/server/plans";
import { myOrganizations } from "@/server/profile";
import { requireMember } from "@/server/session";

const NAV: { label: string; items: { href: string; label: string; icon: string; cap: Capability }[] }[] = [
  {
    label: "Build",
    items: [
      { href: "/agents", label: "Agents", icon: "i-bot", cap: "manage_agents" },
      { href: "/knowledge", label: "Knowledge", icon: "i-database", cap: "manage_agents" },
      { href: "/deployments", label: "Deployments", icon: "i-globe", cap: "manage_deployments" },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/conversations", label: "Conversations", icon: "i-inbox", cap: "conversations" },
      { href: "/analytics", label: "Analytics", icon: "i-chart", cap: "analytics" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/billing", label: "Plan and usage", icon: "i-card", cap: "billing" },
      { href: "/team", label: "Team and roles", icon: "i-users", cap: "team" },
      { href: "/audit", label: "Audit log", icon: "i-shield-check", cap: "audit" },
    ],
  },
];

function planLine(org: { status: string; plan: keyof typeof PLAN_LABEL; trialEndsAt: Date | null }): string {
  if (org.status === "trial" && org.trialEndsAt) {
    const days = Math.max(0, Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000));
    return `Trial · ${days} days left`;
  }
  return `${PLAN_LABEL[org.plan]} plan`;
}

/** The control panel shell (PLT-003): sidebar and top bar, filtered by role (ORG-002 FR-006). */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  if (member.support) {
    // OPS-003 FR-004: every page viewed under support access is in the customer's audit log.
    const path = (await headers()).get("x-path") ?? "a page";
    await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: "Hiwar support", area: "Users", action: "Hiwar support viewed a page", item: path });
  }
  const groups: NavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => can(member.role, i.cap)).map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((g) => g.items.length > 0);
  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.orgId, member.org.id), eq(schema.conversations.state, "HANDOVER_PENDING")));
  const { notices, unread } = await listNotices(member.org.id, member.user.id, member.role);
  const until = member.support?.expiresAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  return (
    <div className="panel-shell">
      <Sidebar
        groups={groups}
        orgName={member.org.name}
        planLabel={planLine(member.org)}
        userName={member.support ? "Hiwar support" : member.user.name}
        roleLabel={member.support ? "Read-only" : ROLE_LABEL[member.role]}
        waiting={can(member.role, "conversations") ? waiting : 0}
      />
      <div className="panel-main">
        {member.support && (
          <div className="support-banner" role="status">
            Hiwar support · read-only · until {until}{" "}
            <form action={exitSupportAction} style={{ display: "inline" }}>
              <button className="btn link sm">Exit support access</button>
            </form>
          </div>
        )}
        <ConnectionBanner orgId={member.org.id} />
        <TopBar orgShort={member.org.name} unread={unread} notices={notices} userName={member.support ? "Hiwar support" : member.user.name} email={member.user.email} orgs={member.support ? [] : await myOrganizations(member)} owner={member.role === "owner"} />
        <main className="content">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
