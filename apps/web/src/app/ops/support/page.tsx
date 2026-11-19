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
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Organization</th>
              <th scope="col">Until</th>
              <th scope="col">Conversations</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="b">{g.name}</td>
                <td>{g.expires_at.slice(0, 16)}</td>
                <td>{g.include_conversations ? "Included" : "Not included"}</td>
                <td className="r">
                  <form action={openSupportAction.bind(null, g.org_id)}>
                    <button className="btn outline sm">Open control panel</button>
                  </form>
                </td>
              </tr>
            ))}
            {grants.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">No organization has granted support access.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
          </>
        }
      />
    </>
  );
}
