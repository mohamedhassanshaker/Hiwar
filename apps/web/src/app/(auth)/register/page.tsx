import { connection } from "next/server";
import { redirect } from "next/navigation";

import { Register } from "@/features/auth/components/register";
import { pendingUaePass, registrationUnits, uaePassConfigured } from "@/features/auth/service";
import { landingPath } from "@/features/home/service";
import { publicLogos } from "@/features/governance/service";
import { getSession } from "@/lib/session";

/** Rendered per request: it reads the session and the UAE PASS account waiting in this browser. */
export const instant = false;

/** S-05, D393: Create an account, with a password or with UAE PASS. */
export default async function Page() {
  await connection();
  if (await getSession()) redirect(await landingPath());
  return <Register uaePass={uaePassConfigured()} uaePassName={await pendingUaePass()} units={await registrationUnits()} logos={await publicLogos()} />;
}
