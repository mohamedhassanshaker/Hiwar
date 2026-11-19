"use client";

import type { ReactNode } from "react";

export type Tone = "neutral" | "brand" | "info" | "success" | "ok" | "warning" | "danger" | "bad";

const CLASS: Record<string, string> = {
  neutral: "secondary",
  brand: "ai",
  info: "info",
  success: "success",
  ok: "success",
  warning: "warning",
  danger: "danger",
  bad: "danger",
};

/** A status tag on Hiwar's badge; `tone` defaults to neutral. */
export function Tg({ tone = "neutral", label, dot, icon }: { tone?: string; label: ReactNode; dot?: boolean; icon?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`badge ${CLASS[tone] ?? "secondary"}${dot ? " dot" : ""}`}>
      {icon}
      {label}
    </span>
  );
}
