import Link from "next/link";

import { PLAN_LABEL } from "@/server/plans";
import { listOrganizations, requireOperator } from "@/server/ops";
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
          <>
        <form className="row gap-8" action="/ops">
          <label className="sr-only" htmlFor="oq">Search</label>
          <input id="oq" name="q" className="input" placeholder="Name or owner email" defaultValue={sp.q} />
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
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Organization</th>
              <th scope="col">Owner</th>
              <th scope="col">Plan</th>
              <th scope="col">Status</th>
              <th scope="col" className="r">AI conversations this month</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/ops/orgs/${r.id}`} className="b">{r.name}</Link></td>
                <td>{r.owner ?? "—"}</td>
                <td>{PLAN_LABEL[r.plan]}</td>
                <td><span className={`stt ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span></td>
                <td className="r tnum">{r.used} of {r.allowance.toLocaleString("en-US")}</td>
                <td className="sm muted">{r.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
          </>
        }
      />
    </>
  );
}
