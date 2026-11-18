import { Dashboard } from "@/features/home/components/dashboard";
import { loadDashboard } from "@/features/home/service";

/** S-10: what needs attention today, computed from the database. */
export default async function Page() {
  return <Dashboard data={await loadDashboard()} />;
}
