"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { ModalProps } from "@/components/shared/modal-host";
import { searchEverything } from "@/features/home/actions";
import { SEARCH_TERM_MAX } from "@/features/home/schema";
import type { SearchGroup } from "@/features/home/types";
import type { ScreenId } from "@/lib/routes";
import { Ic } from "@/components/ui/icon";
import { useAwp } from "@/hooks/use-awp";

/**
 * S-02, the search palette (`UC-02.1`).
 *
 * It holds no records of its own: every keystroke asks the `home` module's search action,
 * which queries the normalised `search_key` columns and returns only what the signed-in
 * person may see. The rows arrive already grouped by kind, in the order specification 6.1
 * lists them.
 *
 * `COM-16`: it is a dialog that traps focus, moves a highlight with the arrow keys and
 * opens the highlighted row with Enter. Esc closes it; the modal host is what gives focus
 * back to the control that opened it (`UC-02.1-07`).
 */
const EMPTY: SearchGroup[] = [];

/**
 * The palette dialog: a search box and the grouped hits for the typed term, one highlighted.
 * Choosing a hit navigates to its screen and closes the palette.
 */
export function SearchPalette({ onClose, go }: ModalProps) {
  const { t, nm } = useAwp();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<SearchGroup[]>([]);
  const [at, setAt] = useState(0);
  const card = useRef<HTMLDivElement>(null);

  // An empty box shows nothing, so the last answer is simply not rendered rather than
  // cleared: there is no reason to ask the server about "".
  const term = q.trim();
  // A term past the server's limit finds nothing, rather than being sent to be refused with an error (S-02).
  const searchable = term.length > 0 && term.length <= SEARCH_TERM_MAX;
  const groups = searchable ? found : EMPTY;

  // Asks 120 ms after the last keystroke, and drops an answer that arrives after the term
  // changed.
  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = setTimeout(() => {
      searchEverything({ term }).then((groupsFound) => {
        if (!current) return;
        setFound(groupsFound);
        setAt(0);
      });
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, searchable]);

  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  // Where each group starts in `flat`, so a row knows its own place in the highlight order.
  const offsets = useMemo(
    () => groups.map((_group, index) => groups.slice(0, index).reduce((sum, earlier) => sum + earlier.hits.length, 0)),
    [groups],
  );

  const openHit = (hit: (typeof flat)[number]) => {
    go(hit.screen as ScreenId, hit.params);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      // Wraps at both ends: up from the first row reaches the last.
      setAt((index) => (index + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (flat[at]) openHit(flat[at]);
      return;
    }
    // COM-16: a modal keeps the keyboard inside it.
    if (event.key === "Tab" && card.current) {
      const focusable = card.current.querySelectorAll<HTMLElement>("input, button");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    // Handoff v2 1.8: the Dashboard 3 glass panel, like every other modal. It sits near
    // the top of the viewport rather than centred, because what fills it is a list that
    // grows downwards as the term narrows.
    <div className="d3-modal-wrap" role="presentation" style={{ alignItems: "flex-start", paddingTop: "12vh", zIndex: 60 }}>
      <div className="d3-modal-scrim" onClick={onClose} />
      <div
        ref={card}
        className="d3-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Search everything you have access to", "ابحث في كل ما يمكنك الوصول إليه")}
        style={{ width: "min(640px,calc(100% - 32px))", padding: 0, gap: 0, overflow: "hidden" }}
        onKeyDown={onKeyDown}
      >
        <div className="awp-row" style={{ padding: "6px 16px", borderBottom: "1px solid var(--border-divider)" }}>
          <Ic n="Search" c="var(--icon-tertiary)" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("Search everything you have access to", "ابحث في كل ما يمكنك الوصول إليه")}
            // A short placeholder, because the box is 225 px wide on a phone and a focused
            // input scrolls its text rather than ellipsising it: the top bar's long sentence
            // would be cut mid-word against the Esc badge. The whole sentence is still the
            // dialog's accessible name and this field's own label.
            placeholder={t("Search everything", "ابحث في كل شيء")}
            // Keeps a long typed term from reaching the Esc badge once the box loses focus,
            // the same way the top-bar button treats its label (`shell.tsx`).
            style={{
              flex: 1,
              minWidth: 0,
              height: 52,
              border: 0,
              outline: 0,
              background: "transparent",
              font: "inherit",
              fontSize: 16,
              color: "var(--text-primary)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          />
          <span className="awp-kbd">Esc</span>
        </div>
        <div style={{ maxHeight: 400, overflow: "auto", padding: 8 }}>
          {groups.map((group, groupIndex) => (
            <div key={group.kind}>
              <div className="awp-nav-h">{t(group.headingEn, group.headingAr)}</div>
              {group.hits.map((hit, hitIndex) => {
                const here = offsets[groupIndex] + hitIndex;
                return (
                  <button
                    key={`${hit.kind}:${hit.code}:${hit.nameEn}`}
                    onClick={() => openHit(hit)}
                    onMouseEnter={() => setAt(here)}
                    className={"awp-nav-i" + (at === here ? " on" : "")}
                    aria-current={at === here ? "true" : undefined}
                    data-row={here}
                    style={{ height: 52, color: "var(--text-primary)" }}
                  >
                    <span className="awp-mono awp-muted" style={{ width: 72 }}>
                      {hit.code}
                    </span>
                    <span className="grow">{nm({ name: hit.nameEn, nameAr: hit.nameAr })}</span>
                    <span className="awp-small awp-muted">{t(group.headingEn, group.headingAr)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {term.length > 0 && groups.length === 0 && (
            <p className="awp-muted" style={{ textAlign: "center" }}>
              {t("No results", "لا توجد نتائج")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
