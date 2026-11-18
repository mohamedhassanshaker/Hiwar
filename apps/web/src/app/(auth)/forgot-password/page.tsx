import { connection } from "next/server";

import { ForgotPassword } from "@/features/auth/components/forgot-password";
import { publicLogos } from "@/features/governance/service";

/** Rendered per request, like the other screens before sign-in. */
export const instant = false;

/** D387: Forgot password. */
export default async function Page() {
  await connection();
  return <ForgotPassword logos={await publicLogos()} />;
}
