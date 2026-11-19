import { billingSummary } from "@/server/billing";
import { providerHosted } from "@/server/payments";
import { PLAN_LABEL } from "@/server/plans";
import { requireMember } from "@/server/session";
import { BillingClient } from "./billing-client";

export const metadata = { title: "Plan and usage" };

/** C-Billing (BIL-001). Owner and Billing only (FR-024). */
export default async function BillingPage() {
  const member = await requireMember("billing", "/billing");
  const s = await billingSummary(member.org);
  const org = member.org;
  return (
    <BillingClient
      readOnly={Boolean(member.support)}
      plan={s.plan}
      planLabel={PLAN_LABEL[s.plan]}
      status={s.status}
      trialDaysLeft={s.trialDaysLeft}
      scheduled={org.scheduledPlan ? { plan: PLAN_LABEL[org.scheduledPlan], at: org.scheduledPlanAt!.toISOString() } : null}
      interval={org.billingInterval}
      period={{ start: s.period.start.toISOString(), end: s.period.end.toISOString() }}
      meters={s.meters}
      overage={s.overage}
      limits={{ limitBehaviour: org.limitBehaviour, overageCapAed: Number(org.overageCapAed), alertFirst: org.alertFirst, alertSecond: org.alertSecond }}
      plans={s.plans.map((p) => ({ plan: p.plan, label: PLAN_LABEL[p.plan], monthly: p.monthlyAed, yearly: p.yearlyAed, overage: p.overageAed, limits: p.limits }))}
      invoices={s.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        period: `${i.periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${new Date(i.periodEnd.getTime() - 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
        total: i.totalAed,
        status: i.status,
      }))}
      card={org.paymentCard ?? null}
      paymentFailed={Boolean(org.paymentFailedAt)}
      providerHosted={providerHosted()}
    />
  );
}
