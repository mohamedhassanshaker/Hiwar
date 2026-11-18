"use client";

import { useEffect, useState } from "react";

import { useDirectory } from "@/components/shared/directory";
import { Ic } from "@/components/ui/icon";
import { postComment } from "@/features/comments/actions";
import { CARD_LABEL, type CommentCard } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { useGo } from "@/lib/routes";
import { CaptureArea, cardElement } from "./capture";
import { useComments, useThread } from "./comment-store";
import { Composer, mentionsIn } from "./composer";
import { Conversation } from "./conversation";

/**
 * The comment popover and the reply toast (handoff v2 section 5.1).
 *
 * One of each at a time, hosted beside the dashboard rather than inside a card, so the
 * conversation is not clipped by the card it is about and a toast raised by a reply is
 * not unmounted when the card it belongs to scrolls away.
 */

/** How long a toast stays when nobody is looking at it. */
const TOAST_MS = 9000;

/**
 * The open card's conversation dialog: the thread, the composer, Capture area while the card is on
 * the page, and Open in Inbox once the thread has comments. Escape closes it unless the capture
 * tool is up; a failed send is shown in the dialog.
 */
function CommentPopover({ card, mayRaiseTasks }: { card: CommentCard; mayRaiseTasks: boolean }) {
  const { t } = useAwp();
  const go = useGo();
  const { people, show, refresh } = useComments();
  const thread = useThread(card);
  const [capturing, setCapturing] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    // While the capture tool is up it owns Escape; it closes itself first.
    if (capturing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") show(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, capturing]);

  const send = async (text: string, attached: string | null) => {
    setProblem(null);
    try {
      await postComment({ card, body: text, mentions: mentionsIn(text, people).map((person) => person.id), capture: attached ?? undefined });
      setCapture(null);
      await refresh(card);
    } catch {
      setProblem(t("The comment was not sent.", "لم يُرسل التعليق."));
    }
  };

  const canCapture = typeof document !== "undefined" && cardElement(card) !== null;
  const name = t(...(CARD_LABEL[card] ?? [card, card]));

  return (
    <>
      {capturing && (
        <CaptureArea
          card={card}
          onDone={(dataUrl) => {
            setCapture(dataUrl);
            setCapturing(false);
          }}
          onCancel={() => setCapturing(false)}
        />
      )}
      <div className="d3-modal-wrap" role="presentation" style={capturing ? { display: "none" } : undefined}>
        <div className="d3-modal-scrim" onClick={() => show(null)} />
        <div className="d3-modal qr-pop" role="dialog" aria-modal="true" aria-labelledby="qr-pop-title">
          <div className="d3-ch">
            <div className="qr-pop-h">
              <h3 id="qr-pop-title">{t("Comments", "التعليقات")}</h3>
              <span>{name}</span>
            </div>
            <button className="d3-ibtn" onClick={() => show(null)} aria-label={t("Close", "إغلاق")}>
              <Ic n="Cancel01" s={16} />
            </button>
          </div>
          <Conversation thread={thread} people={people} mayRaiseTasks={mayRaiseTasks} onChanged={() => void refresh(card)} />
          {problem && (
            <p className="d3-sub" role="alert" style={{ color: "var(--text-danger)" }}>
              {problem}
            </p>
          )}
          <Composer
            autoFocus
            people={people}
            capture={capture}
            onClearCapture={() => setCapture(null)}
            onSend={(text, attached) => void send(text, attached)}
            extra={
              <>
                {canCapture && !capture && (
                  <button className="d3-pill" onClick={() => setCapturing(true)}>
                    <Ic n="CropDS" s={16} />
                    {t("Capture area", "التقاط منطقة")}
                  </button>
                )}
                {thread.comments.length > 0 && (
                  <button
                    className="d3-pill"
                    onClick={() => {
                      show(null);
                      go("inbox", { filter: "quick", sel: `q:${card}` });
                    }}
                  >
                    {t("Open in Inbox", "فتح في صندوق الوارد")}
                  </button>
                )}
              </>
            }
          />
        </div>
      </div>
    </>
  );
}

/** "<name> replied and mentioned you", with Reply and Open in Inbox. */
function ReplyToast({ card, from, onClose }: { card: CommentCard; from: string; onClose: () => void }) {
  const { t, aName } = useAwp();
  const go = useGo();
  const { show } = useComments();
  const thread = useThread(card);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    // Held while the pointer is on it: a toast that vanishes mid-read is worse than none.
    if (held) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [held, onClose]);
  const latest = thread.comments.at(-1);
  if (!latest) return null;
  return (
    <div
      className="qr-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
    >
      <span className="qr-toast-ic" aria-hidden="true">
        <Ic n="Notification01" s={18} c="var(--icon-brand)" />
      </span>
      <div className="qr-toast-b">
        <div className="qr-toast-h">
          <b>{t(`${aName(from)} replied and mentioned you`, `${aName(from)} ردّ وأشار إليك`)}</b>
          <button className="qr-x" onClick={onClose} aria-label={t("Dismiss", "إغلاق")}>
            <Ic n="Cancel01" s={14} />
          </button>
        </div>
        <span className="qr-toast-k">{t(...(CARD_LABEL[card] ?? [card, card]))}</span>
        <p>{latest.bodyText}</p>
        <div className="qr-toast-a">
          <button
            className="d3t-next"
            onClick={() => {
              onClose();
              show(card);
            }}
          >
            {t("Reply", "رد")}
          </button>
          <button
            className="d3-pill"
            onClick={() => {
              onClose();
              go("inbox", { filter: "quick", sel: `q:${card}` });
            }}
          >
            {t("Open in Inbox", "فتح في صندوق الوارد")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the open card's popover and a reply toast for each unread thread, other than the open
 * one, whose newest comment was written by somebody else and mentions this person. A dismissed
 * toast stays dismissed for the life of the page.
 */
export function CommentHost({ mayRaiseTasks }: { mayRaiseTasks: boolean }) {
  const { me } = useDirectory();
  const { threads, openCard } = useComments();
  const [dismissed, setDismissed] = useState<string[]>([]);

  // A thread that has gone unread since the page was read, where the newest comment names
  // this person, is a reply they should be told about rather than one they have to find.
  const announce = threads.filter((thread) => {
    if (!thread.unread || thread.card === openCard || dismissed.includes(thread.card)) return false;
    const latest = thread.comments.at(-1);
    return latest !== undefined && latest.authorId !== me.id && latest.mentions.includes(me.id);
  });

  return (
    <div className="d3 qr-host">
      {openCard && <CommentPopover card={openCard} mayRaiseTasks={mayRaiseTasks} />}
      {announce.length > 0 && (
        <div className="qr-toasts">
          {announce.map((thread) => (
            <ReplyToast
              key={thread.card}
              card={thread.card}
              from={thread.comments.at(-1)?.authorId ?? ""}
              onClose={() => setDismissed((before) => [...before, thread.card])}
            />
          ))}
        </div>
      )}
    </div>
  );
}
