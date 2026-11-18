"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Ic } from "@/components/ui/icon";
import type { CommentCard } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";

/**
 * "Capture area" (handoff v2 section 5.1): drag a rectangle over the card you mean.
 *
 * A comment about a chart is about a part of it, and describing which part in words is
 * worse for everybody than pointing at it. The picture is taken from the live DOM with
 * `html-to-image`, so what is attached is the card as it actually looked — this theme,
 * this language, this range — and not a re-rendering of it.
 */

/** The widest the attached picture is stored at, before the device pixel ratio. */
const MAX_WIDTH = 560;

/** The card a comment button belongs to, found from the button's own `data-qr`. */
export function cardElement(card: CommentCard): HTMLElement | null {
  const button = document.querySelector(`[data-qr="${card}"]`);
  return button?.closest(".d3-card") ?? null;
}

type Selection = { x: number; y: number; w: number; h: number };

/**
 * Renders the card to a canvas at twice its size, crops it to the dragged area (the whole card
 * when `area` is null), scales the crop down to `MAX_WIDTH` and returns it as a JPEG data URL.
 */
async function capture(element: HTMLElement, area: Selection | null): Promise<string> {
  // Imported on demand: it is only needed by the person who chose to take a picture.
  const { toCanvas } = await import("html-to-image");
  const box = element.getBoundingClientRect();
  const ratio = 2;
  const background = getComputedStyle(document.documentElement).getPropertyValue("--surface-raised").trim() || "#fff";
  const whole = await toCanvas(element, {
    pixelRatio: ratio,
    backgroundColor: background,
    cacheBust: false,
    // The comment button itself is not part of what is being pointed at.
    filter: (node) => !(node instanceof Element && node.classList.contains("qr-btn")),
  });
  const wanted = area ?? { x: 0, y: 0, w: box.width, h: box.height };
  // Never scaled up: a small selection keeps its own size.
  const scale = Math.min(1, MAX_WIDTH / (wanted.w * ratio));
  const cropped = document.createElement("canvas");
  cropped.width = Math.round(wanted.w * ratio * scale);
  cropped.height = Math.round(wanted.h * ratio * scale);
  cropped
    .getContext("2d")
    ?.drawImage(whole, wanted.x * ratio, wanted.y * ratio, wanted.w * ratio, wanted.h * ratio, 0, 0, cropped.width, cropped.height);
  return cropped.toDataURL("image/jpeg", 0.85);
}

/**
 * The overlay for capturing part of a card: a hole over the card where a rectangle is dragged, and
 * a bar with Whole card and Cancel. It scrolls the card into view first, follows it on scroll and
 * resize, and closes itself when the card is not on the page. A drag of 16 px or less in either
 * direction captures nothing.
 */
export function CaptureArea({
  card,
  onDone,
  onCancel,
}: {
  card: CommentCard;
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const { t } = useAwp();
  const element = useMemo(() => cardElement(card), [card]);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [area, setArea] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const whole = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!element) {
      onCancel();
      return;
    }
    // The card has to be on screen before a rectangle can be dragged over it.
    const top = element.getBoundingClientRect().top;
    if (top < 80 || top > window.innerHeight - 160) {
      // The nearest ancestor that scrolls vertically, or the document when none does.
      let scroller = element.parentElement;
      while (
        scroller &&
        scroller !== document.body &&
        !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))
      ) {
        scroller = scroller.parentElement;
      }
      (scroller && scroller !== document.body ? scroller : document.scrollingElement)?.scrollBy({ top: top - 120 });
    }
    const measure = () => setBox(element.getBoundingClientRect());
    measure();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape leaves the capture, not the conversation behind it.
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.addEventListener("keydown", onEscape, true);
    const focus = requestAnimationFrame(() => whole.current?.focus());
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onEscape, true);
      cancelAnimationFrame(focus);
    };
  }, [element, onCancel]);

  if (!box || !element) return null;

  const at = (event: ReactPointerEvent) => ({
    x: Math.max(0, Math.min(box.width, event.clientX - box.left)),
    y: Math.max(0, Math.min(box.height, event.clientY - box.top)),
  });

  const take = async (wanted: Selection | null) => {
    setBusy(true);
    setFailed(false);
    try {
      onDone(await capture(element, wanted));
    } catch {
      // Taking a picture of the DOM can fail on a font or an image the page cannot
      // re-read; the bar says so and the drag can be tried again.
      setBusy(false);
      setFailed(true);
      setArea(null);
    }
  };

  return (
    <div className="qr-cap" role="dialog" aria-modal="true" aria-label={t("Capture an area of the card", "التقاط منطقة من البطاقة")}>
      <div
        className="qr-cap-hole"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        onPointerDown={(event) => {
          if (busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = at(event);
          setArea({ ...start.current, w: 0, h: 0 });
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const here = at(event);
          const from = start.current;
          setArea({
            x: Math.min(here.x, from.x),
            y: Math.min(here.y, from.y),
            w: Math.abs(here.x - from.x),
            h: Math.abs(here.y - from.y),
          });
        }}
        onPointerUp={() => {
          if (!start.current) return;
          start.current = null;
          // A click rather than a drag is not a rectangle; it clears instead of capturing
          // a sliver nobody can read.
          if (area && area.w > 16 && area.h > 16) void take(area);
          else setArea(null);
        }}
      >
        {area && area.w > 0 && <span className="qr-cap-sel" style={{ left: area.x, top: area.y, width: area.w, height: area.h }} />}
      </div>
      <div className="qr-cap-bar" role="status" aria-live="polite">
        <Ic n="CropDS" s={18} c="var(--icon-brand)" />
        <span>
          {busy
            ? t("Capturing…", "جارٍ الالتقاط…")
            : failed
              ? t("Could not capture. Try again.", "تعذّر الالتقاط. حاول مرة أخرى.")
              : t("Drag over the number or chart you mean", "اسحب فوق الرقم أو الرسم الذي تقصده")}
        </span>
        <button className="d3-pill" ref={whole} disabled={busy} onClick={() => void take(null)}>
          {t("Whole card", "البطاقة كاملة")}
        </button>
        <button className="d3-pill" disabled={busy} onClick={onCancel}>
          {t("Cancel", "إلغاء")}
        </button>
      </div>
    </div>
  );
}
