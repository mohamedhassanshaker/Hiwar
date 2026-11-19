import { SystemPage } from "@/features/governance/components/system-page";
import { loadSystem } from "@/features/governance/service";

/** S-78: the health of every platform service, and the pause switch. */
export default async function Page() {
  return <SystemPage state={await loadSystem()} />;
}
