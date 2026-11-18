"use client";

import { createElement } from "react";

import * as D from "@/ds";
import { IC_ALIAS, IC_DS, IC_LINE } from "@/ds/icons-v2";

/**
 * The icon is looked up by name, the way the prototype read `D[name]`.
 *
 * Handoff v2 put two sets in front of the generated bundle and an alias table in front of
 * both, so a name the console already passes resolves to the v2 drawing without every
 * caller being rewritten. The order is the prototype's: alias, sheet icon, line icon,
 * design-system component.
 */
export function Ic({ n, c, s = 20 }: { n: string; c?: string; s?: number }) {
  const name = IC_ALIAS[n] ?? n;
  const colour = c || "var(--icon-secondary)";
  const sheet = IC_DS[name];
  const line = IC_LINE[name];
  if (sheet || line) {
    const [x, y, paths, width] = sheet ?? [0, 0, line, undefined];
    return (
      <span className="awp-ic" aria-hidden="true" style={{ width: s, height: s }}>
        <svg
          width={s}
          height={s}
          viewBox={`${x} ${y} 24 24`}
          fill="none"
          stroke={colour}
          strokeWidth={width ?? 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {paths}
        </svg>
      </span>
    );
  }
  const icon = D.icon(name);
  return (
    // Decorative only: the text beside it already carries the meaning, and the generated
    // icon's own `<title>` must never speak over it to a screen reader or show up as text.
    <span className="awp-ic" aria-hidden="true" style={{ width: s, height: s }}>
      {icon ? createElement(icon, { style: { color: colour, transform: `scale(${s / 24})`, transformOrigin: "0 0" } }) : null}
    </span>
  );
}
