"use client";

import { type Provider } from "@/features/models/types";

/** A provider's initial on its card colour, in a rounded square of size `s`. */
export const ProvIcon = ({ p, s = 40 }: { p: Provider; s?: number }) => (
  <span
    style={{
      width: s,
      height: s,
      borderRadius: 12,
      display: "inline-grid",
      placeItems: "center",
      background: p.c,
      color: "var(--text-on-action)",
      fontWeight: 900,
      fontSize: s * 0.36,
      flexShrink: 0,
    }}
  >
    {p.ini}
  </span>
);
