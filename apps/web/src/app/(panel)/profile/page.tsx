import { Profile } from "@/components/profile";
import { ROLE_LABEL } from "@/server/authz";
import { myOrganizations, mySessions } from "@/server/profile";
import { requireMember } from "@/server/session";

export const metadata = { title: "My profile" };

const NOTICES: Record<string, [string, string][]> = {
  owner: [["Invoices and payments", ""], ["Usage warnings", "At 80% and 100% of AI conversations"], ["Overage notices", "At 50%, 80% and 100% of the cap"], ["Support access requests", ""]],
  admin: [["Usage warnings", "At 80% and 100% of AI conversations"], ["Write tools waiting for approval", "Right away"], ["Knowledge sources that failed", ""]],
  builder: [["Knowledge sources that failed", ""], ["Unanswered questions", "Daily summary"]],
  support: [["Conversations waiting for a person", "Right away"], ["Write tools waiting for approval", "Right away"]],
  analyst: [["Weekly analytics summary", "Mondays"]],
};

/** My profile for a member of an organization (PLT-009). */
export default async function ProfilePage() {
  const m = await requireMember(undefined, "/profile");
  const [orgs, sessions] = await Promise.all([myOrganizations(m), mySessions(m)]);
  return (
    <Profile
      name={m.user.name}
      email={m.user.email}
      role={`${ROLE_LABEL[m.role]} · ${m.org.name}`}
      orgs={orgs}
      totp={!!m.user.totpEnabledAt}
      totpRequired={m.org.require2fa}
      sessions={sessions}
      notices={NOTICES[m.role] ?? []}
      payOrg={m.role === "owner" ? m.org.name : undefined}
    />
  );
}
