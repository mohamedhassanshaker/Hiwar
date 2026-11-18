"use client";

import { Ic } from "@/components/ui/icon";
import type { CommentCard } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { useComments, useThread } from "./comment-store";

/**
 * The comment button on a dashboard card (handoff v2 section 5.1).
 *
 * `data-qr` names the card, which is how the capture tool finds the card this button
 * belongs to without the button having to know its own geometry.
 */
export function CommentButton({ card }: { card: CommentCard }) {
  const { t } = useAwp();
  const { show } = useComments();
  const thread = useThread(card);
  const label = t("Comments", "التعليقات") + (thread.unread ? ` · ${t("new reply", "رد جديد")}` : "");
  return (
    <button
      data-qr={card}
      className={"d3-ibtn qr-btn" + (thread.unread ? " is-new" : "")}
      onClick={() => show(card)}
      aria-label={label}
      title={t("Comment and mention", "علّق وأشر إلى شخص")}
      aria-haspopup="dialog"
    >
      <Ic n="CommentAddDS" s={16} />
      {thread.unread && (
        <span className="qr-btn-n" aria-hidden="true">
          {thread.unreadCount}
        </span>
      )}
    </button>
  );
}
