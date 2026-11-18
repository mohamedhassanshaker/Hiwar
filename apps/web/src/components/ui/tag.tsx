"use client";

import type { ReactNode } from "react";

import * as D from "@/ds";
import { useAwp } from "@/hooks/use-awp";

export type Tone = D.TagProps["tone"];

/** The design system's tag in the console's language direction; `tone` defaults to neutral. */
export function Tg({
  tone = "neutral",
  label,
  dot,
  icon,
  size = "sm",
}: {
  tone?: string;
  label: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  size?: D.TagProps["size"];
}) {
  const { lang } = useAwp();
  return <D.Tag tone={tone as Tone} size={size} dot={dot} icon={icon} label={label} dir={lang === "ar" ? "rtl" : "ltr"} />;
}
