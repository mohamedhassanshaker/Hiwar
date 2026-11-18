"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A panel anchored to a control, drawn on `document.body`.
 *
 * Everything that opens one of these sits inside `.awp-content`, which scrolls — and an
 * absolutely positioned panel inside a scroll box is clipped by it. A menu wider than the
 * space to one side of its button then disappears entirely rather than opening the other
 * way, which is what a portal and a measured position avoid.
 */

/** Where a panel was placed: `top` or `bottom` is set, never both. */
export type Placement = { left: number; width?: number; top: number | null; bottom: number | null };

/**
 * Below the control when there is room, otherwise above it, and never off either edge.
 *
 * `align` is which edge of the panel meets which edge of the control: `start` opens along
 * the reading direction, `end` opens back against it, which is what a menu at the end of a
 * toolbar wants.
 */
export function place(
  rect: DOMRect,
  size: { width?: number; height: number; align?: "start" | "end"; rtl?: boolean },
): Placement {
  const below = window.innerHeight - rect.bottom;
  const fitsBelow = below > size.height + 16 || below > rect.top;
  let left = rect.left;
  if (size.width !== undefined) {
    // In RTL the two alignments swap sides, because "start" is the right edge there.
    const toEnd = size.align === "end" ? !size.rtl : Boolean(size.rtl);
    if (toEnd) left = rect.right - size.width;
    left = Math.max(8, Math.min(left, window.innerWidth - size.width - 8));
  }
  return {
    left,
    width: size.width,
    top: fitsBelow ? rect.bottom + 8 : null,
    bottom: fitsBelow ? null : window.innerHeight - rect.top + 8,
  };
}

/**
 * Follows `anchor` while `open`, re-measuring when the page moves under it.
 *
 * The panel is closed rather than moved on a scroll elsewhere in the page: a menu that
 * chases its button across a scrolling list is harder to use than one that goes away.
 */
export function useAnchored(
  /** The panel is unmounted while this is false, so no stale placement survives. */
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  size: { width: number; height: number; align?: "start" | "end"; rtl?: boolean },
  onClose: () => void,
): Placement | null {
  const [at, setAt] = useState<Placement | null>(null);
  const measure = useCallback(() => {
    const element = anchor.current;
    if (!element) return;
    setAt(place(element.getBoundingClientRect(), size));
    // The size is a fixed per-caller constant, so it is read rather than depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, size.width, size.height, size.align, size.rtl]);

  useLayoutEffect(() => {
    if (!open) return;
    // Measured on the next frame, once the trigger has settled where this render put it.
    const first = requestAnimationFrame(measure);
    const onResize = () => measure();
    const onScroll = () => onClose();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, measure, onClose]);

  return at;
}

/** Closes on Escape and on a pointer outside both the panel and the control. */
export function useDismissPopover(
  open: boolean,
  refs: { panel: RefObject<HTMLElement | null>; anchor: RefObject<HTMLElement | null> },
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!refs.panel.current?.contains(target) && !refs.anchor.current?.contains(target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stopped here: a menu inside a modal must not close the modal as well.
      event.stopPropagation();
      onClose();
      refs.anchor.current?.focus();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open, refs.panel, refs.anchor, onClose]);
}

/**
 * The panel itself: whatever is given, placed where `at` says, on `document.body`.
 *
 * Rendered only once a place has been measured, so it never flashes at the origin first.
 */
export function Popover({
  at,
  className,
  children,
  ...aria
}: {
  at: Placement | null;
  className: string;
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
  dir?: "ltr" | "rtl";
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  const fallback = useRef<HTMLDivElement>(null);
  const { panelRef, ...rest } = aria;
  if (!at || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef ?? fallback}
      // `awp-anchored` clears the stylesheet's own `inset-inline`, which would otherwise
      // fight the measured `left` below: a box with left, right and width all set is
      // over-constrained, and which one the browser drops depends on the direction.
      className={`awp-anchored ${className}`}
      {...rest}
      style={{
        position: "fixed",
        left: at.left,
        width: at.width,
        top: at.top ?? "auto",
        bottom: at.bottom ?? "auto",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
