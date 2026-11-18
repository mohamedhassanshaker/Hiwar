import { Guide } from "@/components/guide/guide";
import { requireSession } from "@/lib/session";

/** The user guide: the scenarios of `docs/02-product-requirements/flows.md`, with pictures of the product. */
export default async function Page() {
  // Open to everybody who is signed in, like the Documentation screen it sits beside.
  await requireSession();
  return <Guide />;
}
