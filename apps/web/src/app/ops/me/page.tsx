import { Profile } from "@/components/profile";
import { getSession } from "@/server/session";
import { mySessions } from "@/server/profile";
import { requireOperator } from "@/server/ops";

export const metadata = { title: "My profile" };

/** O-Me: an operator's own profile (PLT-009). */
export default async function OperatorProfilePage() {
  const op = await requireOperator();
  const s = (await getSession())!;
  return (
    <Profile
      name={s.user.name}
      email={s.user.email}
      role={`Hiwar · ${op.role === "platform_admin" ? "Platform admin" : "Support operator"}`}
      orgs={[]}
      totp={!!s.user.totpEnabledAt}
      totpRequired
      sessions={await mySessions(s)}
      notices={[["Urgent safety concerns", "Always on"], ["Escalated tickets", ""], ["Failed payments", "Right away"]]}
      operator
    />
  );
}
