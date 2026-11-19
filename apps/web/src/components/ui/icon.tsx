"use client";

import { IC_ALIAS, IC_DS, IC_LINE } from "./icons-v2";

/**
 * The module's icon by name: the alias table, then the sheet icons, then the line icons
 * (`icons-v2.tsx`, copied from the module). Names the module only had in its generated design
 * system render nothing; the text beside every icon carries the meaning.
 */
export function Ic({ n, c, s = 20 }: { n: string; c?: string; s?: number }) {
  const name = IC_ALIAS[n] ?? n;
  const sheet = IC_DS[name];
  const line = IC_LINE[name];
  if (!sheet && !line) return <span className="awp-ic" aria-hidden="true" style={{ width: s, height: s }} />;
  const [x, y, paths, width] = sheet ?? [0, 0, line, undefined];
  return (
    <span className="awp-ic" aria-hidden="true" style={{ width: s, height: s }}>
      <svg width={s} height={s} viewBox={`${x} ${y} 24 24`} fill="none" stroke={c || "var(--icon-secondary)"} strokeWidth={width ?? 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths}
      </svg>
    </span>
  );
}
