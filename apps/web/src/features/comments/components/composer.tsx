"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Who } from "@/components/ui/avatar";
import type { Mentionable } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";

/**
 * The comment composer (handoff v2 section 5.1).
 *
 * `@` opens the people list; arrow keys move through it, Enter or Tab picks, Escape closes
 * it without closing the popover around it. Ctrl or ⌘ with Enter sends, because a comment
 * is several lines as often as it is one and Enter alone would cost people their second
 * sentence.
 */

/** A name as it appears in the text of a comment, longest first so `Al` never eats `Ali`. */
export function mentionNames(people: Mentionable[]): { person: Mentionable; name: string }[] {
  return people
    .flatMap((person) => [
      { person, name: person.name },
      { person, name: person.nameAr },
    ])
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
}

/** Who a piece of text names. */
export function mentionsIn(text: string, people: Mentionable[]): Mentionable[] {
  const found = new Map<string, Mentionable>();
  for (const { person, name } of mentionNames(people)) {
    if (text.includes(`@${name}`)) found.set(person.id, person);
  }
  return [...found.values()];
}

/**
 * The comment text field with its `@` mention list, the attached capture, the people the text will
 * notify, and the footer with Send. Send is enabled when there is text or a capture; the field is
 * cleared after each send.
 */
export function Composer({
  people,
  extra,
  capture,
  onClearCapture,
  onSend,
  autoFocus,
  inbox,
}: {
  people: Mentionable[];
  /** Controls that sit at the start of the footer, such as "Capture area". */
  extra?: ReactNode;
  /** A data URL of the captured area, while one is attached. */
  capture?: string | null;
  onClearCapture?: () => void;
  onSend: (text: string, capture: string | null) => void;
  autoFocus?: boolean;
  /** The Inbox pane uses the design system's own Send button rather than the card one. */
  inbox?: boolean;
}) {
  const { t, nm } = useAwp();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);
  // A fresh capture is a new thought; the half-typed `@` that was open is not part of it.
  const [lastCapture, setLastCapture] = useState(capture);
  if (capture !== lastCapture) {
    setLastCapture(capture);
    setQuery(null);
  }

  const matches =
    query === null
      ? []
      : people.filter((person) => `${person.name} ${person.nameAr}`.toLowerCase().includes(query.toLowerCase()));

  /** Whether the caret is sitting just after an `@` word, and what has been typed of it. */
  const syncQuery = (value: string, caret: number) => {
    const before = value.slice(0, caret).match(/(^|\s)@([^\s@]*)$/);
    setQuery(before ? before[2] : null);
    setHighlighted(0);
  };

  const pick = (person: Mentionable) => {
    const element = field.current;
    if (!element) return;
    const caret = element.selectionStart;
    // Replaces the partial `@word` just before the caret with the picked person's name.
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${nm(person)} `);
    const next = before + text.slice(caret);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(before.length, before.length);
    });
  };

  const send = () => {
    const written = text.trim();
    if (!written && !capture) return;
    onSend(written, capture ?? null);
    setText("");
    setQuery(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((here) => (here + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((here) => (here - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[highlighted]);
        return;
      }
      if (event.key === "Escape") {
        // Closes the list, not the popover the composer is inside.
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

  const tagged = mentionsIn(text, people);
  const canSend = Boolean(text.trim() || capture);

  return (
    <div className="qr-comp">
      <div className="qr-field">
        <textarea
          ref={field}
          value={text}
          rows={3}
          aria-label={t("Write a comment", "اكتب تعليقاً")}
          placeholder={t("Write a comment. Type @ to mention someone.", "اكتب تعليقاً. اكتب @ للإشارة إلى شخص.")}
          onChange={(event) => {
            setText(event.target.value);
            syncQuery(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onClick={(event) => syncQuery(text, event.currentTarget.selectionStart)}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="qr-mention-list"
          aria-autocomplete="list"
        />
        {matches.length > 0 && (
          <ul className="qr-sug" id="qr-mention-list" role="listbox" aria-label={t("People", "الأشخاص")}>
            {matches.map((person, index) => (
              <li
                key={person.id}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "on" : ""}
                onMouseDown={(event) => {
                  // Picking must not take the keyboard out of the field first.
                  event.preventDefault();
                  pick(person);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <Who id={person.id} s={28} />
                <span className="qr-sug-t">
                  <b>{nm(person)}</b>
                  <small>{t(person.role, person.roleAr)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {capture && (
        <div className="qr-att">
          {/* A data URL this browser produced a moment ago; there is nothing to optimise
              and no URL for a loader to rewrite. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capture} alt={t("Captured area", "المنطقة الملتقطة")} />
          <div className="qr-att-t">
            <b>{t("Captured area attached", "تم إرفاق المنطقة الملتقطة")}</b>
            <small>{t("Others will see exactly what you mean.", "سيرى الآخرون ما تقصده بالضبط.")}</small>
          </div>
          <button className="qr-x" onClick={onClearCapture} aria-label={t("Remove capture", "إزالة اللقطة")}>
            <Ic n="Cancel01" s={14} />
          </button>
        </div>
      )}
      {tagged.length > 0 && (
        <div className="qr-tagged">
          <span>{t("Will notify", "سيتم إشعار")}</span>
          {tagged.map((person) => (
            <span key={person.id} className="qr-tag">
              <Who id={person.id} s={20} />
              {nm(person)}
            </span>
          ))}
        </div>
      )}
      <div className="qr-foot">
        {extra}
        <span style={{ flex: 1 }} />
        {inbox ? (
          <Btn label={t("Send", "إرسال")} disabled={!canSend} onClick={send} />
        ) : (
          <button className="d3t-next" disabled={!canSend} onClick={send}>
            {t("Send", "إرسال")}
          </button>
        )}
      </div>
    </div>
  );
}
