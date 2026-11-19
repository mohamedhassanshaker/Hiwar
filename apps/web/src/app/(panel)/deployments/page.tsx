import { redirect } from "next/navigation";

import { listAgents } from "@/server/agents";
import { listDeployments } from "@/server/deployments";
import { requireMember } from "@/server/session";
import { NewDeployment } from "./new-deployment";

export const metadata = { title: "Deployments" };

export default async function DeploymentsIndex() {
  const member = await requireMember("manage_deployments", "/deployments");
  const rows = await listDeployments(member.org.id);
  if (rows.length > 0) redirect(`/deployments/${rows[0].d.id}`);
  const agents = await listAgents(member.org.id);
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Deployments</h1>
          <p className="lead">Install an agent on a website and control where and how it runs.</p>
        </div>
      </div>
      <div className="empty">
        <span className="b">No deployments yet</span>
        <span className="sm muted">{agents.length ? "Create a deployment for one of your agents." : "Create an agent first."}</span>
        {agents.length > 0 && !member.support && <NewDeployment agents={agents.map((a) => ({ id: a.id, name: a.draft.name }))} />}
      </div>
    </>
  );
}
