import { Budgets } from "@/features/budgets/components/budgets";
import { loadBudgets } from "@/features/budgets/service";

/** S-71 and S-72: the agent budgets and their estimated costs, and the history of the one `?budget=` names. */
export default async function Page({ searchParams }: { searchParams: Promise<{ budget?: string }> }) {
  const { budget } = await searchParams;
  const { budgets, details, counts, routes } = await loadBudgets(budget);
  return <Budgets budgets={budgets} details={details} counts={counts} routes={routes} />;
}
