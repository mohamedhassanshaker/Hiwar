import { RecordTable } from "@/components/data-table";
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
      <RecordTable
        noun="audit entries"
        caption="Audit log entries"
        search={false}
        pageSize={50}
        columns={[{ label: "When" }, { label: "Who" }, { label: "Area" }, { label: "Action" }, { label: "Item" }, { label: "Change" }]}
        rows={rows.map((r) => ({
          key: r.id,
          cells: [
            { v: <span className="sm tnum">{when(r.createdAt)}</span>, s: r.createdAt.getTime() },
            { v: r.actorName, s: r.actorName ?? "" },
            { v: <span className="badge">{r.area}</span>, s: r.area },
            { v: r.action, s: r.action },
            { v: r.item, s: r.item ?? "" },
            { v: <span className="sm muted">{r.change}</span>, s: r.change ?? "" },
          ],
        }))}
        empty={
          <div className="empty">
            <span className="b">No entries match</span>
            <span className="sm muted">Try another filter.</span>
          </div>
        }
      />
      <p className="note-p">Only Owner and Admin roles can see this page. Exports are logged too.</p>
    </>
  );
}
