"use client";

import { useEffect, useState } from "react";

/**
 * The two pieces of motion every Dashboard 3 card shares (handoff v2 section 2.2).
 *
 * Both play once. `useEntered` flips a flag on after the first paint, so a CSS transition
 * has a start value to run from; `useCountUp` eases a number up to its value. Reduced
 * motion is honoured in two places: the stylesheet zeroes every transition under `.d3`,
 * and the count lands on its figure in one frame instead of easing to it.
 */

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True once the first frame has been painted, which is what the bars and lines grow from. */
export function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // Two frames: one for the element to exist at its start value, one to change it.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
  return entered;
}

/** Eases to `to` once. Under reduced motion it is simply there on the next frame. */
export function useCountUp(to: number, duration = 900): number {
  const [value, setValue] = useState(to);
  useEffect(() => {
    let frame = 0;
    if (reducedMotion()) {
      frame = requestAnimationFrame(() => setValue(to));
      return () => cancelAnimationFrame(frame);
    }
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - started) / duration, 1);
      setValue(to * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);
  return value;
}
