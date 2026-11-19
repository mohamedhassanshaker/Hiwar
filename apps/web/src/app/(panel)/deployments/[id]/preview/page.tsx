import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db, schema } from "@/db";
import { requireMember } from "@/server/session";

export const metadata = { title: "Widget preview" };

/** C-Widget: the visitor experience of this deployment on a mock page. It talks to the real deployment. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember("manage_deployments", "/deployments");
  const d = await db.query.deployments.findFirst({ where: and(eq(schema.deployments.id, id), eq(schema.deployments.orgId, member.org.id)) });
  if (!d) notFound();
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Widget preview</h1>
          <p className="lead">The visitor experience of {d.name}. Messages here are real conversations and appear in the inbox.</p>
        </div>
        <Link className="btn outline" href={`/deployments/${d.id}`}>Back to the deployment</Link>
      </div>
      {d.status !== "live" && <p className="note-p">This deployment is {d.status}, so the widget shows the offline message. Make it live to chat.</p>}
      <div className="split">
        <div className="wide card p-24 col gap-12" aria-hidden="true">
          <span className="over">{member.org.name}</span>
          <h2 className="h1">Your website</h2>
          <p className="lead">The chat opens at the bottom {d.settings.position} of every page that has the snippet.</p>
        </div>
        <div className="narrow" style={{ flexBasis: 400 }}>
          <iframe title="Chat widget preview" src={`/embed/${d.publicKey}?preview=1`} style={{ width: "100%", height: 620, border: 0, borderRadius: 16, boxShadow: "0 16px 48px rgba(27,31,75,.22)" }} />
        </div>
      </div>
    </>
  );
}
