import { Settings } from "@/features/governance/components/settings";
import { loadSettings } from "@/features/governance/service";

/** S-75: the organisation, its branding and its feature flags. */
export default async function Page() {
  return <Settings settings={await loadSettings()} />;
}
