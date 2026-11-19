"use client";

import { useRouter } from "next/navigation";

import { toast } from "@/components/toast";

const DIMENSIONS = [
  ["deployment", "Deployment"],
  ["agent", "Agent"],
  ["language", "Language"],
] as const;

export function AnalyticsControls({ range, by, canExport, only }: { range: number; by: string; canExport: boolean; only?: "dimension" }) {
  const router = useRouter();
  const go = (r: number, b: string) => router.push(`/analytics?range=${r}&by=${b}`);
  if (only === "dimension") {
    return (
      <div role="group" aria-label="Breakdown by" className="seg">
        {DIMENSIONS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={by === k} className={by === k ? "on" : ""} onClick={() => go(range, k)}>
            {l}
          </button>
        ))}
      </div>
    );
  }
  const exported = () => toast("CSV export started. Only Owner, Admin and Analyst roles can export. The export is recorded in the audit log.");
  return (
    <div className="row gap-8">
      <div role="group" aria-label="Date range" className="seg">
        {[7, 30, 90].map((r) => (
          <button key={r} type="button" aria-pressed={range === r} className={range === r ? "on" : ""} onClick={() => go(r, by)}>
            {r} days
          </button>
        ))}
      </div>
      {canExport && (
        <a className="btn outline" href={`/api/analytics/export?range=${range}`} onClick={exported}>
          <i className="i i-download" /> Export CSV
        </a>
      )}
    </div>
  );
}
