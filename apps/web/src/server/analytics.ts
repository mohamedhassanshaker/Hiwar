import { sql } from "drizzle-orm";

import { db } from "@/db";
import { REASON_TEXT } from "./inbox";
import { questionKey } from "./knowledge";

/** ANA-001. Test-console turns never create conversations, so they are never counted (FR-017). */

export type Range = 7 | 30 | 90;
export type Dimension = "deployment" | "agent" | "language";

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

/**
 * FR-009 (D-014): resolved by the AI = closed (by staff, the visitor or auto-close) with no
 * handover, no "No" feedback, no repeated visitor question, and not reopened within 24 hours.
 * A conversation closed less than 24 hours ago is not yet counted either way.
 */
const RESOLVED = sql`c.state = 'CLOSED' AND c.closed_at < now() - interval '24 hours' AND NOT c.handed_over AND coalesce(c.feedback, '') <> 'no' AND NOT c.repeated_question
  AND NOT EXISTS (SELECT 1 FROM ownership_events e WHERE e.conversation_id = c.id AND e.reason_code = 'reopened')`;

async function kpis(orgId: string, from: Date, to: Date) {
  const [k] = await rows<{
    conversations: number;
    resolved: number;
    decided: number;
    reached: number;
    first_reply: number | null;
    wait: number | null;
    double_replies: number;
  }>(sql`
    WITH c AS (SELECT * FROM conversations WHERE org_id = ${orgId} AND started_at >= ${from} AND started_at < ${to}),
    firsts AS (
      SELECT c.id,
        (SELECT min(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'visitor') AS v,
        (SELECT min(m2.created_at) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.kind IN ('ai','staff')
           AND m2.created_at > (SELECT min(created_at) FROM messages m3 WHERE m3.conversation_id = c.id AND m3.kind = 'visitor')) AS r
      FROM c),
    waits AS (
      SELECT req.created_at AS asked,
        (SELECT min(e2.created_at) FROM ownership_events e2 WHERE e2.conversation_id = req.conversation_id AND e2.created_at > req.created_at
           AND (e2.event LIKE '%claimed it' OR e2.event LIKE '%took over')) AS answered
      FROM ownership_events req JOIN c ON c.id = req.conversation_id WHERE req.event = 'Handover requested'),
    seq AS (
      SELECT m.kind, lag(m.kind) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_kind
      FROM messages m JOIN c ON c.id = m.conversation_id WHERE m.kind IN ('visitor','ai','staff'))
    SELECT
      (SELECT count(*) FROM c)::int AS conversations,
      (SELECT count(*) FROM c WHERE ${RESOLVED})::int AS resolved,
      (SELECT count(*) FROM c WHERE c.state = 'CLOSED' AND c.closed_at < now() - interval '24 hours' OR c.handed_over)::int AS decided,
      (SELECT count(*) FROM c WHERE c.handed_over)::int AS reached,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r - v)) FROM firsts WHERE r IS NOT NULL) AS first_reply,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM answered - asked)) FROM waits WHERE answered IS NOT NULL) AS wait,
      (SELECT count(*) FROM seq WHERE kind = 'ai' AND prev_kind = 'staff')::int AS double_replies`);
  return k;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds % 60)} s`;
}

function pct(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

export async function dashboard(orgId: string, range: Range, dimension: Dimension) {
  const to = new Date();
  const from = new Date(to.getTime() - range * 86_400_000);
  const prevFrom = new Date(from.getTime() - range * 86_400_000);
  const [now, prev] = await Promise.all([kpis(orgId, from, to), kpis(orgId, prevFrom, from)]);

  const delta = (a: number, b: number, unit: "%" | "points" | "s") => {
    if (unit === "%") return b ? `${Math.round(((a - b) / b) * 100)}% vs the period before` : "No earlier data";
    if (unit === "points") return `${Math.abs(a - b)} points ${a >= b ? "up" : "down"}`;
    return "";
  };
  const resolvedPct = pct(now.resolved, now.decided);
  const reachedPct = pct(now.reached, now.conversations);
  const kpiCards = [
    { k: "Conversations", v: now.conversations.toLocaleString("en-US"), d: delta(now.conversations, prev.conversations, "%") },
    { k: "Resolved by the AI", v: `${resolvedPct}%`, d: delta(resolvedPct, pct(prev.resolved, prev.decided), "points") },
    { k: "Reached a person", v: `${reachedPct}%`, d: delta(reachedPct, pct(prev.reached, prev.conversations), "points") },
    { k: "First reply", v: duration(now.first_reply), d: "AI and people together" },
    { k: "Wait for a person", v: duration(now.wait), d: "Median, staffed hours" },
    { k: "Double replies", v: String(now.double_replies), d: "AI and person in one turn" },
  ];

  const days = await rows<{ day: string; ai: number; person: number }>(sql`
    SELECT to_char(d, 'Dy DD') AS day,
      count(c.id) FILTER (WHERE c.id IS NOT NULL AND NOT c.handed_over)::int AS ai,
      count(c.id) FILTER (WHERE c.handed_over)::int AS person
    FROM generate_series(date_trunc('day', ${from}::timestamptz), date_trunc('day', now()), interval '1 day') d
    LEFT JOIN conversations c ON c.org_id = ${orgId} AND date_trunc('day', c.started_at) = d
    GROUP BY d ORDER BY d`);

  const key =
    dimension === "deployment"
      ? sql`dp.name`
      : dimension === "agent"
        ? sql`(SELECT a.draft->>'name' FROM agents a WHERE a.id = c.agent_id)`
        : sql`CASE WHEN c.visitor->>'language' = 'ar' THEN 'Arabic' ELSE 'English' END`;
  const breakdown = await rows<{ name: string; conversations: number; resolved: number; reached: number; cost: string | null }>(sql`
    SELECT ${key} AS name, count(*)::int AS conversations,
      count(*) FILTER (WHERE ${RESOLVED})::int AS resolved,
      count(*) FILTER (WHERE c.handed_over)::int AS reached,
      (SELECT avg(u.cost_aed) FROM usage_events u WHERE u.conversation_id = ANY(array_agg(c.id)))::text AS cost
    FROM conversations c JOIN deployments dp ON dp.id = c.deployment_id
    WHERE c.org_id = ${orgId} AND c.started_at >= ${from}
    GROUP BY 1 ORDER BY 2 DESC`);

  const reasons = await rows<{ code: string; n: number }>(sql`
    SELECT e.reason_code AS code, count(*)::int AS n FROM ownership_events e JOIN conversations c ON c.id = e.conversation_id
    WHERE c.org_id = ${orgId} AND e.event = 'Handover requested' AND e.created_at >= ${from}
    GROUP BY 1 ORDER BY 2 DESC`);
  const totalReasons = reasons.reduce((s, r) => s + r.n, 0);

  const firstQuestions = await rows<{ text: string }>(sql`
    SELECT (SELECT m.text FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'visitor' ORDER BY m.created_at LIMIT 1) AS text
    FROM conversations c WHERE c.org_id = ${orgId} AND c.started_at >= ${from}`);
  const grouped = new Map<string, { q: string; n: number }>();
  for (const { text } of firstQuestions) {
    if (!text) continue;
    const k = questionKey(text);
    const entry = grouped.get(k) ?? { q: text, n: 0 };
    entry.n += 1;
    grouped.set(k, entry);
  }
  const tops = [...grouped.values()].sort((a, b) => b.n - a.n).slice(0, 5);

  return {
    kpis: kpiCards,
    days,
    breakdown: breakdown.map((b) => ({
      name: b.name,
      conversations: b.conversations,
      resolved: `${pct(b.resolved, b.conversations)}%`,
      reached: `${pct(b.reached, b.conversations)}%`,
      cost: b.cost ? `AED ${Number(b.cost).toFixed(2)}` : "—",
    })),
    reasons: reasons.map((r) => ({ label: REASON_TEXT[r.code] ?? "Other", p: pct(r.n, totalReasons) })),
    tops,
  };
}

/** FR-013: the CSV export of one range, one row per conversation. */
export async function exportRows(orgId: string, range: Range) {
  const from = new Date(Date.now() - range * 86_400_000);
  return rows<Record<string, string>>(sql`
    SELECT c.started_at::text AS started, dp.name AS deployment, (SELECT a.draft->>'name' FROM agents a WHERE a.id = c.agent_id) AS agent,
      c.visitor->>'language' AS language, c.state::text AS state, c.handed_over::text AS reached_a_person,
      (${RESOLVED})::text AS resolved_by_ai, coalesce(c.reason_code, '') AS reason_code, coalesce(c.feedback, '') AS feedback,
      coalesce((SELECT u.cost_aed::text FROM usage_events u WHERE u.conversation_id = c.id), '0') AS cost_aed
    FROM conversations c JOIN deployments dp ON dp.id = c.deployment_id
    WHERE c.org_id = ${orgId} AND c.started_at >= ${from} ORDER BY c.started_at`);
}
