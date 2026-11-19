import { PLAN_LABEL } from "@/server/plans";
import { latestVersions, requireOperator } from "@/server/ops";
import { PlanEditor } from "./plan-editor";
import { PlansExtras } from "./plans-extras";

export const metadata = { title: "Plans and prices" };

/** O-Plans (OPS-002, OPS-006): versioned plans; changes reach the Pricing page without a release. */
export default async function PlansPage() {
  const op = await requireOperator();
  const versions = await latestVersions();
  const order = ["trial", "starter", "growth", "business", "enterprise"];
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Plans and prices</h1>
          <p className="lead">Saving creates a new version. New subscriptions use it; existing ones keep theirs until renewal.</p>
        </div>
      </div>
      {versions
        .sort((a, b) => order.indexOf(a.plan) - order.indexOf(b.plan))
        .map((v) => (
          <PlanEditor
            key={v.id}
            readOnly={op.role !== "platform_admin"}
            plan={v.plan}
            label={PLAN_LABEL[v.plan]}
            version={v.version}
            initial={{
              monthlyAed: v.monthlyAed === null ? null : Number(v.monthlyAed),
              yearlyAed: v.yearlyAed === null ? null : Number(v.yearlyAed),
              overageAed: v.overageAed === null ? null : Number(v.overageAed),
              trialDays: v.trialDays,
              limits: v.limits,
            }}
          />
        ))}
      <PlansExtras />
    </>
  );
}
