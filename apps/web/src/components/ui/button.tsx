"use client";

import { useState, type ReactNode } from "react";

import * as D from "@/ds";
import { Ic } from "./icon";

export type BtnType = D.ButtonProps["type"];

/**
 * The design system's button inside a native button, with its hover and pressed states tracked
 * locally and an optional leading icon.
 */
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
  size?: D.ButtonProps["size"];
  disabled?: boolean;
  /** `COM-08`: why a disabled action is disabled, shown on hover and read by a screen reader. */
  title?: string;
  /** The raised surface with a divider ring handoff v2 adds beside the two solid types. */
  soft?: boolean;
}) {
  const [st, setSt] = useState<D.ButtonProps["state"]>("default");
  return (
    <button
      // `awp-btn-primary` is the gradient that slides on hover, so it is on the default
      // type only, and never while the button is disabled: a disabled control that still
      // lights up on hover reads as something that can be pressed.
      className={"awp-btn" + (soft ? " awp-btn-soft" : "") + (type === "default" && !disabled ? " awp-btn-primary" : "")}
      disabled={disabled}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setSt("hover")}
      onMouseLeave={() => setSt("default")}
      onMouseDown={() => setSt("pressed")}
      onMouseUp={() => setSt("hover")}
    >
      <D.Button
        type={type}
        size={size}
        state={disabled ? "disabled" : st}
        label={label}
        iconL={!!icon}
        iconL2={icon ? <Ic n={icon} s={20} c="currentColor" /> : undefined}
      />
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
