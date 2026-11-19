import Link from "next/link";

import { PLAN_LABEL } from "@/server/plans";
import { business, healthAlerts, requireOperator } from "@/server/ops";
import { BusinessExtras } from "./business-extras";

export const metadata = { title: "Cost and health" };

function aed(n: number): string {
  return `AED ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** O-Business (OPS-004, OPS-009): revenue, AI cost and margin; service health of the last 24 hours. Figures only. */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireOperator();
  const { range } = await searchParams;
  const days = ([7, 30, 90].includes(Number(range)) ? Number(range) : 30) as 7 | 30 | 90;
  const data = await business(days);
  const alerts = await healthAlerts();
  const totalRevenue = data.perPlan.reduce((s, p) => s + Number(p.revenue), 0);
  const totalCost = data.perPlan.reduce((s, p) => s + Number(p.cost), 0);
  const totalConversations = data.perPlan.reduce((s, p) => s + p.conversations, 0);
  const margin = totalRevenue - totalCost;
  const h = data.health;
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Cost and health</h1>
          <p className="lead">AI cost against revenue, and whether the AI and the widget are working.</p>
        </div>
        <div className="seg" role="group" aria-label="Range">
          {[7, 30, 90].map((r) => (
            <Link key={r} href={`/ops/business?range=${r}`} className={r === days ? "on" : ""} style={{ padding: "8px 12px", textDecoration: "none", color: "inherit" }} aria-current={r === days ? "true" : undefined}>
              {r} days
            </Link>
          ))}
        </div>
      </div>
      {alerts.map((a) => (
        <div key={a} className="alert" role="alert">{a}</div>
      ))}
      <div className="grid g4">
        <div className="card p-16 col gap-4"><span className="over">Revenue</span><span className="num">{aed(totalRevenue)}</span></div>
        <div className="card p-16 col gap-4"><span className="over">AI cost</span><span className="num">{aed(totalCost)}</span></div>
        <div className="card p-16 col gap-4"><span className="over">Gross margin</span><span className="num">{aed(margin)}</span><span className="xs muted">{totalRevenue ? `${Math.round((margin / totalRevenue) * 100)}%` : "No revenue yet"}</span></div>
        <div className="card p-16 col gap-4"><span className="over">AI cost per conversation</span><span className="num">{totalConversations ? aed(totalCost / totalConversations) : "—"}</span></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Per plan</caption>
          <thead><tr><th scope="col">Plan</th><th scope="col" className="r">AI conversations</th><th scope="col" className="r">Revenue</th><th scope="col" className="r">AI cost</th><th scope="col" className="r">Margin</th></tr></thead>
          <tbody>
            {data.perPlan.map((p) => (
              <tr key={p.plan}><td>{PLAN_LABEL[p.plan]}</td><td className="r tnum">{p.conversations}</td><td className="r tnum">{aed(Number(p.revenue))}</td><td className="r tnum">{aed(Number(p.cost))}</td><td className="r tnum">{aed(Number(p.revenue) - Number(p.cost))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card p-20 col gap-8">
        <h2 className="h2">Service health, last 24 hours</h2>
        <div className="grid g5 sm">
          <span>First reply median: {h?.p50 != null ? `${Number(h.p50).toFixed(1)} s` : "—"}</span>
          <span>95th percentile: {h?.p95 != null ? `${Number(h.p95).toFixed(1)} s` : "—"}</span>
          <span>Model errors: {h ? `${h.ai_failures} of ${h.ai_turns + h.ai_failures}` : "—"}</span>
          <span>Ingestion failures: {h?.ingestion_failures ?? 0}</span>
          <span>Double replies: {h?.double_replies ?? 0}</span>
        </div>
      </section>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Organizations by margin</caption>
          <thead><tr><th scope="col">Organization</th><th scope="col">Plan</th><th scope="col" className="r">AI conversations</th><th scope="col" className="r">AI cost</th><th scope="col" className="r">Revenue</th><th scope="col" className="r">Margin</th></tr></thead>
          <tbody>
            {data.perOrg.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/ops/orgs/${o.id}`}>{o.name}</Link></td>
                <td>{PLAN_LABEL[o.plan]}</td>
                <td className="r tnum">{o.conversations}</td>
                <td className="r tnum">{aed(Number(o.cost))}</td>
                <td className="r tnum">{aed(Number(o.revenue))}</td>
                <td className={Number(o.revenue) - Number(o.cost) < 0 ? "r tnum c-danger" : "r tnum"}>{aed(Number(o.revenue) - Number(o.cost))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BusinessExtras />
    </>
  );
}
