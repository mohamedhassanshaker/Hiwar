"use client";

import { useEffect, useRef, useState } from "react";

import * as D from "@/ds";
import { Ic } from "@/components/ui/icon";
import type { InboxSummary } from "@/features/inbox/types";
import { CARD_LABEL, type CommentThread } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { kindLbl } from "@/i18n/vocabulary";
import { useGo } from "@/lib/routes";

/**
 * The Inbox peek (handoff v2 section 1.5).
 *
 * The top-bar inbox button opens this instead of navigating: most of the time the answer
 * to "is anything waiting for me" is a glance, and a glance should not cost the page a
 * person was in the middle of. Every row and chip still leads into the Inbox itself, so
 * nothing here is the only place something can be reached.
 *
 * What it counts is the same thing the badge counts: the items waiting for this person,
 * plus the comment threads somebody has replied in since they last read them. The counts are
 * exact; only the few items it names are read (D349).
 */

/** The kinds, in the order the chips show them, with the tone of each dot. */
const KINDS: [kind: string, en: string, ar: string, tone: string][] = [
  ["approval", "Approvals", "اعتمادات", "warning"],
  ["question", "Agent questions", "أسئلة الوكلاء", "info"],
  ["mention", "Mentions", "إشارات", "neutral"],
  ["sla", "SLA warnings", "تنبيهات الخدمة", "danger"],
  ["review", "Reviews", "مراجعات", "brand"],
  ["update", "Updates", "تحديثات", "info"],
];

/**
 * The top-bar inbox button with its unread badge, and the popover it toggles: counts per kind,
 * up to two urgent items, up to three latest entries, and a link to the Inbox. Escape or a
 * pointer press outside closes it; every row navigates to the Inbox with a filter or selection.
 */
export function InboxPeek({ inbox, threads }: { inbox: InboxSummary | null; threads: CommentThread[] }) {
  const { t } = useAwp();
  const { ago } = useAgo();
  const go = useGo();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const waitingCount = Object.values(inbox?.counts.open ?? {}).reduce((sum, n) => sum + n, 0);
  const unreadThreads = threads.filter((thread) => thread.unread);
  const total = waitingCount + unreadThreads.length;

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Escape returns the keyboard to the button it came from, not to the page.
      button.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const to = (params?: Record<string, string>) => {
    setOpen(false);
    go("inbox", params);
  };

  const counts = KINDS.map(([kind, en, ar, tone]) => ({
    kind,
    en,
    ar,
    tone,
    n: inbox?.counts.open[kind] ?? 0,
  })).filter((entry) => entry.n > 0);

  // What cannot wait: an SLA warning, or anything marked high risk.
  const urgent = inbox?.urgent ?? [];
  // Unread replies first, then whatever else arrived, up to three lines in total.
  const latest = [
    ...unreadThreads.map((thread) => ({
      key: `q:${thread.card}`,
      tone: "brand",
      text: `${t(...(CARD_LABEL[thread.card] ?? [thread.card, thread.card]))}: ${t(
        `${thread.unreadCount} new`,
        `${thread.unreadCount} جديدة`,
      )}`,
      at: thread.lastMessageAt,
    })),
    ...(inbox?.latest ?? [])
      .filter((item) => !urgent.some((shown) => shown.id === item.id))
      .map((item) => ({
        key: item.id,
        tone: kindLbl[item.kind]?.[2] ?? "neutral",
        text: t(item.t, item.tAr),
        at: item.at,
      })),
  ].slice(0, 3);

  const when = (iso: string | null) => (iso ? ago(iso) : "");

  return (
    <div className="ip" ref={wrap}>
      <button
        ref={button}
        className="awp-iconbtn"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t(`Inbox, ${total} unread`, `صندوق الوارد، ${total} غير مقروءة`)}
        title={t("Inbox", "صندوق الوارد")}
      >
        <Ic n="InboxDS" />
        {/* `UC-12.3-04`: nothing waiting means no badge, on the bell as in the sidebar. */}
        {total > 0 && (
          <span className="awp-badge" aria-hidden="true">
            <D.Badge type="number" text1={String(total)} />
          </span>
        )}
      </button>
      {open && (
        <div className="ip-pop" role="dialog" aria-label={t("Inbox summary", "ملخص صندوق الوارد")}>
          <div className="ip-h">
            <b>{t("Inbox", "صندوق الوارد")}</b>
            <span>{t(`${total} need you`, `${total} بانتظارك`)}</span>
          </div>
          {(counts.length > 0 || unreadThreads.length > 0) && (
            <div className="ip-chips">
              {counts.map((entry) => (
                <button key={entry.kind} className="ip-chip" onClick={() => to({ filter: entry.kind })}>
                  <i className={"ip-dot t-" + entry.tone} aria-hidden="true" />
                  {t(entry.en, entry.ar)}
                  <b>{entry.n}</b>
                </button>
              ))}
              {unreadThreads.length > 0 && (
                <button className="ip-chip" onClick={() => to({ filter: "quick" })}>
                  <i className="ip-dot t-brand" aria-hidden="true" />
                  {t("Quick requests", "طلبات سريعة")}
                  <b>{unreadThreads.length}</b>
                </button>
              )}
            </div>
          )}
          {urgent.length > 0 && (
            <div className="ip-sec">
              <span className="ip-l">{t("Needs you first", "الأولوية الآن")}</span>
              {urgent.map((item) => (
                <button key={item.id} className="ip-row" onClick={() => to({ sel: item.id })}>
                  <i className={"ip-dot t-" + (item.kind === "sla" ? "danger" : "warning")} aria-hidden="true" />
                  <span className="ip-t">{t(item.t, item.tAr)}</span>
                  <span className="ip-tm">{when(item.at)}</span>
                </button>
              ))}
            </div>
          )}
          {latest.length > 0 && (
            <div className="ip-sec">
              <span className="ip-l">{t("Latest", "الأحدث")}</span>
              {latest.map((entry) => (
                <button
                  key={entry.key}
                  className="ip-row"
                  onClick={() => to(entry.key.startsWith("q:") ? { filter: "quick", sel: entry.key } : { sel: entry.key })}
                >
                  <i className={"ip-dot t-" + entry.tone} aria-hidden="true" />
                  <span className="ip-t">{entry.text}</span>
                  <span className="ip-tm">{when(entry.at)}</span>
                </button>
              ))}
            </div>
          )}
          {total === 0 && <p className="ip-l" style={{ margin: 0 }}>{t("Nothing is waiting for you.", "لا شيء بانتظارك.")}</p>}
          <button className="d3-pill ip-all" style={{ flexShrink: 0 }} onClick={() => to()}>
            {t("Open Inbox", "فتح صندوق الوارد")}
          </button>
        </div>
      )}
    </div>
  );
}
