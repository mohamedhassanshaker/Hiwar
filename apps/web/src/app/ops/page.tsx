import Link from "next/link";

import { PLAN_LABEL } from "@/server/plans";
import { listOrganizations, requireOperator } from "@/server/ops";
import { RecordTable } from "@/components/data-table";
import { TenantsClient } from "./tenants-client";

export const metadata = { title: "Organizations" };

const STATUS: Record<string, [string, string]> = {
  trial: ["ai", "Trial"],
  active: ["ok", "Active"],
  past_due: ["warn", "Past due"],
  suspended: ["bad", "Suspended"],
  trial_ended: ["mut", "Trial ended"],
};

/** O-Tenants (OPS-001, OPS-005). */
export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string; plan?: string; status?: string }> }) {
  await requireOperator();
  const sp = await searchParams;
  const rows = await listOrganizations(sp);
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Organizations</h1>
          <p className="lead">Every customer organization, its plan, status and usage this month.</p>
        </div>
      </div>
      <TenantsClient
        realList={
        <div className="col gap-12">
          <form className="row gap-8 dt-tools" action="/ops">
            <label className="sr-only" htmlFor="oq">Search</label>
            <input id="oq" name="q" type="search" className="input" placeholder="Name or owner email" defaultValue={sp.q} />
            <label className="sr-only" htmlFor="op">Plan</label>
            <select id="op" name="plan" className="select" defaultValue={sp.plan ?? ""}>
              <option value="">All plans</option>
              {Object.entries(PLAN_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="os">Status</label>
            <select id="os" name="status" className="select" defaultValue={sp.status ?? ""}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([k, [, v]]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button className="btn outline">Filter</button>
          </form>
          <RecordTable
            noun="organizations"
            caption="Organizations"
            search={false}
            columns={[{ label: "Organization" }, { label: "Owner" }, { label: "Plan" }, { label: "Status" }, { label: "AI conversations this month", className: "r" }, { label: "Created" }]}
            rows={rows.map((r) => ({
              key: r.id,
              cells: [
                { v: <Link href={`/ops/orgs/${r.id}`} className="b">{r.name}</Link>, s: r.name },
                { v: r.owner ?? "—", s: r.owner ?? "" },
                { v: PLAN_LABEL[r.plan], s: PLAN_LABEL[r.plan] },
                { v: <span className={`stt ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span>, s: STATUS[r.status][1] },
                { v: <span className="tnum">{r.used} of {r.allowance.toLocaleString("en-US")}</span>, s: r.used },
                { v: <span className="sm muted">{r.created_at.slice(0, 10)}</span>, s: r.created_at },
              ],
            }))}
            empty={<p className="sm muted">No organization matches. Change the search or the filters.</p>}
          />
        </div>
        }
      />
    </>
  );
}
