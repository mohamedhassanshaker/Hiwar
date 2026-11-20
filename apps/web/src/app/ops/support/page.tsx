import { RecordTable } from "@/components/data-table";
import { activeGrants, requireOperator } from "@/server/ops";
import { openSupportAction } from "../actions";
import { SupportClient } from "./support-client";

export const metadata = { title: "Support and safety" };

/** O-Support (OPS-003, OPS-008): organizations that granted read-only support access, and their expiry. */
export default async function SupportPage() {
  await requireOperator();
  const grants = await activeGrants();
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Support and safety</h1>
          <p className="lead">Tickets, consented support access, usage disputes, AI problems, safety and abuse.</p>
        </div>
      </div>
      <SupportClient
        access={
          <>
      <p className="sm muted">Only organizations that granted access are listed. Access is read-only, and every page viewed is in the customer&apos;s audit log.</p>
      <RecordTable
        noun="support grants"
        caption="Support access grants"
        columns={[{ label: "Organization" }, { label: "Until" }, { label: "Conversations" }, { label: "Open", className: "r", sort: false }]}
        rows={grants.map((g) => ({
          key: g.id,
          cells: [
            { v: <span className="b">{g.name}</span>, s: g.name },
            { v: g.expires_at.slice(0, 16), s: g.expires_at },
            { v: g.include_conversations ? "Included" : "Not included", s: g.include_conversations ? "Included" : "Not included" },
            {
              v: (
                <form action={openSupportAction.bind(null, g.org_id)}>
                  <button className="btn outline sm">Open control panel</button>
                </form>
              ),
            },
          ],
        }))}
        empty={<p className="sm muted">No organization has granted support access.</p>}
      />
          </>
        }
      />
    </>
  );
}
