"use client";

import type { ReactNode } from "react";

import { Ic } from "./icon";

export type BtnType = "default" | "secondary" | "danger" | "ghost";

const CLASS: Record<BtnType, string> = { default: "btn", secondary: "btn outline", danger: "btn destructive", ghost: "btn ghost" };

/** The module's button on Hiwar's `.btn`, with an optional leading icon. */
export function Btn({
  type = "default",
  label,
  icon,
  onClick,
  size = "sm",
  disabled,
  title,
  soft,
}: {
  type?: BtnType;
  label: string;
  icon?: string;
  /** Required: a control that does nothing when it is clicked is a defect, not a design. */
  onClick: () => void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  /** Why a disabled action is disabled, shown on hover and read by a screen reader. */
  title?: string;
  soft?: boolean;
}) {
  return (
    <button type="button" className={(soft ? "btn outline" : CLASS[type]) + (size === "sm" ? " sm" : "")} disabled={disabled} title={title} onClick={onClick}>
      {icon && <Ic n={icon} s={16} c="currentColor" />}
      {label}
    </button>
  );
}

/** A button styled as a link. The click does not reach the enclosing row or card. */
export function Lnk({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className="awp-lnk"
      style={danger ? { color: "var(--text-danger)" } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/**
 * A controlled on/off switch (`role="switch"`) that reports the opposite of `on`. The click does
 * not reach the enclosing row or card.
 */
export function Toggle({ on, onChange }: { on?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={!!on}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!on);
      }}
      className="awp-switch"
      data-on={on ? "1" : "0"}
    >
      <span />
    </button>
  );
}
