"use client";

import { useEffect, useRef } from "react";

import { AiOrb } from "@/components/shared/ai-orb";
import { reducedMotion } from "./motion";

/**
 * The AI sphere at the head of the dashboard (handoff v2 section 2.2, card 1).
 *
 * Two things happen on hover: the sphere leans a little towards the pointer, and three
 * rings expand out of it in turn. The prototype drives both with GSAP; neither needs a
 * tween engine — the lean is a transform written to the element as the pointer moves,
 * eased by a CSS transition, and the rings are one keyframe animation that runs only
 * while the pointer is over the card. Both stop under reduced motion.
 */

/** How far the sphere leans, in pixels, at the edge of the card. */
const LEAN_X = 12;
const LEAN_Y = 10;

/** Renders the sphere with its hover rings, and binds the pointer lean for a mouse pointer only. */
export function HeroOrb() {
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    const moving = orb.current;
    if (!element || !moving) return;
    if (reducedMotion()) return;

    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = element.getBoundingClientRect();
      const x = clamp((event.clientX - box.left - box.width / 2) / (box.width / 2)) * LEAN_X;
      const y = clamp((event.clientY - box.top - box.height / 2) / (box.height / 2)) * LEAN_Y;
      moving.style.transform = `translate(${x}px, ${y}px)`;
    };
    const leave = () => {
      moving.style.transform = "translate(0px, 0px)";
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div className="d3-hero-orb" ref={host}>
      <div className="d3-echo-wrap awp-hero-lean" ref={orb}>
        <span className="d3-echoes" aria-hidden="true">
          <i className="d3-echo" />
          <i className="d3-echo" />
          <i className="d3-echo" />
        </span>
        <div>
          <AiOrb size={136} still />
        </div>
      </div>
    </div>
  );
}
