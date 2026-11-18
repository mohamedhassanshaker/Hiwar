"use client";

import { useCallback, useRef, useState } from "react";

import { Ic } from "@/components/ui/icon";
import { Popover, useAnchored, useDismissPopover } from "@/components/ui/popover";
import { useAwp } from "@/hooks/use-awp";
import { useClientNow } from "@/hooks/use-client-now";
import { boundsOf, PRESETS, rangeLabel, type Range } from "./range";
import { RangeCalendar } from "./range-calendar";

/**
 * The date-range controls of Dashboard 3 (handoff v2 section 2.3).
 *
 * One pill in the header sets the range for every card; the two charted cards each have a
 * small menu of their own, so one chart can be looked at over a different span without
 * disturbing the rest. Both offer the same five presets and the same "More" calendar.
 */

/** The two shapes the panel takes: the preset list, and the calendar behind "More". */
const LIST = { width: 240, height: 300, align: "end" as const };
const CALENDAR = { width: 320, height: 420, align: "end" as const };

/** The preset list both controls share. */
function RangeOptions({ value, onChange, onMore, heading }: { value: Range; onChange: (range: Range) => void; onMore: () => void; heading: string }) {
  const { t, lang } = useAwp();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";
  return (
    <>
      <span className="d3-rng-h">{heading}</span>
      {PRESETS.map((id) => (
        <button
          key={id}
          className={"d3-rng-o" + (value.id === id ? " on" : "")}
          onClick={() => onChange({ id })}
          aria-pressed={value.id === id}
        >
          <span>{rangeLabel({ id }, t, locale)}</span>
          {value.id === id && <Ic n="TickCircleL" s={16} c="currentColor" />}
        </button>
      ))}
      <button className={"d3-rng-o" + (value.id === "custom" ? " on" : "")} onClick={onMore}>
        <span className="d3-rng-ol">
          <Ic n="Calendar03" s={16} c="currentColor" />
          {value.id === "custom" ? rangeLabel(value, t, locale) : t("More", "المزيد")}
        </span>
        <Ic n={lang === "ar" ? "ArrowLeft01Round" : "ArrowRight01Round"} s={14} c="currentColor" />
      </button>
    </>
  );
}

/** One card's own range menu. */
export function CardRangeMenu({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const { t, lang } = useAwp();
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setCalendar(false);
  }, []);
  const at = useAnchored(open, button, { ...(calendar ? CALENDAR : LIST), rtl: lang === "ar" }, close);
  useDismissPopover(open, { panel, anchor: button }, close);
  const label = t("Sort by period", "ترتيب حسب الفترة");
  return (
    <span className="d3-rng">
      <button
        ref={button}
        className={"d3-ibtn" + (value.id !== "7d" ? " is-on" : "")}
        onClick={() => {
          setOpen(!open);
          setCalendar(false);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
      >
        <Ic n="Sorting02" s={16} />
      </button>
      {open && (
        <Popover at={at} panelRef={panel} className={"d3-rng-pop" + (calendar ? " is-cal" : "")} role="dialog" aria-label={label}>
          {calendar ? (
            <RangeCalendar
              initial={value}
              onBack={() => setCalendar(false)}
              onApply={(range) => {
                onChange(range);
                close();
              }}
            />
          ) : (
            <RangeOptions
              value={value}
              heading={t("Sort by", "ترتيب حسب")}
              onMore={() => setCalendar(true)}
              onChange={(range) => {
                onChange(range);
                close();
              }}
            />
          )}
        </Popover>
      )}
    </span>
  );
}

/** The header pill, which sets the range for every card at once. */
export function RangePill({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const { t, lang } = useAwp();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setCalendar(false);
  }, []);
  const at = useAnchored(open, button, { ...(calendar ? CALENDAR : LIST), rtl: lang === "ar" }, close);
  useDismissPopover(open, { panel, anchor: button }, close);
  // The default range says which seven days it is, rather than only that it is seven — once
  // the browser's own day is known; the server's day is UTC's (D160).
  const now = useClientNow();
  const bounds = now ? boundsOf(value, now) : null;
  const label =
    value.id === "7d" && bounds
      ? `${bounds.from.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${bounds.to.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
      : rangeLabel(value, t, locale);
  return (
    <span className="d3-rng">
      <button
        ref={button}
        className="d3-pill d3-date"
        onClick={() => {
          setOpen(!open);
          setCalendar(false);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t("Date range for all cards", "النطاق الزمني لكل البطاقات")}: ${label}`}
      >
        <Ic n="Calendar03" s={16} />
        <span>{label}</span>
        <Ic n="ChevronDown" s={14} />
      </button>
      {open && (
        <Popover
          at={at}
          panelRef={panel}
          className={"d3-rng-pop" + (calendar ? " is-cal" : "")}
          role="dialog"
          aria-label={t("Date range", "النطاق الزمني")}
        >
          {calendar ? (
            <RangeCalendar
              initial={value}
              onBack={() => setCalendar(false)}
              onApply={(range) => {
                onChange(range);
                close();
              }}
            />
          ) : (
            <RangeOptions
              value={value}
              heading={t("Apply to all cards", "تطبيق على كل البطاقات")}
              onMore={() => setCalendar(true)}
              onChange={(range) => {
                onChange(range);
                close();
              }}
            />
          )}
        </Popover>
      )}
    </span>
  );
}
