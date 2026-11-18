"use client";

import { useState } from "react";

import { Ic } from "@/components/ui/icon";
import { useAwp } from "@/hooks/use-awp";
import { EARLIEST, isoDay, sameDay, type Range } from "./range";

/** The from–to calendar behind "More". Nothing after today, nothing before 1 Jan 2025. */
export function RangeCalendar({ initial, onApply, onBack }: { initial: Range | null; onApply: (range: Range) => void; onBack: () => void }) {
  const { t, lang } = useAwp();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const start = initial?.id === "custom" ? initial : null;
  const [view, setView] = useState(() => {
    const base = start?.to ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [from, setFrom] = useState<Date | null>(start?.from ?? null);
  const [to, setTo] = useState<Date | null>(start?.to ?? null);
  const [hover, setHover] = useState<Date | null>(null);

  const year = view.getFullYear();
  const month = view.getMonth();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, index) => new Date(year, month, index + 1)),
  ];
  // While only the first end is chosen, hovering shows the range it would make.
  const end = to ?? (from && hover && hover > from ? hover : null);
  const pick = (date: Date) => {
    if (!from || to || date < from) {
      setFrom(date);
      setTo(null);
    } else {
      setTo(date);
    }
  };
  const canGoBack = new Date(year, month - 1, 1) >= new Date(EARLIEST.getFullYear(), EARLIEST.getMonth(), 1);
  const canGoForward = new Date(year, month + 1, 1) <= today;
  const weekdays = lang === "ar" ? ["ن", "ث", "ر", "خ", "ج", "س", "ح"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const previous = lang === "ar" ? "ArrowRight01Round" : "ArrowLeft01Round";
  const next = lang === "ar" ? "ArrowLeft01Round" : "ArrowRight01Round";
  const show = (date: Date | null) => (date ? date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—");

  return (
    <div className="d3-cal">
      <div className="d3-cal-h">
        <button className="d3-ibtn" onClick={() => setView(new Date(year, month - 1, 1))} disabled={!canGoBack} aria-label={t("Previous month", "الشهر السابق")}>
          <Ic n={previous} s={14} />
        </button>
        <b aria-live="polite">{view.toLocaleDateString(locale, { month: "long", year: "numeric" })}</b>
        <button className="d3-ibtn" onClick={() => setView(new Date(year, month + 1, 1))} disabled={!canGoForward} aria-label={t("Next month", "الشهر التالي")}>
          <Ic n={next} s={14} />
        </button>
      </div>
      <div className="d3-cal-g" role="grid" onMouseLeave={() => setHover(null)}>
        {weekdays.map((day) => (
          <span key={day} className="d3-cal-w">
            {day}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`lead-${index}`} />;
          const outside = date > today || date < EARLIEST;
          const isFrom = sameDay(date, from);
          const isTo = sameDay(date, end);
          const inside = from !== null && end !== null && date > from && date < end;
          return (
            <button
              key={index}
              disabled={outside}
              data-day={isoDay(date)}
              className={
                "d3-cal-d" +
                (isFrom ? " is-s" : "") +
                (isTo ? " is-e" : "") +
                (inside ? " is-in" : "") +
                (isFrom && end ? " has-r" : "") +
                (sameDay(date, today) ? " is-t" : "")
              }
              onClick={() => pick(date)}
              onMouseEnter={() => setHover(date)}
              aria-pressed={isFrom || isTo}
              aria-label={date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
            >
              <span>{date.getDate()}</span>
            </button>
          );
        })}
      </div>
      <div className="d3-cal-f">
        <div className="d3-cal-sel">
          <span>
            <small>{t("From", "من")}</small>
            <b>{show(from)}</b>
          </span>
          <span>
            <small>{t("To", "إلى")}</small>
            <b>{show(to)}</b>
          </span>
        </div>
        <div className="d3-cal-a">
          <button className="d3-pill" onClick={onBack}>
            {t("Back", "رجوع")}
          </button>
          <button className="d3t-next" disabled={!from || !to} onClick={() => from && to && onApply({ id: "custom", from, to })}>
            {t("Apply", "تطبيق")}
          </button>
        </div>
      </div>
    </div>
  );
}
