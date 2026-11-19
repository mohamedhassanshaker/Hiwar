import Link from "next/link";

import { dashboard, type Dimension, type Range } from "@/server/analytics";
import { analyticsLimited, can } from "@/server/authz";
import { requireMember } from "@/server/session";
import { AnalyticsControls } from "./controls";

export const metadata = { title: "Analytics" };

const DIM_LABEL: Record<Dimension, string> = { deployment: "Deployment", agent: "Agent", language: "Language" };

/** C-Analytics (ANA-001). Support Agents get the limited view: no cost, no export (FR-016). */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; by?: string }> }) {
  const member = await requireMember("analytics", "/analytics");
  const sp = await searchParams;
  const range = ([7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30) as Range;
  const by = (["deployment", "agent", "language"].includes(sp.by ?? "") ? sp.by : "deployment") as Dimension;
  const data = await dashboard(member.org.id, range, by);
  const limited = analyticsLimited(member.role);
  const max = Math.max(1, ...data.days.map((d) => d.ai + d.person));
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Analytics</h1>
          <p className="lead">How your agents and team are doing. Cost is shown per conversation so pricing stays predictable.</p>
        </div>
        <AnalyticsControls range={range} by={by} canExport={can(member.role, "export_analytics") && !limited} />
      </div>
      <div className="grid g6">
        {data.kpis.map((k) => (
          <div key={k.k} className="card p-16 col gap-4">
            <span className="over">{k.k}</span>
            <span className="num">{k.v}</span>
            <span className="xs muted">{k.d}</span>
          </div>
        ))}
      </div>
      <div className="split">
        <div className="wide col gap-16">
          <section className="card p-20 col gap-12" aria-labelledby="cpd">
            <div className="row between">
              <div className="col gap-2">
                <h2 className="h2" id="cpd">Conversations per day</h2>
                <span className="sm muted">Handled by the AI and by your team</span>
              </div>
              <div className="row gap-12 xs">
                <span className="row gap-4">
                  <span className="legend-dot" style={{ background: "#4338ca" }} />
                  AI only
                </span>
                <span className="row gap-4">
                  <span className="legend-dot" style={{ background: "#14b8a6" }} />
                  With a person
                </span>
              </div>
            </div>
            <div role="img" aria-label="Conversations per day" className="row gap-4 nw" style={{ alignItems: "flex-end", height: 170, overflowX: "auto" }}>
              {data.days.map((d) => (
                <div key={d.day} className="col gap-0" style={{ alignItems: "center", flex: "1 0 16px" }} title={`${d.day}: ${d.ai} AI only, ${d.person} with a person`}>
                  <span style={{ width: 14, height: (d.person / max) * 130, background: "#14b8a6", borderRadius: "3px 3px 0 0" }} />
                  <span style={{ width: 14, height: (d.ai / max) * 130, background: "#4338ca" }} />
                  {range <= 30 && <span className="xs muted">{d.day.slice(4)}</span>}
                </div>
              ))}
            </div>
          </section>
          <section className="card p-20 col gap-12" aria-labelledby="bd">
            <div className="row between">
              <h2 className="h2" id="bd">
                Breakdown
              </h2>
              <AnalyticsControls range={range} by={by} only="dimension" canExport={false} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{DIM_LABEL[by]}</th>
                    <th scope="col" className="r">Conversations</th>
                    <th scope="col" className="r">Resolved by AI</th>
                    <th scope="col" className="r">Reached a person</th>
                    {!limited && <th scope="col" className="r">Cost per conversation</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td className="r tnum">{r.conversations}</td>
                      <td className="r tnum">{r.resolved}</td>
                      <td className="r tnum">{r.reached}</td>
                      {!limited && <td className="r tnum">{r.cost}</td>}
                    </tr>
                  ))}
                  {data.breakdown.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No conversations in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="narrow">
          <section className="card p-20 col gap-12" aria-labelledby="why">
            <div className="col gap-2">
              <h2 className="h2" id="why">
                Why chats reached a person
              </h2>
              <span className="sm muted">Reason codes</span>
            </div>
            {data.reasons.length === 0 && <span className="sm muted">No handovers in this range.</span>}
            {data.reasons.map((r) => (
              <div key={r.label} className="col gap-4">
                <div className="row between sm">
                  <span>{r.label}</span>
                  <span className="tnum">{r.p}%</span>
                </div>
                <div className="progress">
                  <span style={{ display: "block", height: "100%", width: `${r.p}%`, background: "#4338ca" }} />
                </div>
              </div>
            ))}
          </section>
          <section className="card p-20 col gap-8" aria-labelledby="tq">
            <h2 className="h2" id="tq">
              Top questions
            </h2>
            {data.tops.map((q) => (
              <div key={q.q} className="row between sm">
                <span dir="auto" className="trunc" style={{ maxWidth: 220 }}>
                  {q.q}
                </span>
                <span className="tnum muted">{q.n}</span>
              </div>
            ))}
            {can(member.role, "manage_agents") && (
              <Link href="/knowledge?view=unanswered" className="sm">
                See unanswered questions
              </Link>
            )}
          </section>
          <p className="note-p">
            &quot;Resolved by the AI&quot; means the chat closed, on its own or after a quiet period, with no handover, no negative
            feedback and no repeated question, and was not reopened within 24 hours.
          </p>
        </div>
      </div>
    </>
  );
}
