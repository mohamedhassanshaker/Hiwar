"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useAwp } from "@/hooks/use-awp";
import { usePreferences } from "@/lib/preferences";
import { Ic } from "./icon";

/**
 * The select and date controls handoff v2 puts in place of the browser's own.
 *
 * Both keep the native element's call signature — `value`/`defaultValue` and an `onChange`
 * carrying `event.target.value` — so a form that used `<select>` or `<input type="date">`
 * changes its element and nothing else. The list and the calendar are drawn in a portal on
 * `document.body`, because a field inside a modal or a drawer is inside something that
 * clips and scrolls, and a listbox that opens into the next field is not a list.
 */

/** What a native change handler reads. Neither control manufactures anything more. */
export type PopChange = { target: { value: string }; currentTarget: { value: string } };

/** Where the popover was placed: `top` or `bottom` is set, never both. */
type Placement = { left: number; width?: number; top: number | null; bottom: number | null };

/** Opens below the field when there is room, otherwise above it. */
function place(rect: DOMRect, height: number, width?: number): Placement {
  const below = window.innerHeight - rect.bottom;
  const fitsBelow = below > height + 16 || below > rect.top;
  let left = rect.left;
  if (width !== undefined) left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  return {
    left,
    width,
    top: fitsBelow ? rect.bottom + 8 : null,
    bottom: fitsBelow ? null : window.innerHeight - rect.top + 8,
  };
}

/**
 * Closes the popover on the three things that mean "I am looking elsewhere": a pointer
 * outside it, Escape, and the field moving under it because something scrolled or resized.
 * Escape also puts the keyboard back on the field it came from.
 */
function useDismiss(
  open: boolean,
  refs: { pop: React.RefObject<HTMLDivElement | null>; field: React.RefObject<HTMLButtonElement | null> },
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!refs.pop.current?.contains(target) && !refs.field.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stopped here: a field inside a modal must not close the modal as well.
      event.stopPropagation();
      close();
      refs.field.current?.focus();
    };
    const scrolled = (event: Event) => {
      if (!refs.pop.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [open, refs.pop, refs.field, close]);
}

type Option = { value: string; label: ReactNode };

/** The `<option>` elements a caller wrote, including any inside an `<optgroup>`. */
function optionsOf(children: ReactNode): Option[] {
  const found: Option[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as { value?: string | number; children?: ReactNode };
      if (child.type === "option") {
        const text = Children.toArray(props.children).join("");
        found.push({ value: String(props.value !== undefined ? props.value : text), label: props.children });
      } else if (props.children) {
        walk(props.children);
      }
    });
  };
  walk(children);
  return found;
}

/**
 * A drop-in for `<select>`: a combobox button showing the chosen option and a listbox of the
 * `<option>` children in a portal, the width of the field. Controlled with `value`, otherwise it
 * keeps its own choice starting from `defaultValue` or the first option. Arrow keys move through
 * the list (wrapping), Tab closes it, and picking returns focus to the field. It needs only the
 * language, so it also works on the signed-out screens.
 */
