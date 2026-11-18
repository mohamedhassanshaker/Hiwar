import { redirect } from "next/navigation";

import { landingPath } from "@/features/home/service";

/** The landing rule, read once per sign-in, so it is never prerendered. */
export const instant = false;

/** `UC-01.1-01` and `UC-05.1-04`: where a signed-in person lands, the dashboard. */
export default async function Home() {
  redirect(await landingPath());
}
