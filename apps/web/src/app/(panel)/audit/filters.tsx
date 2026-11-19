"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { toast } from "@/components/toast";

export function AuditFilters({ areas, area, q, exportHref }: { areas: string[]; area: string; q: string; exportHref: string }) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const go = (nextArea: string, nextQ: string) =>
    router.push(`/audit?area=${encodeURIComponent(nextArea)}&q=${encodeURIComponent(nextQ)}`);
  return (
    <div className="row gap-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(area, text);
        }}
      >
        <label className="sr-only" htmlFor="audit-q">
          Search the log
        </label>
        <input id="audit-q" type="search" className="input" placeholder="Search by person or item" aria-label="Search the log" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
      <label className="sr-only" htmlFor="audit-area">
        Filter by area
      </label>
      <select id="audit-area" className="select" style={{ width: 180 }} value={area} onChange={(e) => go(e.target.value, text)}>
        {areas.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <a className="btn outline" href={exportHref} onClick={() => toast("Export started. This export is added to the log.")}>
        <i className="i i-download" /> Export
      </a>
    </div>
  );
}
