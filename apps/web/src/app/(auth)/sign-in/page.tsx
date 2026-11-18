import { connection } from "next/server";
import { redirect } from "next/navigation";

import { SignIn } from "@/features/auth/components/sign-in";
import { pendingUaePass, uaePassConfigured } from "@/features/auth/service";
import { landingPath } from "@/features/home/service";
import { publicLogos } from "@/features/governance/service";
import { getSession } from "@/lib/session";

/** The sign-in page reads the session cookie, so it is never prerendered. */
export const instant = false;

/** S-05 entry point (D387): email and password, Forgot password, and UAE PASS when it is set up. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reset?: string; registered?: string }> }) {
  await connection();
  const session = await getSession();
  if (session) redirect(await landingPath());
  const { next, error, reset, registered } = await searchParams;

  return (
    <SignIn
      error={error}
      notice={reset === "done" ? "reset" : registered === "done" ? "registered" : undefined}
      linking={await pendingUaePass()}
      uaePass={uaePassConfigured()}
      next={next}
      logos={await publicLogos()}
    />
  );
}
