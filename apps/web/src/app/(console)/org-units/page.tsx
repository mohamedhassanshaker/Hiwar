import { OrgUnits } from "@/features/organisation/components/org-units";
import { loadOrgUnits } from "@/features/organisation/service";

/** S-42: the departments and teams people and agents belong to. */
export default async function Page() {
  const { units, options } = await loadOrgUnits();
  return <OrgUnits units={units} options={options} />;
}
