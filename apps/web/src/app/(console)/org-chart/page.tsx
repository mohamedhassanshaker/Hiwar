import { OrgChart } from "@/features/organisation/components/org-chart";
import { loadOrgChart } from "@/features/organisation/service";

/** S-40: people and agents in one hierarchy. */
export default async function Page() {
  return <OrgChart nodes={await loadOrgChart()} />;
}