export function PopSelect({
  value,
  defaultValue,
  onChange,
  disabled,
  children,
  className,
  style,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (event: PopChange) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const { lang } = usePreferences();
  // The list is drawn in a portal, so the field names it rather than containing it.
  const listId = useId();
  const options = optionsOf(children);
  const [inner, setInner] = useState(defaultValue !== undefined ? String(defaultValue) : options[0]?.value ?? "");
  const current = value !== undefined ? String(value) : inner;
  const chosen = options.find((option) => option.value === current) ?? options[0];
  const [at, setAt] = useState<Placement | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setAt(null), []);
  useDismiss(at !== null, { pop, field }, close);

  const openList = () => {
    if (disabled || !field.current) return;
    const rect = field.current.getBoundingClientRect();
    // The list's expected height (42 px a row plus padding, capped at 320) decides above or below.
    setAt(place(rect, Math.min(320, options.length * 42 + 18), rect.width));
  };

  const pick = (next: string) => {
    if (value === undefined) setInner(next);
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    close();
    field.current?.focus();
  };

  // Opening moves the keyboard into the list, on the chosen option when there is one.
  useEffect(() => {
    if (!at || !pop.current) return;
    const first = pop.current.querySelector<HTMLButtonElement>(".awp-ps-o.on") ?? pop.current.querySelector<HTMLButtonElement>(".awp-ps-o");
    first?.focus();
  }, [at]);

  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!pop.current) return;
    const all = [...pop.current.querySelectorAll<HTMLButtonElement>(".awp-ps-o")];
    const here = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      (all[here + 1] ?? all[0])?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      (all[here - 1] ?? all[all.length - 1])?.focus();
    }
    if (event.key === "Tab") close();
  };

  return (
    <>
      <button
        type="button"
        ref={field}
        className={(className || "awp-input") + " awp-ps"}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        // A button that opens a listbox and shows the chosen value is a combobox, which is
        // also the role the native `<select>` it replaces reports.
        role="combobox"
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={at !== null}
        onClick={(event) => {
          event.preventDefault();
          if (at) close();
          else openList();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !at) {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span className="awp-ps-v">{chosen ? chosen.label : ""}</span>
        <Ic n="ChevronDown" s={18} c="currentColor" />
      </button>
      {at &&
        createPortal(
          <div
            ref={pop}
            id={listId}
            className="awp-ps-pop"
            role="listbox"
            dir={lang === "ar" ? "rtl" : "ltr"}
            onKeyDown={move}
            style={{ left: at.left, width: at.width, top: at.top ?? "auto", bottom: at.bottom ?? "auto" }}
          >
            {options.map((option) => (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={option.value === current}
                className={"awp-ps-o" + (option.value === current ? " on" : "")}
                onClick={() => pick(option.value)}
              >
                <span className="awp-ps-l">{option.label}</span>
                {option.value === current && <Ic n="TickCircleL" s={16} c="currentColor" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

const isoOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dayOf = (text: string | undefined | null): Date | null => {
  if (!text) return null;
  const [year, month, day] = String(text).split("-").map(Number);
  return year ? new Date(year, month - 1, day) : null;
};

const sameDay = (a: Date | null, b: Date | null) =>
  a !== null && b !== null && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A drop-in for `<input type="date">`: a button showing the date in the console's locale and a
 * month calendar in a portal, weeks starting on Monday. Values are `YYYY-MM-DD` in local time;
 * days outside `min`/`max` are disabled. Controlled with `value`, otherwise it keeps its own.
 * The footer offers Today and, when a date is set, Clear, which reports an empty value.
 */
export function PopDate({
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  style,
  min,
  max,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (event: PopChange) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  min?: string;
  max?: string;
  "aria-label"?: string;
}) {
  const { t, lang } = useAwp();
  const arabic = lang === "ar";
  const locale = arabic ? "ar-AE" : "en-GB";
  const [inner, setInner] = useState(defaultValue ?? "");
  const chosen = dayOf(value !== undefined ? value : inner);
  const [at, setAt] = useState<Placement | null>(null);
  // `today` is read once per mount: a calendar that silently changed which cell is marked
  // while it is open would be worse than one that is a few hours stale.
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [view, setView] = useState(() => {
    const base = chosen ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const field = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const earliest = dayOf(min);
  const latest = dayOf(max);

  const close = useCallback(() => setAt(null), []);
  useDismiss(at !== null, { pop, field }, close);

  const openCalendar = () => {
    if (disabled || !field.current) return;
    const base = chosen ?? today;
    setView(new Date(base.getFullYear(), base.getMonth(), 1));
    setAt(place(field.current.getBoundingClientRect(), 360, 304));
  };

  const pick = (date: Date) => {
    const next = isoOf(date);
    if (value === undefined) setInner(next);
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    close();
    field.current?.focus();
  };

  useEffect(() => {
    if (!at || !pop.current) return;
    const start =
      pop.current.querySelector<HTMLButtonElement>(".d3-cal-d.is-s") ??
      pop.current.querySelector<HTMLButtonElement>(".d3-cal-d.is-t") ??
      pop.current.querySelector<HTMLButtonElement>(".d3-cal-d:not(:disabled)");
    start?.focus();
  }, [at]);

  const year = view.getFullYear();
  const month = view.getMonth();
  // Monday first, so `getDay()`'s Sunday-zero week is rotated by one.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1)),
  ];
  const weekdays = arabic ? ["ن", "ث", "ر", "خ", "ج", "س", "ح"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const previous = arabic ? "ArrowRight01Round" : "ArrowLeft01Round";
  const next = arabic ? "ArrowLeft01Round" : "ArrowRight01Round";

  const moveDay = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!pop.current) return;
    const all = [...pop.current.querySelectorAll<HTMLButtonElement>(".d3-cal-d:not(:disabled)")];
    const here = all.indexOf(document.activeElement as HTMLButtonElement);
    if (here < 0) return;
    // Left and right follow the reading direction, so they are mirrored in Arabic.
    const step = { ArrowRight: arabic ? -1 : 1, ArrowLeft: arabic ? 1 : -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    all[here + step]?.focus();
  };

  return (
    <>
      <button
        type="button"
        ref={field}
        className={(className || "awp-input") + " awp-ps awp-pd"}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        onClick={(event) => {
          event.preventDefault();
          if (at) close();
          else openCalendar();
        }}
      >
        <span className={"awp-ps-v" + (chosen ? "" : " is-ph")}>
          {chosen ? chosen.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }) : t("dd/mm/yyyy", "يي/شش/سسسس")}
        </span>
        <Ic n="Calendar03" s={18} c="currentColor" />
      </button>
      {at &&
        createPortal(
          <div
            ref={pop}
            className="awp-ps-pop awp-pd-pop"
            role="dialog"
            aria-label={t("Choose date", "اختر التاريخ")}
            dir={arabic ? "rtl" : "ltr"}
            style={{ left: at.left, top: at.top ?? "auto", bottom: at.bottom ?? "auto" }}
          >
            <div className="d3-cal">
              <div className="d3-cal-h">
                <button type="button" className="d3-ibtn" onClick={() => setView(new Date(year, month - 1, 1))} aria-label={t("Previous month", "الشهر السابق")}>
                  <Ic n={previous} s={14} />
                </button>
                <b aria-live="polite">{view.toLocaleDateString(locale, { month: "long", year: "numeric" })}</b>
                <button type="button" className="d3-ibtn" onClick={() => setView(new Date(year, month + 1, 1))} aria-label={t("Next month", "الشهر التالي")}>
                  <Ic n={next} s={14} />
                </button>
              </div>
              <div className="d3-cal-g" role="grid" onKeyDown={moveDay}>
                {weekdays.map((day) => (
                  <span key={day} className="d3-cal-w">
                    {day}
                  </span>
                ))}
                {cells.map((date, index) => {
                  if (!date) return <span key={`lead-${index}`} />;
                  const outside = (earliest !== null && date < earliest) || (latest !== null && date > latest);
                  const selected = sameDay(date, chosen);
                  return (
                    <button
                      type="button"
                      key={index}
                      disabled={outside}
                      // The cell's own date, so what a calendar is showing can be read
                      // without parsing a month name in the reader's language.
                      data-day={isoOf(date)}
                      className={"d3-cal-d" + (selected ? " is-s" : "") + (sameDay(date, today) ? " is-t" : "")}
                      onClick={() => pick(date)}
                      aria-pressed={selected}
                      aria-label={date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
                    >
                      <span>{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              <div className="awp-pd-f">
                <button type="button" className="d3-link" onClick={() => pick(today)}>
                  {t("Today", "اليوم")}
                </button>
                {chosen && (
                  <button
                    type="button"
                    className="d3-link is-muted"
                    onClick={() => {
                      if (value === undefined) setInner("");
                      onChange?.({ target: { value: "" }, currentTarget: { value: "" } });
                      close();
                      field.current?.focus();
                    }}
                  >
                    {t("Clear", "مسح")}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
