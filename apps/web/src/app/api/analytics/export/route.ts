import type { NextRequest } from "next/server";

import { exportRows, type Range } from "@/server/analytics";
import { handle } from "@/server/api";
import { audit } from "@/server/audit";
import { toCsv } from "@/server/audit-log";
import { apiMember } from "@/server/session";

/** ANA-001 FR-013: Owner, Admin and Analyst only; the export is recorded in the audit log. */
export const GET = handle(async (request: NextRequest) => {
  const member = await apiMember("export_analytics");
  const asked = Number(request.nextUrl.searchParams.get("range"));
  const range = ([7, 30, 90].includes(asked) ? asked : 30) as Range;
  const rows = await exportRows(member.org.id, range);
  if (!member.support) {
    await audit({
      orgId: member.org.id,
      actorUserId: member.user.id,
      actorName: member.user.name,
      area: "Exports",
      action: "Exported conversations",
      item: `Last ${range} days`,
      change: `CSV · ${rows.length} rows`,
    });
  }
  const header = ["started", "deployment", "agent", "language", "state", "reached_a_person", "resolved_by_ai", "reason_code", "feedback", "cost_aed"];
  return new Response(toCsv(header, rows.map((r) => header.map((h) => String(r[h] ?? "")))), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hiwar-conversations-${range}d.csv"` },
  });
});
