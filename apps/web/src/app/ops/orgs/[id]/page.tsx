import { notFound } from "next/navigation";

import { PLAN_LABEL } from "@/server/plans";
import { organizationDetail, requireOperator } from "@/server/ops";
import { OrgActions } from "./org-actions";

export const metadata = { title: "Organization" };

/** O-Tenants detail (OPS-001). Read-only for Support operators; no conversation content (FR-005). */
export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const op = await requireOperator();
  const { id } = await params;
  const detail = await organizationDetail(id);
  if (!detail) notFound();
  const { org, counts, deployments, actions, grant } = detail;
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">{org.name}</h1>
          <p className="lead">
            {PLAN_LABEL[org.plan]} · {org.status.replace("_", " ")}
            {org.status === "trial" && ` · trial ends ${day(org.trialEndsAt)}`}
            {org.renewsAt && ` · renews ${day(org.renewsAt)}`}
          </p>
        </div>
      </div>
      <div className="grid g4">
        <div className="card p-16 col gap-4"><span className="over">AI conversations</span><span className="num">{counts.used}</span><span className="xs muted">this month</span></div>
        <div className="card p-16 col gap-4"><span className="over">Members</span><span className="num">{counts.members}</span></div>
        <div className="card p-16 col gap-4"><span className="over">Deployments</span><span className="num">{deployments.length}</span></div>
        <div className="card p-16 col gap-4"><span className="over">Payment</span><span className="sm">{org.paymentCard ? `${org.paymentCard.brand} ending ${org.paymentCard.last4}` : "No card"}{org.paymentFailedAt ? " · failed" : ""}</span></div>
      </div>
      <section className="card p-20 col gap-8">
        <h2 className="h2">Deployments</h2>
        {deployments.map((d) => (
          <div key={d.id} className="row between sm">
            <span className="b">{d.name}</span>
            <span>{d.status}</span>
            <span className="muted">{d.origins.map((o) => `${o.origin}${o.verifiedAt ? " ✓" : ""}`).join(", ") || "No origins"}</span>
          </div>
        ))}
        {deployments.length === 0 && <span className="sm muted">None.</span>}
      </section>
      {op.role === "platform_admin" && <OrgActions orgId={org.id} status={org.status} plan={org.plan} />}
      <section className="card p-20 col gap-8">
        <h2 className="h2">Operator actions</h2>
        {grant && <p className="note-p">Support access granted until {grant.expiresAt.toISOString().slice(0, 16).replace("T", " ")}.</p>}
        {actions.map((a) => (
          <div key={a.id} className="row between sm">
            <span>{a.action}</span>
            <span className="muted">{a.operatorName} · {a.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {a.reason}</span>
          </div>
        ))}
        {actions.length === 0 && <span className="sm muted">No operator actions yet.</span>}
      </section>
    </>
  );
}
