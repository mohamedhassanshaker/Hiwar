import { ROLE_LABEL } from "@/server/authz";
import { orgPlan } from "@/server/plans";
import { requireMember } from "@/server/session";
import { activeGrant, listTeam, seatsUsed } from "@/server/team";
import { TeamClient } from "./team-client";

export const metadata = { title: "Team and roles" };

/** C-Team (ORG-001, ORG-002, OPS-003 grant). */
export default async function TeamPage() {
  const member = await requireMember("team", "/team");
  const { members, invitations } = await listTeam(member.org.id);
  const { limits } = await orgPlan(member.org);
  const grant = await activeGrant(member.org.id);
  return (
    <TeamClient
      readOnly={Boolean(member.support)}
      seats={{ used: await seatsUsed(member.org.id), limit: limits.seats }}
      members={members.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
        roleLabel: ROLE_LABEL[m.role],
        twoStep: Boolean(m.twoStep),
        lastActive: m.lastActiveAt?.toISOString() ?? null,
        self: m.userId === member.user.id,
      }))}
      invitations={invitations.map((i) => ({ id: i.id, email: i.email, roleLabel: ROLE_LABEL[i.role], expires: i.expiresAt.toISOString() }))}
      security={{ require2fa: member.org.require2fa, sessionDays: member.org.sessionDays }}
      grant={grant ? { expires: grant.expiresAt.toISOString(), includeConversations: grant.includeConversations } : null}
    />
  );
}
