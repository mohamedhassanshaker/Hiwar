import { AREAS, listAudit } from "@/server/audit-log";
import { requireMember } from "@/server/session";
import { AuditFilters } from "./filters";

export const metadata = { title: "Audit log" };

function when(d: Date): string {
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/** C-Audit (ORG-003). Read-only: there is no edit or delete anywhere. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ area?: string; q?: string }> }) {
  const member = await requireMember("audit", "/audit");
  const { area = "All", q = "" } = await searchParams;
  const rows = await listAudit(member.org.id, area, q);
  const exportHref = `/api/audit/export?area=${encodeURIComponent(area)}&q=${encodeURIComponent(q)}`;
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Audit log</h1>
          <p className="lead">Every change to users, agents, tools, deployments, exports and deletions. Entries cannot be edited or removed.</p>
        </div>
        <AuditFilters areas={[...AREAS]} area={area} q={q} exportHref={exportHref} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Audit log entries</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Area</th>
              <th scope="col">Action</th>
              <th scope="col">Item</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="sm tnum">{when(r.createdAt)}</td>
                <td>{r.actorName}</td>
                <td>
                  <span className="badge">{r.area}</span>
                </td>
                <td>{r.action}</td>
                <td>{r.item}</td>
                <td className="sm muted">{r.change}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="b">No entries match</span>
                    <span className="sm muted">Try another filter.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note-p">Only Owner and Admin roles can see this page. Exports are logged too.</p>
    </>
  );
}
