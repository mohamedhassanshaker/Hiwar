import { Docs } from "@/features/governance/components/docs";
import { loadDocs } from "@/features/governance/service";

/** S-79: the documentation pages. */
export default async function Page() {
  return <Docs pages={await loadDocs()} />;
}
