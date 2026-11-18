import { connection } from "next/server";

import { ResetPassword } from "@/features/auth/components/reset-password";
import { resetLinkIsOpen } from "@/features/auth/service";
import { publicLogos } from "@/features/governance/service";

/** The page reads a token, so it is never prerendered. */
export const instant = false;

/** D387: the page a Forgot password email links to. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  return <ResetPassword token={token} open={await resetLinkIsOpen(token)} logos={await publicLogos()} />;
}
