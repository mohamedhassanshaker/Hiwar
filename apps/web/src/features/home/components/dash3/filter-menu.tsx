"use client";

import { useCallback, useRef, useState } from "react";

import { Ic } from "@/components/ui/icon";
import { Popover, useAnchored, useDismissPopover } from "@/components/ui/popover";
import { useAwp } from "@/hooks/use-awp";
import { CARD_IDS, CARD_NAMES, type CardId } from "./cards";

/** A tick in a checkbox the browser is not drawing itself. */
export function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** The panel's own size, which is what decides where it fits. */
const PANEL = { width: 264, height: 480, align: "end" as const };

/**
 * "Filter cards" (handoff v2 section 2.4): which of the nine are on the dashboard.
 *
 * The count on the button is how many are showing, not how many are hidden: the question
 * a person asks on seeing it is "how much am I looking at", and a badge reading 2 when
 * seven cards are on screen answers a different one.
 */
export function FilterMenu({ hidden, onChange }: { hidden: CardId[]; onChange: (hidden: CardId[]) => void }) {
  const { t, lang } = useAwp();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const at = useAnchored(open, button, { ...PANEL, rtl: lang === "ar" }, close);
  useDismissPopover(open, { panel, anchor: button }, close);

  const toggle = (id: CardId) => onChange(hidden.includes(id) ? hidden.filter((one) => one !== id) : [...hidden, id]);
  const label = t("Filter cards", "تصفية البطاقات");

  return (
    <span className="d3-rng">
      <button
        ref={button}
        className={"d3-ibtn" + (hidden.length ? " is-on" : "")}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
      >
        <Ic n="Sorting02" s={16} />
        {hidden.length > 0 && <span className="d3-flt-n">{CARD_IDS.length - hidden.length}</span>}
      </button>
      {open && (
        <Popover at={at} panelRef={panel} className="d3-rng-pop d3-flt-pop" role="dialog" aria-label={label}>
          <span className="d3-rng-h">{t("Show on dashboard", "عرض في اللوحة")}</span>
          {CARD_IDS.map((id) => {
            const shown = !hidden.includes(id);
            return (
              <label key={id} className={"d3-flt-o" + (shown ? " on" : "")}>
                <input type="checkbox" checked={shown} onChange={() => toggle(id)} />
                <span className="d3-flt-box" aria-hidden="true">
                  {shown && <CheckMark />}
                </span>
                <span>{t(...CARD_NAMES[id])}</span>
              </label>
            );
          })}
          <div className="d3-flt-f">
            <button className="d3-pill" disabled={hidden.length === 0} onClick={() => onChange([])}>
              {t("Show all", "عرض الكل")}
            </button>
            <button className="d3t-next" onClick={close}>
              {t("Done", "تم")}
            </button>
          </div>
        </Popover>
      )}
    </span>
  );
}
