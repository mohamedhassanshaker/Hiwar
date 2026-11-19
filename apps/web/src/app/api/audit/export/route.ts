import type { NextRequest } from "next/server";

import { handle } from "@/server/api";
import { audit } from "@/server/audit";
import { listAudit, toCsv } from "@/server/audit-log";
import { apiMember } from "@/server/session";

/** ORG-003 FR-008, FR-011: CSV of the filtered entries; the export itself is logged. */
export const GET = handle(async (request: NextRequest) => {
  const member = await apiMember("export_audit");
  const area = request.nextUrl.searchParams.get("area") ?? "All";
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const rows = await listAudit(member.org.id, area, q, 50_000);
  if (!member.support) {
    await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Exports", action: "Exported the audit log", item: area === "All" ? "All areas" : area, change: `CSV · ${rows.length} rows` });
  }
  const csv = toCsv(
    ["When", "Who", "Area", "Action", "Item", "Change"],
    rows.map((r) => [r.createdAt.toISOString(), r.actorName, r.area, r.action, r.item, r.change]),
  );
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log.csv"` },
  });
});
