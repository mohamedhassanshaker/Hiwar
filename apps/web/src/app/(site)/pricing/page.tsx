import { latestPlanVersion } from "@/server/plans";
import { PricingClient } from "./pricing-client";

export const metadata = { title: "Pricing" };

/** W-Pricing (WEB-002). Prices and limits come from the plan versions (OPS-002 FR-005). */
export default async function PricingPage() {
  const plans = await Promise.all((["starter", "growth", "business", "enterprise"] as const).map((p) => latestPlanVersion(p)));
  const trial = await latestPlanVersion("trial");
  return (
    <PricingClient
      trial={{ days: trial.trialDays ?? 14, conversations: trial.limits.aiConversations }}
      plans={plans.map((p) => ({ plan: p.plan as "starter" | "growth" | "business" | "enterprise", monthly: p.monthlyAed, yearly: p.yearlyAed, overage: p.overageAed, limits: p.limits }))}
    />
  );
}
