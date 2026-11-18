"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAwp } from "@/hooks/use-awp";

/**
 * The dashboard guide (handoff v2 section 4).
 *
 * Eight steps, each a spotlight cut over one card and a card of text placed beside it.
 * It starts itself the first time somebody opens the dashboard and never again; the
 * toolbar's "Dashboard guide" pill is how it is seen a second time.
 */

/** That the guide has been finished. A fact about this browser, not about the person. */
export const TOUR_DONE_KEY = "awp.d3.tour";

/** Whether this browser has finished the guide. */
export function tourFinished(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    // Blocked storage means it runs again next time, which is better than never running.
    return false;
  }
}

/** How much room is left around the spotlight. */
const PAD = 8;

type Spot = { x: number; y: number; w: number; h: number; round: boolean };

/** Mounted only while it is open, so there is no "reopened" state to reset. */
export function Tour({ onClose }: { onClose: () => void }) {
  const { t, lang } = useAwp();
  const steps = [
    {
      target: '[data-tour="actions"]',
      title: t("Quick actions", "إجراءات سريعة"),
      text: t(
        "Search, filter the dashboard, change the date range, create a report or start a discussion room or work item.",
        "ابحث، صفِّ اللوحة، غيّر النطاق الزمني، أنشئ تقريراً أو ابدأ اجتماع عمل أو بند عمل.",
      ),
    },
    {
      target: '[data-tour="assistant"]',
      title: t("AI Assistant", "المساعد الذكي"),
      text: t(
        "Your automation rate at a glance. Ask the assistant about anything on this dashboard; it can also open pages for you.",
        "نسبة الأتمتة بنظرة سريعة. اسأل المساعد عن أي شيء في هذه اللوحة، ويمكنه فتح الصفحات لك.",
      ),
    },
    {
      target: '[data-tour="runs"]',
      title: t("Agent runs", "عمليات الوكلاء"),
      text: t("Runs over the period you chose. Select a bar to see that day.", "العمليات خلال الفترة التي اخترتها. اختر عموداً لعرض ذلك اليوم."),
    },
    {
      target: '[data-tour="cost"]',
      title: t("Cost and budget", "التكلفة والميزانية"),
      text: t(
        "Estimated spend this month against the month's budget. The white mark shows how much of the month has passed.",
        "الإنفاق التقديري لهذا الشهر مقابل ميزانية الشهر. توضح العلامة البيضاء الجزء المنقضي من الشهر.",
      ),
    },
    {
      target: '[data-tour="work"]',
      title: t("Tasks finished", "المهام المنجزة"),
      text: t(
        "How many tasks got done in each period. Below, see how many are still being worked on and how many are stuck and need you.",
        "عدد المهام المنجزة في كل فترة. وفي الأسفل عدد المهام التي لا تزال قيد العمل والمتوقفة التي تحتاجك.",
      ),
    },
    {
      target: '[data-tour="attention"]',
      title: t("Needs attention", "يحتاج إلى متابعة"),
      text: t(
        "Errors, approvals and SLAs that need you today. Select a row to open the related records.",
        "الأخطاء والاعتمادات واتفاقيات الخدمة التي تحتاجك اليوم. اختر صفاً لفتح السجلات المرتبطة.",
      ),
    },
    {
      target: '[data-tour="rooms"]',
      title: t("Discussion room activity", "نشاط اجتماعات العمل"),
      text: t(
        "The latest discussion rooms with status, participants and cost. Select a room to join it.",
        "أحدث اجتماعات العمل مع الحالة والمشاركين والتكلفة. اختر اجتماعاً للانضمام إليه.",
      ),
    },
    {
      target: ".awp-fab",
      title: t("Assistant on every page", "المساعد في كل صفحة"),
      text: t(
        "Open the assistant from here at any time. Your chats are saved automatically.",
        "افتح المساعد من هنا في أي وقت. تُحفظ محادثاتك تلقائياً.",
      ),
    },
  ];

  const [at, setAt] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[at];

  /**
   * The spotlight and the card's own place, worked out together.
   *
   * Both depend on what the browser has laid out — the target's box, and the card's own
   * height once its text is in it — so they are measured after a render rather than
   * during one, and written into state the next render draws from.
   */
  const measure = useCallback(() => {
    const element = document.querySelector(step.target);
    if (!element) {
      setSpot(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const here: Spot = { x: box.left, y: box.top, w: box.width, h: box.height, round: step.target === ".awp-fab" };
    setSpot(here);

    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const cardWidth = Math.min(340, viewWidth - 32);
    const cardHeight = card.current?.offsetHeight ?? 200;
    const below = here.y + here.h + PAD + 16;
    const above = here.y - PAD - 16 - cardHeight;
    const gap = PAD + 16;
    const clampTop = (top: number) => Math.min(Math.max(16, top), viewHeight - cardHeight - 16);
    const centred = Math.min(Math.max(16, here.x + here.w / 2 - cardWidth / 2), viewWidth - cardWidth - 16);
    if (below + cardHeight < viewHeight - 16) setPlace({ left: centred, top: below });
    else if (above >= 16) setPlace({ left: centred, top: above });
    else if (here.x + here.w + gap + cardWidth < viewWidth - 16) setPlace({ left: here.x + here.w + gap, top: clampTop(here.y) });
    else if (here.x - gap - cardWidth >= 16) setPlace({ left: here.x - gap - cardWidth, top: clampTop(here.y) });
    else setPlace({ left: centred, top: here.y + here.h / 2 > viewHeight / 2 ? 16 : viewHeight - cardHeight - 16 });
  }, [step.target]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(TOUR_DONE_KEY, "1");
    } catch {
      // Blocked storage; the guide will offer itself again, which is harmless.
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const element = document.querySelector(step.target);
    const scroller = document.querySelector(".awp-content");
    // The launcher is fixed, so it is never scrolled to; everything else is brought into
    // view before it is measured, or the spotlight lands on an element that is off screen.
    if (element && scroller && step.target !== ".awp-fab") {
      const box = element.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      const fits = box.height < frame.height - 220;
      const target = scroller.scrollTop + box.top - frame.top - (fits ? Math.max(24, (frame.height - box.height) / 2 - 80) : 24);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({ top: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
    }
    // Measured on the next frame, once this step's card has been laid out, and again
    // when the smooth scroll has finished or the cut-out trails behind the card.
    const first = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 420);
    const again = () => measure();
    window.addEventListener("resize", again);
    scroller?.addEventListener("scroll", again, { passive: true });
    next.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(first);
      clearTimeout(settle);
      window.removeEventListener("resize", again);
      scroller?.removeEventListener("scroll", again);
    };
  }, [at, measure, step.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      // Forward is whichever arrow points along the reading direction.
      const forward = lang === "ar" ? "ArrowLeft" : "ArrowRight";
      const back = lang === "ar" ? "ArrowRight" : "ArrowLeft";
      if (event.key === forward) setAt((here) => Math.min(here + 1, steps.length - 1));
      if (event.key === back) setAt((here) => Math.max(here - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, lang, steps.length]);

  const last = at === steps.length - 1;

  return createPortal(
    <div className="d3t" role="dialog" aria-modal="true" aria-labelledby="d3t-title">
      <div className="d3t-scrim" onClick={finish} />
      {spot && (
        <div
          className={"d3t-spot" + (spot.round ? " is-round" : "")}
          style={{ left: spot.x - PAD, top: spot.y - PAD, width: spot.w + PAD * 2, height: spot.h + PAD * 2 }}
          aria-hidden="true"
        />
      )}
      <div
        className="d3t-card"
        ref={card}
        // Before the first measurement the card is centred rather than at the origin,
        // which is where an unplaced absolutely-positioned element would otherwise flash.
        style={place ? { left: place.left, top: place.top } : { left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
        key={at}
      >
        <div className="d3t-top">
          <span className="d3t-n">
            {t("Step", "الخطوة")} {at + 1} / {steps.length}
          </span>
          <button className="d3t-skip" onClick={finish}>
            {t("Skip tour", "تخطي الجولة")}
          </button>
        </div>
        <h3 id="d3t-title">{step.title}</h3>
        <p>{step.text}</p>
        <div className="d3t-foot">
          <div className="d3t-dots" aria-hidden="true">
            {steps.map((_, index) => (
              <i key={index} className={index === at ? "on" : index < at ? "done" : ""} />
            ))}
          </div>
          <div className="d3t-btns">
            {at > 0 && (
              <button className="d3-pill" onClick={() => setAt(at - 1)}>
                {t("Back", "السابق")}
              </button>
            )}
            <button ref={next} className="d3t-next" onClick={() => (last ? finish() : setAt(at + 1))}>
              {last ? t("Done", "تم") : t("Next", "التالي")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
