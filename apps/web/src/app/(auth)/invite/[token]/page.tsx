import { connection } from "next/server";

import { Invitation } from "@/features/auth/components/invitation";
import { invitationForToken } from "@/features/organisation/service";
import { publicLogos } from "@/features/governance/service";

/** The page reads a token, so it is never prerendered. */
export const instant = false;

/** D248 and D387: the page an invitation email links to; an open invitation is accepted by choosing a password. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const invitation = await invitationForToken(token);

  return (
    <Invitation
      token={token}
      state={invitation?.state ?? "Unknown"}
      name={invitation ? { en: invitation.nameEn, ar: invitation.nameAr } : null}
      email={invitation?.email ?? null}
      logos={await publicLogos()}
    />
  );
}
